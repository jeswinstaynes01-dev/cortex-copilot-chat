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
    private final AtomicBoolean busy = new AtomicBoolean(false);

    private volatile String title;
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
        return busy.get();
    }

    public boolean markBusy() {
        return busy.compareAndSet(false, true);
    }

    public void markIdle() {
        busy.set(false);
    }

    public Map<String, PendingPermission> getPendingPermissions() {
        return pendingPermissions;
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
