package dev.jeswin.copilotdashboard.history;

import dev.jeswin.copilotdashboard.copilot.QuotaService;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Past conversations and month-to-date spend, read out of the Copilot CLI's own store.
 *
 * <p>Deliberately separate from {@code SessionController}: that one owns <i>live</i> agent sessions
 * you can talk to, this one owns <i>archived</i> ones you can only read. They share an id space but
 * nothing else, and merging them would blur a distinction the UI has to show the user anyway.
 */
@RestController
public class HistoryController {

    private final HistoryStore store;
    private final QuotaService quotaService;

    public HistoryController(HistoryStore store, QuotaService quotaService) {
        this.store = store;
        this.quotaService = quotaService;
    }

    @GetMapping("/api/history")
    public List<Map<String, Object>> history(@RequestParam(defaultValue = "60") int limit) {
        return store.sessions(limit);
    }

    @GetMapping("/api/history/{id}")
    public List<Map<String, Object>> turns(@PathVariable String id) {
        return store.turns(id);
    }

    /**
     * Month-to-date usage. The used and budget figures come from the account's real quota when
     * GitHub answers ({@code source: "account"}), otherwise from the session-store estimate
     * ({@code source: "estimate"}); the per-model breakdown is always the local one.
     */
    @GetMapping("/api/usage")
    public Map<String, Object> usage() {
        return QuotaService.applyTo(store.usage(), quotaService.current());
    }
}
