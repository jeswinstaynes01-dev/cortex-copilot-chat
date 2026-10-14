package dev.jeswin.copilotdashboard.web.dto;

import dev.jeswin.copilotdashboard.copilot.DashboardSession;

public record SessionSummary(
        String id,
        String title,
        String model,
        String workingDirectory,
        boolean autoApprove,
        /**
         * The effort actually in force, which is not always the one that was asked for — an
         * unsupported request is dropped. The browser renders this value rather than its own
         * pending choice, so the UI cannot claim a setting the session does not have.
         */
        String reasoningEffort,
        /** The persona actually applied, or null — an unknown id is dropped, not rejected. */
        String persona,
        boolean busy,
        String createdAt,
        String lastActivityAt) {

    public static SessionSummary from(DashboardSession session) {
        return new SessionSummary(
                session.getId(),
                session.getTitle(),
                session.getModel(),
                session.getWorkingDirectory(),
                session.isAutoApprove(),
                session.getReasoningEffort(),
                session.getPersona(),
                session.isBusy(),
                session.getCreatedAt().toString(),
                session.getLastActivityAt().toString());
    }
}
