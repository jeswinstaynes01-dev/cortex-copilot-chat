package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.copilot.CopilotClient;
import com.github.copilot.CopilotSession;
import com.github.copilot.generated.rpc.HistoryRewindMode;
import com.github.copilot.generated.rpc.SessionCommandsInvokeParams;
import com.github.copilot.generated.rpc.SessionCommandsListParams;
import com.github.copilot.generated.rpc.SessionCommandsListResult;
import com.github.copilot.generated.rpc.SessionHistoryRewindParams;
import com.github.copilot.generated.rpc.SessionScheduleStopParams;
import com.github.copilot.generated.rpc.SessionTasksCancelParams;
import com.github.copilot.generated.rpc.SlashCommandInfo;
import com.github.copilot.generated.rpc.SlashCommandInvocationResult;
import com.github.copilot.rpc.AgentInfo;
import com.github.copilot.rpc.AgentMode;
import com.github.copilot.rpc.GetStatusResponse;
import com.github.copilot.rpc.MessageOptions;
import com.github.copilot.rpc.PermissionRequestResult;
import com.github.copilot.rpc.ProviderConfig;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * The runtime's own slash commands — {@code /context}, {@code /plan}, {@code /every}, skills and
 * the rest — offered to the browser, plus the session views behind {@code /agent},
 * {@code /rewind}, {@code /tasks}, {@code /instructions} and {@code /version}.
 *
 * <p>Nothing here is hardcoded: the list comes from the runtime, so a CLI upgrade that adds a
 * command makes it appear here too. {@link CommandPolicy} decides what stays hidden (Cortex has
 * its own way to do it) and what needs a confirmation first.
 *
 * <p>Results stream back over the session's event stream as {@code dashboard.command_result},
 * tagged with the browser's {@code requestId}. That id matters: a command can run beside a reply
 * that is still streaming, and both end with events the browser must not confuse.
 */
@Service
public class CommandService {

    private static final Logger log = LoggerFactory.getLogger(CommandService.class);

    /** Terminal colour and hyperlink codes: the CLI renders some output for a terminal. */
    private static final Pattern ANSI = Pattern.compile(
            "\u001B\\][^\u0007\u001B]*(?:\u0007|\u001B\\\\)|\u001B\\[[0-?]*[ -/]*[@-~]|\u001B[@-Z\\\\-_]");
    private static final long CATALOG_TTL_NANOS = TimeUnit.MINUTES.toNanos(5);
    private static final long RPC_TIMEOUT_SECONDS = 30;
    private static final int MAX_TEXT = 4000;
    private static final int MAX_FIELD = 500;
    private static final String SDK_POM = "/META-INF/maven/com.github/copilot-sdk-java/pom.properties";

    /** Why each hidden command is hidden, phrased as what to do instead. */
    private static final Map<String, String> CORTEX_ALTERNATIVES = Map.of(
            "model", "Use /model or the model menu: Cortex starts a new conversation on the model you pick.",
            "cwd", "Use /cd: Cortex checks the folder exists and starts a new conversation there.",
            "allow-all", "Use /approve to turn auto-approve on or off for a new conversation.",
            "permissions", "Cortex asks for each permission in the chat; use /approve to change auto-approve.");

    private final SessionService sessionService;
    private final CopilotClientManager clientManager;
    private final SessionConfigFactory configFactory;
    private final CopilotProperties properties;
    private final CommandPolicy policy;
    private final ObjectMapper objectMapper;

    private final Object catalogLock = new Object();
    private List<CommandInfo> catalog;
    private long catalogFetchedAt;

    public CommandService(SessionService sessionService, CopilotClientManager clientManager,
            SessionConfigFactory configFactory, CopilotProperties properties, CommandPolicy policy,
            ObjectMapper objectMapper) {
        this.sessionService = sessionService;
        this.clientManager = clientManager;
        this.configFactory = configFactory;
        this.properties = properties;
        this.policy = policy;
        this.objectMapper = objectMapper;
    }

    // ---------------------------------------------------------------- catalog

