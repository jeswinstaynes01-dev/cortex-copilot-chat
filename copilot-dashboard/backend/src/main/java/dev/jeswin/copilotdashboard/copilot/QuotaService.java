package dev.jeswin.copilotdashboard.copilot;

import com.github.copilot.generated.rpc.AccountGetQuotaResult;
import com.github.copilot.generated.rpc.AccountQuotaSnapshot;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The account's real premium-request quota, as GitHub reports it.
 *
 * <p>The session-store figure in {@code HistoryStore} is only an estimate: it misses requests made
 * from other machines and editors, and its budget is whatever was typed into the config. This asks
 * the runtime for the authoritative numbers instead, and falls back to the estimate when it cannot
 * (not signed in, offline, or using only your own model).
 */
@Service
public class QuotaService {

    private static final Logger log = LoggerFactory.getLogger(QuotaService.class);

    static final String PREMIUM_KEY = "premium_interactions";
    private static final long CACHE_NANOS = TimeUnit.SECONDS.toNanos(60);

    private final CopilotClientManager clientManager;
    private final Object lock = new Object();
    private Optional<Quota> cached = Optional.empty();
    private long fetchedAt;
    private boolean fetched;

    public QuotaService(CopilotClientManager clientManager) {
        this.clientManager = clientManager;
    }

    /**
     * Premium-request quota for the signed-in account, or empty when it is unavailable.
     *
     * <p>Cached for a minute — failures included — because the status card polls and a quota
     * moves by one request at a time; a round trip to GitHub on every poll would buy nothing.
     */
    public Optional<Quota> current() {
        synchronized (lock) {
            long now = System.nanoTime();
            if (fetched && now - fetchedAt < CACHE_NANOS) {
                return cached;
            }
            cached = fetch();
            fetchedAt = System.nanoTime();
            fetched = true;
            return cached;
        }
    }

    private Optional<Quota> fetch() {
        try {
            AccountGetQuotaResult result =
                    clientManager.client().getRpc().account.getQuota().get(15, TimeUnit.SECONDS);
            Optional<Quota> quota = fromResult(result, Instant.now());
            if (quota.isEmpty()) {
                log.debug("Account quota had no premium snapshot: {}",
                        result == null ? "no result" : result.quotaSnapshots());
            }
            return quota;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (Exception ex) {
            log.debug("Account quota unavailable, using the local estimate: {}", ex.toString());
            return Optional.empty();
        }
    }

    /** Picks the premium-request snapshot out of the runtime's answer. */
    static Optional<Quota> fromResult(AccountGetQuotaResult result, Instant now) {
        if (result == null || result.quotaSnapshots() == null || result.quotaSnapshots().isEmpty()) {
            return Optional.empty();
        }
        Map<String, AccountQuotaSnapshot> snapshots = result.quotaSnapshots();
        AccountQuotaSnapshot snapshot = snapshots.get(PREMIUM_KEY);
        if (snapshot == null) {
            snapshot = snapshots.entrySet().stream()
                    .filter(e -> e.getKey() != null && e.getKey().toLowerCase(Locale.ROOT).contains("premium"))
                    .map(Map.Entry::getValue)
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(null);
        }
        if (snapshot == null) {
            return Optional.empty();
        }
        boolean unlimited = Boolean.TRUE.equals(snapshot.isUnlimitedEntitlement());
        Long entitlement = snapshot.entitlementRequests();
        Long used = snapshot.usedRequests();
        // Without these there is nothing honest to draw, so let the estimate speak instead.
        if (!unlimited && (entitlement == null || entitlement <= 0 || used == null)) {
            return Optional.empty();
        }
        return Optional.of(new Quota(used == null ? 0L : used, entitlement, unlimited,
                snapshot.remainingPercentage(), snapshot.overage(), resetDate(snapshot.resetDate(), now)));
    }

    /**
     * When the allowance next resets. The runtime's own date is used only if it lies in the future:
     * in practice it can carry the time the snapshot was taken, which is in the past and would
     * render as "resets today". Otherwise GitHub's documented rule applies — premium request
     * counters reset on the 1st of each month at 00:00 UTC.
     */
    static OffsetDateTime resetDate(OffsetDateTime reported, Instant now) {
        if (reported != null && reported.toInstant().isAfter(now)) {
            return reported;
        }
        return LocalDate.ofInstant(now, ZoneOffset.UTC).withDayOfMonth(1).plusMonths(1)
                .atStartOfDay().atOffset(ZoneOffset.UTC);
    }

    /**
     * Overlays the account quota onto the session-store usage map. The per-model breakdown and
     * request counts stay from the store; the used and budget figures come from the account when it
     * answered. {@code source} tells the browser which of the two it is looking at.
     */
    public static Map<String, Object> applyTo(Map<String, Object> usage, Optional<Quota> quota) {
        Map<String, Object> out = new LinkedHashMap<>(usage);
        if (quota.isPresent()) {
            Quota q = quota.get();
            out.put("source", "account");
            out.put("used", q.used());
            if (q.entitlement() != null && q.entitlement() > 0) {
                out.put("budget", q.entitlement());
            }
            out.put("unlimited", q.unlimited());
            out.put("remainingPercent", q.remainingPercent());
            out.put("resetDate", q.resetDate() == null ? null : q.resetDate().toInstant().toString());
            out.put("available", true);
        } else {
            out.put("source", "estimate");
            out.put("unlimited", false);
            out.put("remainingPercent", null);
            out.put("resetDate", null);
        }
        return out;
    }

    public record Quota(long used, Long entitlement, boolean unlimited, Double remainingPercent,
            Double overage, OffsetDateTime resetDate) {
    }
}
