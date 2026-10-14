package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.github.copilot.generated.rpc.AccountGetQuotaResult;
import com.github.copilot.generated.rpc.AccountQuotaSnapshot;
import dev.jeswin.copilotdashboard.copilot.QuotaService.Quota;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class QuotaServiceTest {

    private static final OffsetDateTime RESET = OffsetDateTime.of(2025, 11, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final Instant NOW = Instant.parse("2025-10-14T09:39:00Z");

    private static AccountQuotaSnapshot snapshot(Boolean unlimited, Long entitlement, Long used) {
        return new AccountQuotaSnapshot(unlimited, entitlement, used, true, 49.1, 0.0, false, RESET);
    }

    private static Map<String, Object> estimate() {
        Map<String, Object> usage = new LinkedHashMap<>();
        usage.put("month", "2025-10");
        usage.put("budget", 25000);
        usage.put("used", 31041L);
        usage.put("requests", 812);
        usage.put("model", null);
        usage.put("available", true);
        return usage;
    }

    @Test
    void readsThePremiumSnapshot() {
        AccountGetQuotaResult result = new AccountGetQuotaResult(Map.of(
                "chat", snapshot(true, null, null),
                QuotaService.PREMIUM_KEY, snapshot(false, 50000L, 25450L)));

        Quota quota = QuotaService.fromResult(result, NOW).orElseThrow();

        assertThat(quota.used()).isEqualTo(25450L);
        assertThat(quota.entitlement()).isEqualTo(50000L);
        assertThat(quota.unlimited()).isFalse();
        assertThat(quota.remainingPercent()).isEqualTo(49.1);
        assertThat(quota.resetDate()).isEqualTo(RESET);
    }

    @Test
    void fallsBackToAnyPremiumLookingKey() {
        AccountGetQuotaResult result = new AccountGetQuotaResult(Map.of("premium_requests", snapshot(false, 300L, 12L)));

        assertThat(QuotaService.fromResult(result, NOW)).map(Quota::used).contains(12L);
    }

    @Test
    void nothingUsableMeansEmpty() {
        assertThat(QuotaService.fromResult(null, NOW)).isEmpty();
        assertThat(QuotaService.fromResult(new AccountGetQuotaResult(Map.of()), NOW)).isEmpty();
        assertThat(QuotaService.fromResult(new AccountGetQuotaResult(Map.of("chat", snapshot(false, 50L, 1L))), NOW)).isEmpty();
        assertThat(QuotaService.fromResult(new AccountGetQuotaResult(
                Map.of(QuotaService.PREMIUM_KEY, snapshot(false, 0L, 0L))), NOW)).as("no entitlement").isEmpty();
        assertThat(QuotaService.fromResult(new AccountGetQuotaResult(
                Map.of(QuotaService.PREMIUM_KEY, snapshot(false, 300L, null))), NOW)).as("no usage").isEmpty();
    }

    @Test
    void unlimitedPlansNeedNoEntitlement() {
        Quota quota = QuotaService.fromResult(new AccountGetQuotaResult(
                Map.of(QuotaService.PREMIUM_KEY, snapshot(true, null, 7L))), NOW).orElseThrow();

        assertThat(quota.unlimited()).isTrue();
        assertThat(quota.used()).isEqualTo(7L);
    }

    @Test
    void aFutureReportedResetDateIsKept() {
        assertThat(QuotaService.resetDate(RESET, NOW)).isEqualTo(RESET);
    }

    @Test
    void aPastOrMissingResetDateFallsBackToTheFirstOfNextMonthUtc() {
        OffsetDateTime snapshotTime = OffsetDateTime.parse("2025-10-14T08:48:54.538Z");

        assertThat(QuotaService.resetDate(snapshotTime, NOW)).isEqualTo(RESET);
        assertThat(QuotaService.resetDate(null, NOW)).isEqualTo(RESET);
        assertThat(QuotaService.resetDate(null, Instant.parse("2025-12-31T23:59:59Z")))
                .isEqualTo(OffsetDateTime.parse("2026-01-01T00:00:00Z"));
    }

    @Test
    void accountFiguresReplaceTheEstimateButKeepTheBreakdown() {
        Quota quota = new Quota(25450L, 50000L, false, 49.1, 0.0, RESET);

        Map<String, Object> out = QuotaService.applyTo(estimate(), Optional.of(quota));

        assertThat(out)
                .containsEntry("source", "account")
                .containsEntry("used", 25450L)
                .containsEntry("budget", 50000L)
                .containsEntry("unlimited", false)
                .containsEntry("remainingPercent", 49.1)
                .containsEntry("resetDate", "2025-11-01T00:00:00Z")
                .containsEntry("available", true)
                .containsEntry("requests", 812)
                .containsEntry("month", "2025-10");
    }

    @Test
    void withoutTheAccountTheEstimateIsLabelledAsSuch() {
        Map<String, Object> out = QuotaService.applyTo(estimate(), Optional.empty());

        assertThat(out)
                .containsEntry("source", "estimate")
                .containsEntry("used", 31041L)
                .containsEntry("budget", 25000)
                .containsEntry("unlimited", false)
                .containsEntry("remainingPercent", null)
                .containsEntry("resetDate", null);
    }

    @Test
    void failuresAreCachedSoPollingDoesNotHammerTheRuntime() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        when(manager.client()).thenThrow(new IllegalStateException("Copilot CLI not installed"));
        QuotaService service = new QuotaService(manager);

        assertThat(service.current()).isEmpty();
        assertThat(service.current()).isEmpty();
        verify(manager, times(1)).client();
    }
}