    /** One command as the browser's palette shows it. */
    public record CommandInfo(
            String name,
            List<String> aliases,
            String description,
            String hint,
            boolean required,
            List<Choice> choices,
            String completion,
            String kind,
            boolean allowDuringTurn,
            boolean confirm,
            boolean schedulable,
            boolean experimental) {
    }

    public record Choice(String name, String description) {
    }

    /**
     * The commands a new conversation will have, for the palette before any session exists. The
     * runtime only lists commands per session, so this opens a throwaway one — no message is
     * sent, so it costs no requests — and caches the answer for a few minutes.
     */
    public List<CommandInfo> defaultCatalog() {
        synchronized (catalogLock) {
            if (catalog != null && System.nanoTime() - catalogFetchedAt < CATALOG_TTL_NANOS) {
                return catalog;
            }
            catalog = fetchDefaultCatalog();
            catalogFetchedAt = System.nanoTime();
            return catalog;
        }
    }

    private List<CommandInfo> fetchDefaultCatalog() {
        CopilotClient client = clientManager.client();
        String model = configFactory.defaultModel();
        SessionConfig config = new SessionConfig()
                .setModel(model)
                .setWorkingDirectory(sessionService.resolveWorkingDirectory(null))
                .setOnPermissionRequest((request, invocation) ->
                        CompletableFuture.completedFuture(PermissionRequestResult.userNotAvailable()));
        ProviderConfig provider = configFactory.providerFor(model);
        if (provider != null) {
            config.setProvider(provider);
        }
        if (properties.isConfigDiscovery()) {
            config.setEnableConfigDiscovery(true);
        }

        CopilotSession probe = await(client.createSession(config), 120);
        try {
            return visible(listRaw(probe));
        } finally {
            String runtimeId = probe.getSessionId();
            try {
                probe.close();
            } catch (Exception ex) {
                log.debug("Closing the catalog session failed: {}", ex.toString());
            }
            // Otherwise every catalog refresh would leave an empty conversation in the history.
            try {
                client.deleteSession(runtimeId).get(15, TimeUnit.SECONDS);
            } catch (Exception ex) {
                log.debug("Deleting the catalog session failed: {}", ex.toString());
            }
        }
    }

    /** The commands a live conversation has right now, including skills from its folder. */
    public List<CommandInfo> sessionCatalog(String sessionId) {
        return visible(listRaw(sessionService.requireSession(sessionId).getSession()));
    }

    private List<JsonNode> listRaw(CopilotSession session) {
        SessionCommandsListResult result = await(session.getRpc().commands.list(
                new SessionCommandsListParams(session.getSessionId(), true, true, false)));
        List<JsonNode> out = new ArrayList<>();
        if (result != null && result.commands() != null) {
            for (SlashCommandInfo info : result.commands()) {
                out.add(objectMapper.valueToTree(info));
            }
        }
        return out;
    }

    private List<CommandInfo> visible(List<JsonNode> raw) {
        return raw.stream()
                .map(this::toInfo)
                .filter(info -> StringUtils.hasText(info.name()))
                // Client commands are the terminal's own UI (pickers, dialogs); nothing to run here.
                .filter(info -> !"client".equals(info.kind()))
                .filter(info -> !policy.isHidden(info.name(), info.aliases()))
                .toList();
    }

    CommandInfo toInfo(JsonNode node) {
        String name = node.path("name").asText("");
        List<String> aliases = texts(node.path("aliases"));
        JsonNode input = node.path("input");
        List<Choice> choices = new ArrayList<>();
        for (JsonNode choice : input.path("choices")) {
            if (StringUtils.hasText(choice.path("name").asText(""))) {
                choices.add(new Choice(choice.path("name").asText(), text(choice, "description")));
            }
        }
        return new CommandInfo(
                name,
                aliases,
                text(node, "description"),
                text(input, "hint"),
                input.path("required").asBoolean(false),
                choices,
                text(input, "completion"),
                node.path("kind").asText("builtin").toLowerCase(Locale.ROOT),
                node.path("allowDuringAgentExecution").asBoolean(false),
                policy.needsConfirmation(name, aliases),
                node.path("schedulable").asBoolean(false),
                node.path("experimental").asBoolean(false));
    }

