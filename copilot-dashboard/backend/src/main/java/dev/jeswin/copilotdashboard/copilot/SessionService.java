package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.copilot.CopilotSession;
import com.github.copilot.generated.SessionEvent;
import com.github.copilot.rpc.ExitPlanModeHandler;
import com.github.copilot.rpc.ExitPlanModeResult;
import com.github.copilot.rpc.MessageOptions;
import com.github.copilot.rpc.ModelBilling;
import com.github.copilot.rpc.ModelInfo;
import com.github.copilot.rpc.PermissionHandler;
import com.github.copilot.rpc.PermissionRequestResult;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import jakarta.annotation.PreDestroy;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Creates agent sessions, pumps their events to the browser, and brokers permission decisions.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    /**
     * Runtime events the dashboard renders. Everything else is dropped unless
     * {@code copilot.forward-all-events} is enabled. Kept narrow on purpose: events such as
     * {@code assistant.usage} and {@code session.usage_checkpoint} carry multi-kilobyte telemetry
     * that would bloat the stream and the replay buffer.
     */
    private static final List<String> FORWARDED_EVENT_PREFIXES = List.of(
            "assistant.message",
            "assistant.reasoning",
            "assistant.turn_end",
            "tool.execution_start",
            "tool.execution_complete",
            "tool.execution_progress",
            "session.idle",
            "session.usage_info",
            "session.error",
            "session.title_changed",
            "session.mode_changed",
            "session.schedule_",
            "session.background_tasks_changed",
            "subagent.selected",
            "subagent.deselected",
            "abort");

    /**
     * Read for bookkeeping even when not forwarded. {@code user.message} in particular is never
     * forwarded as-is: it carries the whole expanded prompt, which can run to tens of kilobytes.
     */
    private static final Set<String> TRACKED_EVENTS =
            Set.of("user.message", "session.idle", "session.title_changed", "session.mode_changed");

    private final CopilotClientManager clientManager;
    private final CopilotProperties properties;
    private final ObjectMapper objectMapper;
    private final SessionConfigFactory configFactory;
    private final CommandPolicy commandPolicy;

    private final Map<String, DashboardSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> inFlightTurns = new ConcurrentHashMap<>();
    private final Object modelCacheLock = new Object();
    private volatile List<Map<String, Object>> modelCache;
    private final ExecutorService turnExecutor =
            Executors.newCachedThreadPool(runnable -> {
                Thread thread = new Thread(runnable, "copilot-turn");
                thread.setDaemon(true);
                return thread;
            });

    public SessionService(CopilotClientManager clientManager, CopilotProperties properties,
            ObjectMapper objectMapper, SessionConfigFactory configFactory, CommandPolicy commandPolicy) {
        this.clientManager = clientManager;
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.configFactory = configFactory;
        this.commandPolicy = commandPolicy;
    }

    // ---------------------------------------------------------------- lifecycle

    public DashboardSession createSession(String requestedModel, String requestedWorkingDirectory,
            boolean autoApprove, String requestedEffort, String requestedPersona) {
        String model = StringUtils.hasText(requestedModel) ? requestedModel.trim() : configFactory.defaultModel();
        String workingDirectory = resolveWorkingDirectory(requestedWorkingDirectory);
        String effort = resolveEffort(model, requestedEffort);
        String persona = resolvePersona(requestedPersona);

        String dashboardId = UUID.randomUUID().toString();

        SessionConfig config = new SessionConfig()
                .setModel(model)
                .setStreaming(true)
                .setWorkingDirectory(workingDirectory)
                .setOnPermissionRequest(permissionHandler(dashboardId, autoApprove))
                // Without a handler the runtime never offers its exit_plan_mode tool, so /plan
                // would end in prose with no way to approve the plan and move on.
                .setOnExitPlanMode(planReviewHandler(dashboardId));

        if (properties.isConfigDiscovery()) {
            config.setEnableConfigDiscovery(true);
        }

        // Only set it when we have one. Passing null would be asking the runtime to use "no
        // effort", which is a different instruction from "you choose".
        if (effort != null) {
            config.setReasoningEffort(effort);
        }

        // Your own model endpoint (when this model is one of its models), MCP servers, persona.
        configFactory.apply(config, model, persona);

        CopilotSession copilotSession;
        try {
            copilotSession = clientManager.client().createSession(config).get(120, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while creating a Copilot session", ex);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not create a Copilot session: " + rootMessage(ex), ex);
        }

        DashboardSession dashboardSession = new DashboardSession(dashboardId, copilotSession, model,
                workingDirectory, autoApprove, effort, persona, properties.getEventHistoryLimit());
        sessions.put(dashboardId, dashboardSession);

        copilotSession.on(event -> onRuntimeEvent(dashboardSession, event));

        log.info("Created session {} (model={}{}, cwd={}, autoApprove={}, effort={}, persona={})",
                dashboardId, model, configFactory.isProviderModel(model) ? " via own provider" : "",
                workingDirectory, autoApprove, effort == null ? "model default" : effort,
                persona == null ? "none" : persona);
        return dashboardSession;
    }

    /**
     * Decides the persona a session will really run with. Null asks for the configured default;
     * blank or {@code none} asks for no persona. An unknown id is dropped with a warning rather
     * than failing the request — the same reasoning as {@link #resolveEffort} — and the summary
     * reports what was actually applied.
     */
    private String resolvePersona(String requested) {
        if (requested == null) {
            return configFactory.defaultPersona();
        }
        String wanted = requested.trim();
        if (wanted.isEmpty() || "none".equalsIgnoreCase(wanted)) {
            return null;
        }
        if (configFactory.persona(wanted).isPresent()) {
            return wanted;
        }
        log.warn("Unknown persona '{}'; starting the session without one", wanted);
        return null;
    }

    /**
     * Decides the reasoning effort a session will really run at.
     *
     * <p>Returns null — meaning "let the model decide" — for anything the chosen model does not
     * advertise. Support varies sharply and is not guessable: {@code auto} and
     * {@code claude-haiku-4.5} advertise none at all, {@code grok-4.5} stops at {@code high}, and
     * only the Opus and GPT-6 families reach {@code max}.
     *
     * <p>Dropping rather than throwing is deliberate. The browser hides the control for models
     * with no support, so an unsupported value only arrives if the two sides disagree — most
     * likely mid-switch, where failing the request would strand the user on a dead session for
     * what is a harmless disagreement. The value that was actually applied is returned to the
     * browser on {@code SessionSummary}, so the UI can only ever display the truth. The warning
     * below is what stops this being a silent lie.
     */
    private String resolveEffort(String model, String requested) {
        if (!StringUtils.hasText(requested)) {
            return null;
        }
        List<String> supported = supportedEfforts(model);
        if (supported.contains(requested)) {
            return requested;
        }
        log.warn("Model {} does not support reasoning effort '{}' (supports {}); using the model default",
                model, requested, supported.isEmpty() ? "none" : supported);
        return null;
    }

    public List<DashboardSession> listSessions() {
        return sessions.values().stream()
                .sorted(Comparator.comparing(DashboardSession::getCreatedAt).reversed())
                .toList();
    }

    public DashboardSession requireSession(String id) {
        DashboardSession session = sessions.get(id);
        if (session == null) {
            throw new SessionNotFoundException(id);
        }
        return session;
    }

    public void deleteSession(String id) {
        DashboardSession session = sessions.remove(id);
        if (session == null) {
            return;
        }
        Future<?> turn = inFlightTurns.remove(id);
        if (turn != null) {
            turn.cancel(true);
        }
        session.getPendingPermissions().values()
                .forEach(pending -> pending.future().complete(PermissionRequestResult.userNotAvailable()));
        session.getPendingPermissions().clear();
        declinePlanReviews(session, "The conversation was closed before the plan was reviewed.");
        session.closeEmitters();
        try {
            session.getSession().close();
        } catch (Exception ex) {
            log.debug("Error closing Copilot session {}: {}", id, ex.toString());
        }
        log.info("Deleted session {}", id);
    }

    // ---------------------------------------------------------------- streaming

    public SseEmitter subscribe(String sessionId) {
        DashboardSession session = requireSession(sessionId);
        SseEmitter emitter = new SseEmitter(0L);
        session.addEmitter(emitter);

        try {
            emitter.send(SseEmitter.event().name("copilot").data(dashboardEvent("dashboard.connected")));
            for (JsonNode buffered : session.replayBuffer()) {
                emitter.send(SseEmitter.event().name("copilot").data(buffered));
            }
            for (PendingPermission pending : session.getPendingPermissions().values()) {
                emitter.send(SseEmitter.event().name("copilot").data(permissionEvent(pending)));
            }
            for (PendingPlanReview pending : session.getPendingPlanReviews().values()) {
                emitter.send(SseEmitter.event().name("copilot").data(pending.payload()));
            }
            ObjectNode ready = dashboardEvent("dashboard.ready");
            ready.put("busy", session.isBusy());
            ready.put("mode", session.getMode());
            if (session.getExternalTurn() != null) {
                ready.put("externalTurn", session.getExternalTurn());
            }
            emitter.send(SseEmitter.event().name("copilot").data(ready));
        } catch (Exception ex) {
            emitter.completeWithError(ex);
        }
        return emitter;
    }

    private void onRuntimeEvent(DashboardSession session, SessionEvent event) {
        String type = event.getType();
        if (type == null) {
            return;
        }
        boolean forwarded = properties.isForwardAllEvents() || isForwarded(type);
        if (!forwarded && !TRACKED_EVENTS.contains(type)) {
            return;
        }
        try {
            // Serializing the concrete event subclass keeps every payload field the UI might want.
            JsonNode serialized = objectMapper.valueToTree(event);
            JsonNode data = serialized.get("data");
            if (data == null) {
                data = serialized;
            }

            switch (type) {
                case "user.message" -> {
                    if (data instanceof ObjectNode node) {
                        node.remove("transformedContent");
                    }
                    onUserMessage(session, event, data);
                }
                case "session.title_changed" -> {
                    String title = data.path("title").asText("");
                    if (StringUtils.hasText(title)) {
                        session.setTitle(title);
                    }
                }
                case "session.mode_changed" -> {
                    String mode = data.path("newMode").asText("");
                    if (StringUtils.hasText(mode)) {
                        session.setMode(mode);
                    }
                }
                default -> {
                    // Forwarded untouched.
                }
            }

            if (forwarded) {
                // Normalise to {type, timestamp, data} so the UI has one shape for SDK and dashboard events.
                ObjectNode envelope = dashboardEvent(type);
                envelope.set("data", data);
                session.broadcast(envelope);
            }

            if ("session.idle".equals(type)) {
                String external = session.endExternalTurn();
                if (external != null) {
                    ObjectNode end = dashboardEvent("dashboard.turn_end");
                    end.put("external", true);
                    end.put("turnId", external);
                    session.broadcast(end);
                }
            }
        } catch (RuntimeException ex) {
            log.warn("Could not serialize event {} for session {}: {}", type, session.getId(), ex.toString());
        }
    }

    /**
     * Every prompt the runtime records — ours, and ones it sends itself. Two jobs:
     *
     * <p>When nothing here is running a turn, the runtime started one on its own: a scheduled
     * prompt from {@code /every} or {@code /after} firing. The browser is told a turn began, so
     * the reply streams into the chat instead of being dropped as noise from no turn.
     *
     * <p>The event id is passed on because it is what {@code /rewind} identifies a point by; the
     * browser pins it to the message, which is how a rewind knows where to cut the transcript.
     */
    private void onUserMessage(DashboardSession session, SessionEvent event, JsonNode data) {
        // Expanded prompts (a /review, say) run to pages; the browser only needs enough to match on.
        String content = CommandService.clip(data.path("content").asText(""), 4000);
        String source = data.path("source").asText("");
        // A scheduled prompt only ever fires once the session is idle, so it always opens a new
        // turn — even if our previous turn's cleanup has not yet cleared the busy flag.
        boolean scheduled = source.startsWith("schedule");
        if (scheduled || !session.isBusy()) {
            String turnId = UUID.randomUUID().toString();
            if (session.beginExternalTurn(turnId, scheduled)) {
                ObjectNode start = dashboardEvent("dashboard.turn_start");
                start.put("external", true);
                start.put("turnId", turnId);
                start.put("content", content);
                start.put("source", source);
                session.broadcast(start);
            }
        }
        ObjectNode recorded = dashboardEvent("dashboard.prompt_recorded");
        if (event.getId() != null) {
            recorded.put("eventId", event.getId().toString());
        }
        recorded.put("content", content);
        recorded.put("source", source);
        session.broadcast(recorded);
    }

    private boolean isForwarded(String type) {
        return FORWARDED_EVENT_PREFIXES.stream().anyMatch(type::startsWith);
    }

    // ---------------------------------------------------------------- messaging

    public void sendMessage(String sessionId, String prompt) {
        DashboardSession session = requireSession(sessionId);
        if (!session.markBusy()) {
            throw new SessionBusyException(sessionId);
        }
        if (!StringUtils.hasText(session.getTitle()) || "New conversation".equals(session.getTitle())) {
            session.setTitle(prompt.length() > 60 ? prompt.substring(0, 60) + "..." : prompt);
        }

        ObjectNode userEcho = dashboardEvent("dashboard.user_message");
        userEcho.put("content", prompt);
        session.broadcast(userEcho);
        session.broadcast(dashboardEvent("dashboard.turn_start"));

        submitTurn(session, null, () -> sendAndWait(session, new MessageOptions().setPrompt(prompt)));
    }

    /** One unit of work run for a session on the turn thread pool. */
    @FunctionalInterface
    interface TurnWork {
        void run() throws Exception;
    }

    /**
     * Runs work for a session the caller has already marked busy, and always frees it afterwards.
     *
     * <p>{@code requestId} ties the closing {@code dashboard.turn_end} (and any error) to the
     * browser request that started it. A slash command's own turn emits {@code session.idle}
     * before its result is known, so the browser waits for the turn_end carrying its id instead.
     */
    void submitTurn(DashboardSession session, String requestId, TurnWork work) {
        String sessionId = session.getId();
        Future<?> turn = turnExecutor.submit(() -> {
            try {
                work.run();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            } catch (Exception ex) {
                log.warn("Turn failed for session {}: {}", sessionId, rootMessage(ex));
                ObjectNode error = dashboardEvent("dashboard.error");
                error.put("message", rootMessage(ex));
                if (requestId != null) {
                    error.put("requestId", requestId);
                }
                session.broadcast(error);
            } finally {
                session.markIdle();
                inFlightTurns.remove(sessionId);
                ObjectNode end = dashboardEvent("dashboard.turn_end");
                if (requestId != null) {
                    end.put("requestId", requestId);
                }
                session.broadcast(end);
            }
        });
        inFlightTurns.put(sessionId, turn);
    }

    /**
     * Runs a short piece of work beside a turn that is already running — a read-only command such
     * as {@code /context} asked for mid-reply. Does not touch the busy flag, which belongs to that
     * turn; the closing {@code turn_end} carries the request id so only its own caller reacts.
     */
    void submitBeside(DashboardSession session, String requestId, TurnWork work) {
        turnExecutor.submit(() -> {
            try {
                work.run();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            } catch (Exception ex) {
                ObjectNode error = dashboardEvent("dashboard.error");
                error.put("message", rootMessage(ex));
                error.put("requestId", requestId);
                session.broadcast(error);
            } finally {
                ObjectNode end = dashboardEvent("dashboard.turn_end");
                end.put("requestId", requestId);
                session.broadcast(end);
            }
        });
    }

    /**
     * The SDK's no-timeout overload defaults to 60s, which kills any real piece of agent work.
     * Always pass an explicit budget.
     */
    void sendAndWait(DashboardSession session, MessageOptions options) throws Exception {
        session.getSession().sendAndWait(options, turnTimeoutMs()).get();
    }

    long turnTimeoutMs() {
        return Math.max(1, properties.getTurnTimeoutSeconds()) * 1000L;
    }

    /**
     * Stops the turn that is currently running for the session. The SDK's {@code abort()} tells the
     * agent to unwind cleanly; cancelling the local future only frees our thread.
     */
    public void abortTurn(String sessionId) {
        DashboardSession session = requireSession(sessionId);
        // A plan waiting for review holds the turn open; answer it first or abort waits on it.
        declinePlanReviews(session, "The user stopped this turn before reviewing the plan.");
        try {
            session.getSession().abort().get(15, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            log.warn("Abort failed for session {}: {}", sessionId, rootMessage(ex));
        }
        Future<?> turn = inFlightTurns.remove(sessionId);
        if (turn != null) {
            turn.cancel(true);
        }
        session.markIdle();
        session.endExternalTurn();
        ObjectNode aborted = dashboardEvent("dashboard.aborted");
        aborted.put("message", "Turn stopped by user.");
        session.broadcast(aborted);
        session.broadcast(dashboardEvent("dashboard.turn_end"));
    }

    // ---------------------------------------------------------------- models

    /**
     * Models the signed-in account can actually use. Hardcoding this list goes stale the moment
     * GitHub rotates model names, so ask the runtime. Cached because it is a round trip to the CLI
     * and the answer does not change within a process lifetime.
     */
    public List<Map<String, Object>> listModels() {
        List<Map<String, Object>> cached = modelCache;
        if (cached != null) {
            return cached;
        }
        synchronized (modelCacheLock) {
            if (modelCache == null) {
                modelCache = fetchModels();
            }
            return modelCache;
        }
    }

    private List<Map<String, Object>> fetchModels() {
        List<Map<String, Object>> own = configFactory.providerModelEntries();
        Map<String, Object> auto = autoEntry();
        try {
            List<ModelInfo> models = clientManager.client().listModels().get(60, TimeUnit.SECONDS);
            List<Map<String, Object>> mapped = models.stream()
                    .filter(model -> StringUtils.hasText(model.getId()))
                    // The runtime already lists "auto"; we pin our own copy at the top.
                    .filter(model -> !"auto".equals(model.getId()))
                    // A same-named model on your own endpoint wins: sessions for it go there.
                    .filter(model -> !configFactory.isProviderModel(model.getId()))
                    .map(SessionService::describeModel)
                    .toList();
            return Stream.of(own.stream(), Stream.of(auto), mapped.stream()).flatMap(s -> s).toList();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return fallbackModels(own, auto);
        } catch (Exception ex) {
            log.warn("Could not list Copilot models, falling back to {}: {}",
                    own.isEmpty() ? "auto only" : "your own models", rootMessage(ex));
            return fallbackModels(own, auto);
        }
    }

    /**
     * When Copilot cannot list its models, Auto is only offered if nothing else is: it needs that
     * same Copilot connection, while models on your own endpoint do not.
     */
    private static List<Map<String, Object>> fallbackModels(List<Map<String, Object>> own,
            Map<String, Object> auto) {
        return own.isEmpty() ? List.of(auto) : own;
    }

    /**
     * "Auto" is the runtime picking a model for us. We cannot know in advance which one it will
     * choose, so we cannot honestly claim any particular set of reasoning efforts — the list is
     * empty, and the UI hides the effort control rather than offering a choice that might be
     * silently discarded.
     */
    private static Map<String, Object> autoEntry() {
        Map<String, Object> auto = new LinkedHashMap<>();
        auto.put("id", "auto");
        auto.put("name", "Auto");
        auto.put("reasoningEfforts", List.of());
        auto.put("defaultReasoningEffort", null);
        auto.put("multiplier", null);
        auto.put("provider", null);
        return auto;
    }

    /**
     * Flattens a {@link ModelInfo} into the shape the browser consumes.
     *
     * <p>A {@link LinkedHashMap} rather than {@code Map.of} because three of these values are
     * legitimately absent for some models, and {@code Map.of} throws on a null. Absent must stay
     * distinguishable from empty: a model with no reasoning support and a model whose support we
     * failed to read are different claims, and only the first one justifies hiding the control.
     */
    private static Map<String, Object> describeModel(ModelInfo model) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", model.getId());
        out.put("name", StringUtils.hasText(model.getName()) ? model.getName() : model.getId());

        List<String> efforts = model.getSupportedReasoningEfforts();
        out.put("reasoningEfforts", efforts == null ? List.of() : List.copyOf(efforts));
        out.put("defaultReasoningEffort", model.getDefaultReasoningEffort());

        // The premium-request multiplier, used to warn before an expensive choice. Optional:
        // some models are not billed per request at all.
        ModelBilling billing = model.getBilling();
        out.put("multiplier",
                billing == null ? null : billing.getMultiplierOpt().isPresent()
                        ? billing.getMultiplier()
                        : null);
        // Null marks a GitHub Copilot model; your own endpoint's models carry its type here.
        out.put("provider", null);
        return out;
    }

    /**
     * The reasoning efforts a given model id genuinely accepts, straight from the runtime's own
     * answer. Used to refuse a request rather than let the SDK silently ignore it — a session that
     * claims "max" but was created with the default is exactly the kind of lie this project does
     * not ship.
     */
    @SuppressWarnings("unchecked")
    public List<String> supportedEfforts(String modelId) {
        return listModels().stream()
                .filter(m -> modelId.equals(m.get("id")))
                .findFirst()
                .map(m -> (List<String>) m.getOrDefault("reasoningEfforts", List.of()))
                .orElse(List.of());
    }

    // ---------------------------------------------------------------- permissions

    private PermissionHandler permissionHandler(String dashboardId, boolean autoApprove) {
        return (request, invocation) -> {
            // Managed (policy-enforced) requests must never be auto-answered by the application.
            if (Boolean.TRUE.equals(request.getManagedApprovalRequired())) {
                return CompletableFuture.completedFuture(PermissionRequestResult.noResult());
            }
            if (autoApprove) {
                return CompletableFuture.completedFuture(PermissionRequestResult.approveOnce());
            }

            DashboardSession session = sessions.get(dashboardId);
            if (session == null) {
                return CompletableFuture.completedFuture(PermissionRequestResult.userNotAvailable());
            }

            String requestId = UUID.randomUUID().toString();
            JsonNode payload;
            try {
                payload = objectMapper.valueToTree(request);
            } catch (RuntimeException ex) {
                payload = objectMapper.createObjectNode().put("kind", "unknown");
            }

            CompletableFuture<PermissionRequestResult> decision = new CompletableFuture<>();
            PendingPermission pending = new PendingPermission(requestId, payload, decision);
            session.getPendingPermissions().put(requestId, pending);
            session.broadcast(permissionEvent(pending));

            return decision
                    .orTimeout(properties.getPermissionTimeoutSeconds(), TimeUnit.SECONDS)
                    .exceptionally(ex -> {
                        if (ex instanceof TimeoutException || ex.getCause() instanceof TimeoutException) {
                            log.info("Permission {} timed out for session {}", requestId, dashboardId);
                        }
                        return PermissionRequestResult.userNotAvailable();
                    })
                    .whenComplete((result, ex) -> {
                        session.getPendingPermissions().remove(requestId);
                        ObjectNode resolved = dashboardEvent("dashboard.permission_resolved");
                        resolved.put("requestId", requestId);
                        session.broadcast(resolved);
                    });
        };
    }

    public void resolvePermission(String sessionId, String requestId, String decision, String feedback) {
        DashboardSession session = requireSession(sessionId);
        PendingPermission pending = session.getPendingPermissions().get(requestId);
        if (pending == null) {
            throw new PermissionNotFoundException(requestId);
        }
        PermissionRequestResult result = switch (decision == null ? "" : decision.toLowerCase()) {
            case "approve", "approve-once" -> PermissionRequestResult.approveOnce();
            case "reject", "deny" -> PermissionRequestResult.reject(
                    StringUtils.hasText(feedback) ? feedback : "The user declined this action.");
            default -> throw new IllegalArgumentException(
                    "Unsupported decision '" + decision + "'. Use 'approve' or 'reject'.");
        };
        pending.future().complete(result);
    }

    // ---------------------------------------------------------------- plan review

    /**
     * Called by the runtime when a {@code /plan} turn has a plan ready. Parked for the user exactly
     * like a permission request: the agent's turn waits on the answer, and silence is a refusal.
     */
    private ExitPlanModeHandler planReviewHandler(String dashboardId) {
        return (request, invocation) -> {
            DashboardSession session = sessions.get(dashboardId);
            if (session == null) {
                return CompletableFuture.completedFuture(new ExitPlanModeResult().setApproved(false)
                        .setFeedback("The user is not available to review the plan. End your turn."));
            }

            String reviewId = UUID.randomUUID().toString();
            List<String> actions = request.getActions() == null
                    ? List.of()
                    : request.getActions().stream().filter(StringUtils::hasText).toList();

            ObjectNode payload = dashboardEvent("dashboard.plan_review_requested");
            payload.put("reviewId", reviewId);
            payload.put("summary", request.getSummary());
            payload.put("planContent", request.getPlanContent());
            ArrayNode offered = payload.putArray("actions");
            actions.forEach(offered::add);
            payload.put("recommendedAction", request.getRecommendedAction());
            ArrayNode needsConfirm = payload.putArray("confirmActions");
            actions.stream().filter(this::planActionNeedsConfirmation).forEach(needsConfirm::add);

            CompletableFuture<ExitPlanModeResult> decision = new CompletableFuture<>();
            session.getPendingPlanReviews().put(reviewId,
                    new PendingPlanReview(reviewId, payload, actions, decision));
            session.broadcast(payload);

            long timeout = properties.getPermissionTimeoutSeconds();
            return decision
                    .orTimeout(timeout, TimeUnit.SECONDS)
                    .exceptionally(ex -> {
                        log.info("Plan review {} timed out for session {}", reviewId, dashboardId);
                        return new ExitPlanModeResult().setApproved(false).setFeedback(
                                "No reply from the user within " + timeout + " seconds. Do not revise or "
                                        + "retry the plan; end your turn and wait for the user.");
                    })
                    .whenComplete((result, ex) -> {
                        session.getPendingPlanReviews().remove(reviewId);
                        ObjectNode resolved = dashboardEvent("dashboard.plan_review_resolved");
                        resolved.put("reviewId", reviewId);
                        resolved.put("approved", result != null && result.isApproved());
                        if (result != null && result.getSelectedAction() != null) {
                            resolved.put("action", result.getSelectedAction());
                        }
                        session.broadcast(resolved);
                    });
        };
    }

    /**
     * Answers a parked plan. Approving into autopilot lets the agent carry on without asking, so it
     * sits behind the same confirmation as typing {@code /autopilot} or {@code /fleet}.
     */
    public void resolvePlanReview(String sessionId, String reviewId, boolean approved, String action,
            String feedback, boolean confirmed) {
        DashboardSession session = requireSession(sessionId);
        PendingPlanReview pending = session.getPendingPlanReviews().get(reviewId);
        if (pending == null) {
            throw new PlanReviewNotFoundException(reviewId);
        }
        ExitPlanModeResult result = new ExitPlanModeResult().setApproved(approved);
        if (approved) {
            String chosen = StringUtils.hasText(action) ? action.trim() : null;
            if (chosen == null && !pending.actions().isEmpty()) {
                throw new IllegalArgumentException("Choose what happens next: " + String.join(", ", pending.actions()));
            }
            if (chosen != null && !pending.actions().contains(chosen)) {
                throw new IllegalArgumentException("'" + chosen + "' was not offered. Choose one of: "
                        + String.join(", ", pending.actions()));
            }
            if (chosen != null && planActionNeedsConfirmation(chosen) && !confirmed) {
                throw new ConfirmationRequiredException("Approving into " + chosen
                        + " lets the agent keep working without asking you. Confirm to continue.");
            }
            result.setSelectedAction(chosen);
        }
        if (StringUtils.hasText(feedback)) {
            result.setFeedback(feedback.trim());
        }
        if (!pending.future().complete(result)) {
            throw new PlanReviewNotFoundException(reviewId);
        }
    }

    boolean planActionNeedsConfirmation(String action) {
        return switch (action) {
            case "autopilot" -> commandPolicy.needsConfirmation("autopilot");
            case "autopilot_fleet" -> commandPolicy.needsConfirmation("autopilot")
                    || commandPolicy.needsConfirmation("fleet");
            default -> false;
        };
    }

    private void declinePlanReviews(DashboardSession session, String reason) {
        for (PendingPlanReview pending : new ArrayList<>(session.getPendingPlanReviews().values())) {
            pending.future().complete(new ExitPlanModeResult().setApproved(false)
                    .setFeedback(reason + " End your turn."));
        }
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Resolves a requested working directory to an absolute, normalised path,
     * rejecting anything that is not an existing directory.
     *
     * <p>Public because the UI needs to check a path <em>before</em> committing
     * to it. Session settings are fixed at creation, so a bad path would
     * otherwise be accepted silently and only fail on the user's next message —
     * by which point the original one has already been typed and lost.
     *
     * <p>It is deliberately the same method {@link #createSession} calls. A
     * separate "validate" implementation would be free to drift from the one
     * that actually matters, and a check that disagrees with the real rule is
     * worse than no check at all.
     */
    public String resolveWorkingDirectory(String requested) {
        String candidate = StringUtils.hasText(requested) ? requested : properties.getDefaultWorkingDirectory();
        Path path;
        try {
            path = Path.of(candidate).toAbsolutePath().normalize();
        } catch (InvalidPathException ex) {
            /* Windows rejects characters that are legal on POSIX, so this is
               reachable with ordinary typing — ": " in a pasted log line, for
               instance — and must not surface as a 500. */
            throw new IllegalArgumentException("Not a valid path: " + candidate);
        }
        if (!Files.isDirectory(path)) {
            throw new IllegalArgumentException("Working directory does not exist: " + path);
        }
        return path.toString();
    }

    ObjectNode dashboardEvent(String type) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("type", type);
        node.put("timestamp", System.currentTimeMillis());
        return node;
    }

    private ObjectNode permissionEvent(PendingPermission pending) {
        ObjectNode node = dashboardEvent("dashboard.permission_requested");
        node.put("requestId", pending.id());
        node.set("request", pending.payload());
        return node;
    }

    static String rootMessage(Throwable ex) {
        Throwable cursor = ex;
        while (cursor.getCause() != null && cursor.getCause() != cursor) {
            cursor = cursor.getCause();
        }
        return cursor.getMessage() == null ? cursor.getClass().getSimpleName() : cursor.getMessage();
    }

    @PreDestroy
    void shutdown() {
        sessions.keySet().forEach(this::deleteSession);
        turnExecutor.shutdownNow();
    }

    // ---------------------------------------------------------------- exceptions

    public static class SessionNotFoundException extends RuntimeException {
        public SessionNotFoundException(String id) {
            super("No such session: " + id);
        }
    }

    public static class SessionBusyException extends RuntimeException {
        public SessionBusyException(String id) {
            super("Session " + id + " is still processing the previous message.");
        }

        public SessionBusyException(String id, String message) {
            super(message);
        }
    }

    public static class PermissionNotFoundException extends RuntimeException {
        public PermissionNotFoundException(String id) {
            super("No pending permission request: " + id);
        }
    }

    public static class PlanReviewNotFoundException extends RuntimeException {
        public PlanReviewNotFoundException(String id) {
            super("This plan is no longer waiting for review: " + id);
        }
    }

    /**
     * The request is allowed, but only once the user has explicitly agreed to it — see
     * {@code copilot.commands.confirm}. Sent again with {@code confirmed: true}, it goes through.
     */
    public static class ConfirmationRequiredException extends RuntimeException {
        public ConfirmationRequiredException(String message) {
            super(message);
        }
    }
}
