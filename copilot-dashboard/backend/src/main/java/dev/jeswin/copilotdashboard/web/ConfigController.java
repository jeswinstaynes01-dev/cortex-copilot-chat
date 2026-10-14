package dev.jeswin.copilotdashboard.web;

import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.copilot.SessionConfigFactory;
import dev.jeswin.copilotdashboard.copilot.SessionService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/config")
public class ConfigController {

    private final CopilotProperties properties;
    private final SessionService sessionService;
    private final SessionConfigFactory configFactory;

    public ConfigController(CopilotProperties properties, SessionService sessionService,
            SessionConfigFactory configFactory) {
        this.properties = properties;
        this.sessionService = sessionService;
        this.configFactory = configFactory;
    }

    /**
     * Everything the browser needs to start a chat. A {@link LinkedHashMap} because
     * {@code defaultPersona} and {@code provider} are legitimately null, which {@code Map.of}
     * rejects. Nothing secret is in here: the provider key is only reported as present or not.
     */
    @GetMapping
    public Map<String, Object> config() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("defaultModel", configFactory.defaultModel());
        out.put("defaultWorkingDirectory", properties.getDefaultWorkingDirectory());
        out.put("permissionTimeoutSeconds", properties.getPermissionTimeoutSeconds());
        out.put("turnTimeoutSeconds", properties.getTurnTimeoutSeconds());
        out.put("models", sessionService.listModels());
        out.put("personas", configFactory.personaSummaries());
        out.put("defaultPersona", configFactory.defaultPersona());
        out.put("mcpServers", configFactory.mcpSummaries());
        out.put("provider", configFactory.providerSummary());
        return out;
    }

    /**
     * Checks a candidate working directory and reports the absolute path it
     * resolves to.
     *
     * <p>Answers with 200 and {@code ok: false} rather than a 4xx, because a
     * path the user is still typing is not a client error — it is the normal,
     * expected state of a half-finished input, and treating it as a failure
     * would put red errors in the console on every keystroke.
     *
     * <p>Returns the resolved path so the caller can show what it actually
     * committed to: {@code ..} and {@code ~\projects} are useful to type and
     * misleading to display back unchanged.
     *
     * <p>This reports existence only. It deliberately does not list contents —
     * the agent reads files because the user asked it to and every such read
     * goes through the permission prompt, whereas a listing endpoint would be
     * a way to read the disk with nobody watching.
     */
    @GetMapping("/working-directory")
    public Map<String, Object> workingDirectory(@RequestParam(name = "path", required = false) String path) {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            out.put("ok", true);
            out.put("resolved", sessionService.resolveWorkingDirectory(path));
            out.put("error", null);
        } catch (IllegalArgumentException ex) {
            out.put("ok", false);
            out.put("resolved", null);
            out.put("error", ex.getMessage());
        }
        return out;
    }
}