    // ---------------------------------------------------------------- invoke

    /**
     * Runs a runtime command. Returns as soon as it is accepted; the outcome arrives on the event
     * stream as {@code dashboard.command_result} and the work ends with a {@code dashboard.turn_end}
     * carrying the same {@code requestId}.
     *
     * <p>When the session is idle the command owns a turn, like a message: anything typed
     * meanwhile is refused. While a reply is streaming, only commands the runtime marks safe
     * mid-turn (such as {@code /context} or {@code /usage}) are accepted, and they run alongside.
     */
    public void invoke(String sessionId, String requestId, String requestedName, String input, boolean confirmed) {
        DashboardSession session = sessionService.requireSession(sessionId);
        String wanted = normaliseName(requestedName);
        if (!StringUtils.hasText(wanted)) {
            throw new IllegalArgumentException("Name the command to run, for example \"context\".");
        }

        CommandInfo command = listRaw(session.getSession()).stream()
                .map(this::toInfo)
                .filter(info -> !"client".equals(info.kind()))
                .filter(info -> matches(info, wanted))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "/" + wanted + " is not a command here. Type / to see what is available."));
        if (policy.isHidden(command.name(), command.aliases())) {
            throw new IllegalArgumentException(CORTEX_ALTERNATIVES.getOrDefault(command.name(),
                    "/" + command.name() + " is not available in Cortex."));
        }
        if (command.confirm() && !confirmed) {
            throw new SessionService.ConfirmationRequiredException(
                    "/" + command.name() + " can change files, settings or what runs without asking. Confirm to run it.");
        }

        String name = command.name();
        String argument = StringUtils.hasText(input) ? input.strip() : null;
        if (session.markBusy()) {
            ObjectNode start = sessionService.dashboardEvent("dashboard.turn_start");
            start.put("requestId", requestId);
            ObjectNode described = start.putObject("command");
            described.put("name", name);
            described.put("input", argument);
            session.broadcast(start);
            sessionService.submitTurn(session, requestId, () -> run(session, requestId, name, argument, true));
            return;
        }
        if (!command.allowDuringTurn()) {
            throw new SessionService.SessionBusyException(sessionId,
                    "/" + name + " can't run while a reply is in progress. Wait for it to finish, or stop it first.");
        }
        sessionService.submitBeside(session, requestId, () -> run(session, requestId, name, argument, false));
    }

    private void run(DashboardSession session, String requestId, String name, String input, boolean ownsTurn)
            throws Exception {
        CopilotSession runtime = session.getSession();
        ObjectNode result = sessionService.dashboardEvent("dashboard.command_result");
        result.put("requestId", requestId);
        result.put("command", name);

        SlashCommandInvocationResult raw;
        try {
            // Some commands — /fleet above all — hold the call open until their work is done.
            raw = runtime.getRpc().commands
                    .invoke(new SessionCommandsInvokeParams(runtime.getSessionId(), name, input, null))
                    .get(sessionService.turnTimeoutMs(), TimeUnit.MILLISECONDS);
        } catch (ExecutionException | TimeoutException ex) {
            result.put("kind", "error");
            result.put("error", ex instanceof TimeoutException
                    ? "/" + name + " did not finish in time."
                    : SessionService.rootMessage(ex));
            session.broadcast(result);
            return;
        }

        JsonNode tree = raw == null ? objectMapper.createObjectNode() : objectMapper.valueToTree(raw);
        String kind = raw == null ? "" : raw.getKind();
        if ("agent-prompt".equals(kind)) {
            String prompt = tree.path("prompt").asText("");
            if (!ownsTurn) {
                result.put("kind", "error");
                result.put("error", "/" + name + " starts new work for the agent, so it can't run while a reply is in progress.");
                session.broadcast(result);
                return;
            }
            String display = text(tree, "displayPrompt");
            if (display == null) {
                display = input == null ? "/" + name : "/" + name + " " + input;
            }
            String mode = text(tree, "mode");
            result.put("kind", "turn");
            result.put("displayPrompt", clip(display, MAX_TEXT));
            result.put("mode", mode);
            result.put("notice", text(tree, "notice"));
            session.broadcast(result);

            // The expanded prompt can be pages of instructions; it goes to the agent, not the page.
            MessageOptions options = new MessageOptions().setPrompt(prompt).setDisplayPrompt(display);
            if (mode != null) {
                options.setAgentMode(AgentMode.fromValue(mode));
            }
            sessionService.sendAndWait(session, options);
            return;
        }

        describe(name, kind, tree, result);
        session.broadcast(result);
    }

    /** Turns one invocation result into what the browser renders. Package-private for tests. */
    void describe(String name, String kind, JsonNode tree, ObjectNode out) {
        switch (kind) {
            case "text" -> {
                out.put("kind", "text");
                out.put("text", stripAnsi(tree.path("text").asText("")));
                out.put("markdown", tree.path("markdown").asBoolean(false));
            }
            case "completed" -> {
                out.put("kind", "completed");
                out.put("message", stripAnsi(tree.path("message").asText("Done.")));
                out.put("mode", text(tree, "mode"));
            }
            case "select-subcommand" -> {
                out.put("kind", "select");
                out.put("title", text(tree, "title"));
                out.put("command", tree.path("command").asText(name));
                ArrayNode options = out.putArray("options");
                for (JsonNode option : tree.path("options")) {
                    ObjectNode entry = options.addObject();
                    entry.put("name", option.path("name").asText(""));
                    entry.put("description", text(option, "description"));
                    entry.put("group", text(option, "group"));
                }
            }
            case "add-timeline-entry" -> {
                JsonNode entry = tree.path("entry");
                String text = stripAnsi(entry.path("text").asText(""));
                if ("error".equalsIgnoreCase(entry.path("type").asText(""))) {
                    out.put("kind", "error");
                    out.put("error", text);
                } else {
                    out.put("kind", "text");
                    out.put("text", text);
                    out.put("markdown", false);
                }
                out.put("url", text(entry, "url"));
                out.put("prefill", text(tree, "prefillInput"));
            }
            case "set-plan-model" -> {
                out.put("kind", "completed");
                String planModel = text(tree, "planModel");
                out.put("message", stripAnsi(tree.path("message").asText(
                        planModel == null ? "Plan model updated." : "Plan model set to " + planModel + ".")));
            }
            case "show-dialog", "set-model" -> {
                out.put("kind", "info");
                out.put("message", CORTEX_ALTERNATIVES.get("model"));
            }
            default -> {
                out.put("kind", "info");
                out.put("message", "/" + name + " finished, but Cortex can't show its \"" + kind + "\" result.");
            }
        }
    }

    static String stripAnsi(String text) {
        return text == null ? "" : ANSI.matcher(text).replaceAll("").replace("\r\n", "\n");
    }

    private static boolean matches(CommandInfo info, String wanted) {
        return info.name().equalsIgnoreCase(wanted)
                || info.aliases().stream().anyMatch(alias -> alias.equalsIgnoreCase(wanted));
    }

    private static String normaliseName(String name) {
        return name == null ? "" : name.strip().replaceFirst("^/", "").toLowerCase(Locale.ROOT);
    }

    // ---------------------------------------------------------------- /agent

    public Map<String, Object> agents(String sessionId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        List<AgentInfo> agents = await(runtime.listAgents());
        AgentInfo current = null;
        try {
            current = await(runtime.getCurrentAgent());
        } catch (RuntimeException ex) {
            log.debug("No current agent for {}: {}", sessionId, ex.toString());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("current", current == null ? null : current.getName());
        out.put("agents", agents == null ? List.of() : agents.stream().map(agent -> {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", agent.getName());
            entry.put("displayName", agent.getDisplayName());
            entry.put("description", agent.getDescription());
            entry.put("model", agent.getModel());
            return entry;
        }).toList());
        return out;
    }

    /** Switches the conversation to a custom agent, or back to the default one when name is blank. */
    public Map<String, Object> selectAgent(String sessionId, String name) {
        DashboardSession session = sessionService.requireSession(sessionId);
        requireIdle(session, "switch agents");
        CopilotSession runtime = session.getSession();
        if (!StringUtils.hasText(name)) {
            await(runtime.deselectAgent());
        } else {
            String wanted = name.strip();
            List<AgentInfo> agents = await(runtime.listAgents());
            boolean known = agents != null && agents.stream().anyMatch(agent -> wanted.equals(agent.getName()));
            if (!known) {
                throw new IllegalArgumentException("No agent named \"" + wanted + "\".");
            }
            await(runtime.selectAgent(wanted));
        }
        return agents(sessionId);
    }

    // ---------------------------------------------------------------- /rewind

    public Map<String, Object> rewindPoints(String sessionId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().history.listRewindPoints()));
        String reason = lower(text(tree, "unavailableReason"));
        List<Map<String, Object>> points = new ArrayList<>();
        for (JsonNode point : tree.path("points")) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("eventId", text(point, "eventId"));
            entry.put("userMessage", clip(text(point, "userMessage"), MAX_FIELD));
            entry.put("timestamp", text(point, "timestamp"));
            entry.put("autopilot", point.path("isAutopilotContinuation").asBoolean(false));
            points.add(entry);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        // Cortex rewinds the conversation only, so file tracking being off does not block it.
        out.put("available", reason == null || "file-change-tracking-disabled".equals(reason));
        out.put("reason", reason);
        out.put("points", points);
        return out;
    }

    /**
     * Rewinds the conversation to just before the given prompt: that prompt and everything after
     * it are forgotten. Files on disk are left alone.
     */
    public Map<String, Object> rewind(String sessionId, String eventId) {
        DashboardSession session = sessionService.requireSession(sessionId);
        requireIdle(session, "rewind");
        CopilotSession runtime = session.getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().history.rewind(
                new SessionHistoryRewindParams(runtime.getSessionId(), eventId, HistoryRewindMode.CONVERSATION))));
        String outcome = lower(text(tree, "outcome"));
        if (!"success".equals(outcome)) {
            String error = text(tree, "error");
            throw new IllegalArgumentException("Could not rewind (" + outcome + ")"
                    + (error == null ? "." : ": " + error));
        }
        session.clearReplayBuffer();
        ObjectNode rewound = sessionService.dashboardEvent("dashboard.rewound");
        rewound.put("eventId", eventId);
        session.broadcast(rewound);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("outcome", outcome);
        out.put("eventsRemoved", tree.path("eventsRemoved").asLong(0));
        return out;
    }

    // ---------------------------------------------------------------- /tasks

    /**
     * Background work the agent started — sub-agents and shell commands. Each task's fields are
     * copied generically, long text clipped and nested objects dropped, so a runtime that adds a
     * field shows it without a code change and one with a huge transcript does not flood the page.
     */
    public List<Map<String, Object>> tasks(String sessionId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().tasks.list()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode task : tree.path("tasks")) {
            out.add(flatten(task));
        }
        return out;
    }

    public Map<String, Object> cancelTask(String sessionId, String taskId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(
                await(runtime.getRpc().tasks.cancel(new SessionTasksCancelParams(runtime.getSessionId(), taskId))));
        return Map.of("cancelled", tree.path("cancelled").asBoolean(false));
    }

    // ---------------------------------------------------------------- /instructions

    /** Instruction files in effect: where each comes from and how big it is, never the text itself. */
    public List<Map<String, Object>> instructions(String sessionId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().instructions.getSources()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode source : tree.path("sources")) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", text(source, "id"));
            entry.put("label", text(source, "label"));
            entry.put("sourcePath", text(source, "sourcePath"));
            entry.put("type", lower(text(source, "type")));
            entry.put("location", lower(text(source, "location")));
            entry.put("applyTo", texts(source.path("applyTo")));
            entry.put("description", clip(text(source, "description"), MAX_FIELD));
            entry.put("defaultDisabled", source.path("defaultDisabled").asBoolean(false));
            entry.put("chars", source.path("content").asText("").length());
            out.add(entry);
        }
        return out;
    }

    // ---------------------------------------------------------------- /every, /after

    public List<Map<String, Object>> schedules(String sessionId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().schedule.list()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode entry : tree.path("entries")) {
            out.add(flatten(entry));
        }
        return out;
    }

    public Map<String, Object> stopSchedule(String sessionId, long scheduleId) {
        CopilotSession runtime = sessionService.requireSession(sessionId).getSession();
        JsonNode tree = objectMapper.valueToTree(await(runtime.getRpc().schedule.stop(
                new SessionScheduleStopParams(runtime.getSessionId(), scheduleId))));
        if (tree.path("entry").isMissingNode() || tree.path("entry").isNull()) {
            throw new IllegalArgumentException("No scheduled prompt #" + scheduleId + ".");
        }
        return Map.of("stopped", true, "id", scheduleId);
    }

    // ---------------------------------------------------------------- /version

    public Map<String, Object> version() {
        Map<String, Object> out = new LinkedHashMap<>();
        String appVersion = CommandService.class.getPackage().getImplementationVersion();
        out.put("app", Map.of("name", "Cortex", "version", appVersion == null ? "dev" : appVersion));
        Map<String, Object> sdk = new LinkedHashMap<>();
        sdk.put("version", sdkVersion());
        out.put("sdk", sdk);
        Map<String, Object> cli = new LinkedHashMap<>();
        try {
            GetStatusResponse status = clientManager.client().getStatus().get(RPC_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            cli.put("version", status.getVersion());
            cli.put("protocolVersion", status.getProtocolVersion());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            cli.put("error", "Interrupted");
        } catch (Exception ex) {
            cli.put("error", SessionService.rootMessage(ex));
        }
        out.put("cli", cli);
        out.put("java", System.getProperty("java.version"));
        return out;
    }

    private static String sdkVersion() {
        try (InputStream in = CopilotClient.class.getResourceAsStream(SDK_POM)) {
            if (in == null) {
                return null;
            }
            Properties pom = new Properties();
            pom.load(in);
            return pom.getProperty("version");
        } catch (IOException ex) {
            return null;
        }
    }

    // ---------------------------------------------------------------- helpers

    private void requireIdle(DashboardSession session, String action) {
        if (session.isBusy()) {
            throw new SessionService.SessionBusyException(session.getId(),
                    "Can't " + action + " while a reply is in progress. Wait for it to finish, or stop it first.");
        }
    }

    private <T> T await(CompletableFuture<T> future) {
        return await(future, RPC_TIMEOUT_SECONDS);
    }

    private <T> T await(CompletableFuture<T> future, long seconds) {
        try {
            return future.get(seconds, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for the Copilot runtime", ex);
        } catch (TimeoutException ex) {
            throw new IllegalStateException("The Copilot runtime did not answer in time.");
        } catch (ExecutionException ex) {
            // The runtime refused the request; its own message says why.
            throw new IllegalArgumentException(SessionService.rootMessage(ex));
        }
    }

    private Map<String, Object> flatten(JsonNode node) {
        Map<String, Object> out = new LinkedHashMap<>();
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            JsonNode value = field.getValue();
            if (value.isTextual()) {
                out.put(field.getKey(), clip(value.asText(), MAX_FIELD));
            } else if (value.isNumber()) {
                out.put(field.getKey(), value.numberValue());
            } else if (value.isBoolean()) {
                out.put(field.getKey(), value.asBoolean());
            }
        }
        return out;
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode item : array) {
            if (item.isTextual() && StringUtils.hasText(item.asText())) {
                out.add(item.asText());
            }
        }
        return out;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static String lower(String value) {
        return value == null ? null : value.toLowerCase(Locale.ROOT);
    }

    static String clip(String value, int max) {
        if (value == null || value.length() <= max) {
            return value;
        }
        return value.substring(0, max) + "…";
    }
}
