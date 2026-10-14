package dev.jeswin.copilotdashboard.web;

import dev.jeswin.copilotdashboard.copilot.CommandService;
import dev.jeswin.copilotdashboard.copilot.CommandService.CommandInfo;
import dev.jeswin.copilotdashboard.web.dto.InvokeCommandRequest;
import dev.jeswin.copilotdashboard.web.dto.RewindRequest;
import dev.jeswin.copilotdashboard.web.dto.SelectAgentRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The runtime's slash commands and the session views behind Cortex's own command cards. */
@RestController
@RequestMapping("/api")
public class CommandController {

    private final CommandService commandService;

    public CommandController(CommandService commandService) {
        this.commandService = commandService;
    }

    @GetMapping("/commands")
    public List<CommandInfo> catalog() {
        return commandService.defaultCatalog();
    }

    @GetMapping("/sessions/{id}/commands")
    public List<CommandInfo> sessionCatalog(@PathVariable String id) {
        return commandService.sessionCatalog(id);
    }

    @PostMapping("/sessions/{id}/commands")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void invoke(@PathVariable String id, @Valid @RequestBody InvokeCommandRequest request) {
        commandService.invoke(id, request.requestId(), request.name(), request.input(),
                Boolean.TRUE.equals(request.confirmed()));
    }

    @GetMapping("/sessions/{id}/agents")
    public Map<String, Object> agents(@PathVariable String id) {
        return commandService.agents(id);
    }

    @PostMapping("/sessions/{id}/agent")
    public Map<String, Object> selectAgent(@PathVariable String id,
            @RequestBody(required = false) SelectAgentRequest request) {
        return commandService.selectAgent(id, request == null ? null : request.name());
    }

    @GetMapping("/sessions/{id}/rewind")
    public Map<String, Object> rewindPoints(@PathVariable String id) {
        return commandService.rewindPoints(id);
    }

    @PostMapping("/sessions/{id}/rewind")
    public Map<String, Object> rewind(@PathVariable String id, @Valid @RequestBody RewindRequest request) {
        return commandService.rewind(id, request.eventId());
    }

    @GetMapping("/sessions/{id}/tasks")
    public List<Map<String, Object>> tasks(@PathVariable String id) {
        return commandService.tasks(id);
    }

    @PostMapping("/sessions/{id}/tasks/{taskId}/cancel")
    public Map<String, Object> cancelTask(@PathVariable String id, @PathVariable String taskId) {
        return commandService.cancelTask(id, taskId);
    }

    @GetMapping("/sessions/{id}/instructions")
    public List<Map<String, Object>> instructions(@PathVariable String id) {
        return commandService.instructions(id);
    }

    @GetMapping("/sessions/{id}/schedules")
    public List<Map<String, Object>> schedules(@PathVariable String id) {
        return commandService.schedules(id);
    }

    @PostMapping("/sessions/{id}/schedules/{scheduleId}/stop")
    public Map<String, Object> stopSchedule(@PathVariable String id, @PathVariable long scheduleId) {
        return commandService.stopSchedule(id, scheduleId);
    }

    @GetMapping("/version")
    public Map<String, Object> version() {
        return commandService.version();
    }
}
