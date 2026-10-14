package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.copilot.CopilotSession;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * One dashboard conversation: the underlying agent session plus everything the browser needs.
 *
 * <p>Fan-out model: the SDK pushes events on a runtime thread, this class copies each event to every
 * connected {@link SseEmitter} and keeps a bounded replay buffer so a refreshed tab can catch up.
 */
public class DashboardSession {

    private static final Logger log = LoggerFactory.getLogger(DashboardSession.class);

    private final String id;
    private final CopilotSession session;
    private final String model;
    private final String workingDirectory;
    private final boolean autoApprove;
    /**
     * The reasoning effort this session was actually created with, or null when the model was
     * left to choose. Final, because the runtime fixes it at session creation — changing it means
     * dropping the session and making a new one.
     */
    private final String reasoningEffort;
    /** Persona id applied at creation (its prompt is part of the system message), or null. */
    private final String persona;
    private final int historyLimit;
    private final Instant createdAt = Instant.now();

    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();
    private final Deque<JsonNode> history = new ArrayDeque<>();
    private final Map<String, PendingPermission> pendingPermissions = new ConcurrentHashMap<>();
    private final Map<String, PendingPlanReview> pendingPlanReviews = new ConcurrentHashMap<>();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    /**
     * Set while the runtime runs a turn nobody here asked for — a scheduled prompt firing. It
     * counts as busy, so a message typed meanwhile is refused instead of colliding with it.
     */
    private final AtomicReference<String> externalTurn = new AtomicReference<>();

    private volatile String title;
    private volatile String mode = "interactive";
    private volatile Instant lastActivityAt = Instant.now();

    public DashboardSession(String id, CopilotSession session, String model, String workingDirectory,
            boolean autoApprove, String reasoningEffort, String persona, int historyLimit) {
        this.id = id;
        this.session = session;
        this.model = model;
        this.workingDirectory = workingDirectory;
        this.autoApprove = autoApprove;
        this.reasoningEffort = reasoningEffort;
        this.persona = persona;
        this.historyLimit = historyLimit;
        this.title = "New conversation";
    }

    public String getId() {
        return id;
    }

    public CopilotSession getSession() {
        return session;
    }

    public String getModel() {
        return model;
    }

    public String getReasoningEffort() {
        return reasoningEffort;
    }

    public String getPersona() {
        return persona;
    }

    public String getWorkingDirectory() {
        return workingDirectory;
    }

    public boolean isAutoApprove() {
        return autoApprove;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastActivityAt() {
        return lastActivityAt;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public boolean isBusy() {
        return busy.get() || externalTurn.get() != null;
    }

    public boolean markBusy() {
        return externalTurn.get() == null && busy.compareAndSet(false, true);
    }

    public void markIdle() {
        busy.set(false);
    }

    /**
     * Claims the session for a turn the runtime started on its own. Normally refused while one of
     * ours is running, since anything the runtime does then belongs to that turn; {@code evenIfBusy}
     * is for prompts known to open a turn of their own, such as a schedule firing.
     */
    public boolean beginExternalTurn(String turnId, boolean evenIfBusy) {
        return (evenIfBusy || !busy.get()) && externalTurn.compareAndSet(null, turnId);
    }

    /** Releases a runtime-started turn, returning its id, or null when none was running. */
    public String endExternalTurn() {
        return externalTurn.getAndSet(null);
    }

    public String getExternalTurn() {
        return externalTurn.get();
    }

    /** The runtime's agent mode as last reported: {@code interactive}, {@code plan} or {@code autopilot}. */
    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public Map<String, PendingPermission> getPendingPermissions() {
        return pendingPermissions;
    }

    public Map<String, PendingPlanReview> getPendingPlanReviews() {
        return pendingPlanReviews;
    }

    public void touch() {
        lastActivityAt = Instant.now();
    }

    public void addEmitter(SseEmitter emitter) {
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(ex -> emitters.remove(emitter));
    }

    /** Snapshot of buffered events, used to replay state into a newly connected browser. */
    public List<JsonNode> replayBuffer() {
        synchronized (history) {
            return new ArrayList<>(history);
        }
    }

    /**
     * Forgets buffered events. Used after a rewind: replaying events from turns the runtime has
     * just thrown away would bring them back on the next reconnect.
     */
    public void clearReplayBuffer() {
        synchronized (history) {
            history.clear();
        }
    }

    /** Records an event in the replay buffer and pushes it to every connected browser. */
    public void broadcast(JsonNode event) {
        synchronized (history) {
            history.addLast(event);
            while (history.size() > historyLimit) {
                history.removeFirst();
            }
        }
        touch();
        send(event);
    }

    /** Pushes an event to connected browsers without recording it in the replay buffer. */
    public void send(JsonNode event) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("copilot").data(event));
            } catch (IOException | IllegalStateException ex) {
                // The browser went away mid-write; drop this subscriber and keep serving the rest.
                emitters.remove(emitter);
                emitter.complete();
            } catch (RuntimeException ex) {
                log.debug("Dropping SSE subscriber for session {}: {}", id, ex.toString());
                emitters.remove(emitter);
            }
        }
    }

    public void closeEmitters() {
        for (SseEmitter emitter : emitters) {
            emitter.complete();
        }
        emitters.clear();
    }
}
