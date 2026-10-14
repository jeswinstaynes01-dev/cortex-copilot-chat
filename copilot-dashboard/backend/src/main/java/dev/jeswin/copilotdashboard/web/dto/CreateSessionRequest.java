package dev.jeswin.copilotdashboard.web.dto;

/**
 * @param reasoningEffort one of the values the chosen model advertises in {@code /api/config}.
 *        Support varies by model and is not a fixed scale, so this cannot be validated against a
 *        constant. An unsupported value is dropped rather than rejected; {@link SessionSummary}
 *        reports what was actually applied. Null means "let the model decide".
 * @param persona a persona id from {@code /api/config}. Null means the configured default persona;
 *        blank or {@code none} means no persona. An unknown id is dropped, like an effort.
 */
public record CreateSessionRequest(String model, String workingDirectory, Boolean autoApprove,
        String reasoningEffort, String persona) {
}
