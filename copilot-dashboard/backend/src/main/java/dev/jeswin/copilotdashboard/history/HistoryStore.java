package dev.jeswin.copilotdashboard.history;

import dev.jeswin.copilotdashboard.config.CopilotProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Read-only window onto the Copilot CLI's own session store.
 *
 * <p>The agent sessions this service creates are in-memory and die with the JVM. The CLI, by
 * contrast, keeps every conversation it has ever had in a SQLite file, along with a usage row for
 * every single model request. That file is the only place real history and real spend exist, so we
 * read it directly.
 *
 * <p>Three rules govern everything here:
 *
 * <ul>
 *   <li><b>Never write.</b> Connections are opened with {@code open_mode=1} (SQLITE_OPEN_READONLY).
 *       The CLI owns this file and may be running concurrently; corrupting a user's entire history
 *       to render a sidebar would be an appalling trade.
 *   <li><b>Never fail the request.</b> The file may be absent, locked, or on a schema we do not
 *       recognise. Every method degrades to an empty result and logs, because a missing history
 *       list should not take down a chat UI that is otherwise working perfectly.
 *   <li><b>Open per call, close immediately.</b> These endpoints are polled rarely and the file is
 *       small. Holding a long-lived handle on a database another process owns buys nothing and
 *       risks lock contention.
 * </ul>
 */
@Component
public class HistoryStore {

    private static final Logger log = LoggerFactory.getLogger(HistoryStore.class);

    /**
     * How many leading characters decide whether a title is the opening message echoed back.
     * Long enough that two genuinely different strings cannot collide, short enough to survive the
     * trailing punctuation and whitespace differences the CLI introduces when it stores a title.
     */
    private static final int ECHO_COMPARE_CHARS = 28;

    /** An echo-titled session with fewer turns than this never became a conversation. */
    private static final int PROBE_TURNS = 3;

    /** An echo title shorter than this is a greeting — "Hi", "Hi hello there!" — not a subject. */
    private static final int PROBE_TITLE_CHARS = 20;

    private final CopilotProperties properties;

    /**
     * Collapses newlines and runs of whitespace into single spaces, and trims the result.
     *
     * <p>A title that was never generated is the opening message verbatim, and a pasted brief
     * carries its paragraph breaks with it. The sidebar renders titles on one line, so those
     * breaks arrive as either stray gaps or a row that silently grows taller than its neighbours.
     * Flattening here keeps the fix in one place instead of in every consumer's CSS.
     */
    private static String tidy(String s) {
        return s == null ? null : s.replaceAll("\\s+", " ").trim();
    }

    public HistoryStore(CopilotProperties properties) {
        this.properties = properties;
    }

    private Connection open() throws SQLException {        Path db = Path.of(properties.getHistoryDbPath());
        if (!Files.isReadable(db)) {
            throw new SQLException("session store not readable at " + db);
        }
        // open_mode=1 is SQLITE_OPEN_READONLY. Without it the driver would happily create
        // a journal file next to a database this process has no business modifying.
        return DriverManager.getConnection("jdbc:sqlite:" + db + "?open_mode=1");
    }

