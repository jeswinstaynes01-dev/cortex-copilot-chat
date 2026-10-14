package dev.jeswin.copilotdashboard.web;

import dev.jeswin.copilotdashboard.copilot.SessionService;
import jakarta.validation.Valid;
import dev.jeswin.copilotdashboard.web.dto.CreateSessionRequest;
import dev.jeswin.copilotdashboard.web.dto.PermissionDecisionRequest;
import dev.jeswin.copilotdashboard.web.dto.SendMessageRequest;
import dev.jeswin.copilotdashboard.web.dto.SessionSummary;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final SessionService sessionService;

    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @GetMapping
    public List<SessionSummary> list() {
        return sessionService.listSessions().stream().map(SessionSummary::from).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionSummary create(@RequestBody(required = false) CreateSessionRequest request) {
        CreateSessionRequest safe = request == null
                ? new CreateSessionRequest(null, null, null, null, null)
                : request;
        boolean autoApprove = Boolean.TRUE.equals(safe.autoApprove());
        return SessionSummary.from(sessionService.createSession(
                safe.model(), safe.workingDirectory(), autoApprove, safe.reasoningEffort(), safe.persona()));
    }

    @GetMapping("/{id}")
    public SessionSummary get(@PathVariable String id) {
        return SessionSummary.from(sessionService.requireSession(id));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        sessionService.deleteSession(id);
    }

    @GetMapping(value = "/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String id) {
        return sessionService.subscribe(id);
    }

    @PostMapping("/{id}/messages")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void sendMessage(@PathVariable String id, @Valid @RequestBody SendMessageRequest request) {
        sessionService.sendMessage(id, request.prompt());
    }

    @PostMapping("/{id}/abort")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void abort(@PathVariable String id) {
        sessionService.abortTurn(id);
    }

    @PostMapping("/{id}/permissions/{requestId}")
    public ResponseEntity<Void> decidePermission(@PathVariable String id, @PathVariable String requestId,
            @Valid @RequestBody PermissionDecisionRequest request) {
        sessionService.resolvePermission(id, requestId, request.decision(), request.feedback());
        return ResponseEntity.noContent().build();
    }
}