    /**
     * Past conversations, newest first, with throwaway probes filtered out.
     *
     * <p>Three kinds of row are skipped.
     *
     * <p>A session with <b>no summary</b> is one the CLI opened and then abandoned before the
     * first message — the record exists, the conversation does not. A session with <b>zero
     * turns</b> is the same story one step later. Both would render as a clickable row that opens
     * onto nothing.
     *
     * <p>The third is subtler, and worth explaining because it is the only heuristic in this
     * class. The CLI writes a short generated title once a conversation has enough substance to
     * summarise — "Update User Interface", "Clone Bitbucket Repository". Until then the summary is
     * just the opening message copied verbatim. So a summary that is still the first message
     * echoed back marks a session that never became a conversation: a scripted probe, a one-line
     * smoke test, a "hi" typed to see if the wiring works. Those are the rows that bury real work.
     *
     * <p>An echoed title is not enough on its own, because a long-running conversation that opened
     * with a big pasted brief keeps that brief as its title forever — a 111-turn mentoring session
     * here does exactly that, and hiding it would be a serious bug. So an echo is only treated as a
     * probe when the conversation is also <b>short</b> (under {@value #PROBE_TURNS} turns) or the
     * title is a bare greeting (under {@value #PROBE_TITLE_CHARS} characters). Both tests have to
     * agree that there is nothing here worth keeping.
     *
     * <p>This hides rows; it never deletes them. The database belongs to the CLI and is opened
     * read-only. Loosen the two constants below and everything comes straight back.
     */
    public List<Map<String, Object>> sessions(int limit) {
        String sql =
                """
                WITH scored AS (
                  SELECT s.id, s.cwd, s.repository, s.branch, s.summary,
                         s.created_at, s.updated_at,
                         (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turns,
                         LOWER(TRIM(s.summary)) AS norm_title,
                         LOWER(TRIM(COALESCE((SELECT t.user_message FROM turns t
                                               WHERE t.session_id = s.id
                                               ORDER BY t.turn_index LIMIT 1), ''))) AS norm_first
                    FROM sessions s
                   WHERE s.summary IS NOT NULL AND TRIM(s.summary) <> ''
                )
                SELECT id, cwd, repository, branch, summary, created_at, updated_at, turns
                  FROM scored
                 WHERE turns > 0
                   AND NOT (
                         norm_first <> ''
                     AND substr(norm_first, 1, MIN(?, length(norm_title)))
                       = substr(norm_title, 1, ?)
                     AND (turns < ? OR length(norm_title) < ?)
                   )
                 ORDER BY COALESCE(updated_at, created_at) DESC
                 LIMIT ?
                """;
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = open();
                PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, ECHO_COMPARE_CHARS);
            ps.setInt(2, ECHO_COMPARE_CHARS);
            ps.setInt(3, PROBE_TURNS);
            ps.setInt(4, PROBE_TITLE_CHARS);
            ps.setInt(5, Math.max(1, Math.min(limit, 200)));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("title", tidy(rs.getString("summary")));
                    row.put("workingDirectory", rs.getString("cwd"));
                    row.put("repository", rs.getString("repository"));
                    row.put("branch", rs.getString("branch"));
                    row.put("createdAt", rs.getString("created_at"));
                    row.put("updatedAt", rs.getString("updated_at"));
                    row.put("turns", rs.getInt("turns"));
                    out.add(row);
                }
            }
        } catch (SQLException e) {
            log.warn("could not read session history: {}", e.getMessage());
        }
        return out;
    }

    /** The full back-and-forth of one past conversation, oldest turn first. */
    public List<Map<String, Object>> turns(String sessionId) {
        String sql =
                """
                SELECT turn_index, user_message, assistant_response, timestamp
                  FROM turns
                 WHERE session_id = ?
                 ORDER BY turn_index
                """;
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = open();
                PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, sessionId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("index", rs.getInt("turn_index"));
                    row.put("user", rs.getString("user_message"));
                    row.put("assistant", rs.getString("assistant_response"));
                    row.put("timestamp", rs.getString("timestamp"));
                    out.add(row);
                }
            }
        } catch (SQLException e) {
            log.warn("could not read turns for {}: {}", sessionId, e.getMessage());
        }
        return out;
    }

    /**
     * Month-to-date spend across every session the CLI has run, plus the model and effort of the
     * most recent request.
     *
     * <p>"Spend" is the sum of {@code request_multiplier}, not a count of requests and not a count
     * of tokens. GitHub bills premium requests by multiplier: a cheap model costs 1 per request
     * while Opus at max effort costs 15, so 100 requests can cost anything between 100 and 1500.
     * Summing the multiplier is the only figure that matches the number on the billing page.
     *
     * <p>Timestamps in this table are ISO-8601 UTC strings, so a {@code LIKE 'YYYY-MM%'} prefix
     * match is both correct and index-friendly — far cheaper than parsing every row in Java.
     */
    public Map<String, Object> usage() {
        String prefix = YearMonth.now(ZoneOffset.UTC) + "%";

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("month", YearMonth.now(ZoneOffset.UTC).toString());
        out.put("budget", properties.getMonthlyPremiumBudget());
        out.put("used", 0L);
        out.put("requests", 0);
        out.put("sessions", 0);
        out.put("tokens", 0L);
        out.put("model", null);
        out.put("effort", null);
        out.put("models", List.of());
        out.put("available", false);

        String totals =
                """
                SELECT COALESCE(SUM(request_multiplier), 0)           AS used,
                       COUNT(*)                                       AS requests,
                       COUNT(DISTINCT session_id)                     AS sessions,
                       COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
                  FROM assistant_usage_events
                 WHERE created_at LIKE ?
                """;
        String latest =
                """
                SELECT model, reasoning_effort
                  FROM assistant_usage_events
                 ORDER BY created_at DESC
                 LIMIT 1
                """;
        // Per-model spend, plus the effort that model most recently ran at. The effort comes from
        // the newest row for that model rather than the commonest, because the UI uses it to label
        // what is happening *now*, and a model's effort can change between turns.
        String perModel =
                """
                SELECT model,
                       SUM(request_multiplier) AS used,
                       COUNT(*)                AS requests,
                       (SELECT e.reasoning_effort
                          FROM assistant_usage_events e
                         WHERE e.model = a.model
                         ORDER BY e.created_at DESC
                         LIMIT 1)               AS effort
                  FROM assistant_usage_events a
                 WHERE a.created_at LIKE ?
                 GROUP BY a.model
                 ORDER BY used DESC
                """;

        try (Connection c = open()) {
            try (PreparedStatement ps = c.prepareStatement(totals)) {
                ps.setString(1, prefix);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        out.put("used", rs.getLong("used"));
                        out.put("requests", rs.getInt("requests"));
                        out.put("sessions", rs.getInt("sessions"));
                        out.put("tokens", rs.getLong("tokens"));
                    }
                }
            }
            try (PreparedStatement ps = c.prepareStatement(latest);
                    ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    out.put("model", rs.getString("model"));
                    out.put("effort", rs.getString("reasoning_effort"));
                }
            }
            List<Map<String, Object>> models = new ArrayList<>();
            try (PreparedStatement ps = c.prepareStatement(perModel)) {
                ps.setString(1, prefix);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        Map<String, Object> row = new LinkedHashMap<>();
                        row.put("model", rs.getString("model"));
                        row.put("effort", rs.getString("effort"));
                        row.put("used", rs.getLong("used"));
                        row.put("requests", rs.getInt("requests"));
                        models.add(row);
                    }
                }
            }
            out.put("models", models);
            out.put("available", true);
        } catch (SQLException e) {
            log.warn("could not read usage: {}", e.getMessage());
        }
        return out;
    }
}
