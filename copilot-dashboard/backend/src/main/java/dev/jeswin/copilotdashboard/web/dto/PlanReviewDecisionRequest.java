package dev.jeswin.copilotdashboard.web.dto;

import jakarta.validation.constraints.NotNull;

/**
 * The answer to a plan waiting for review. Approving names one of the offered {@code action}s;
 * {@code feedback} tells the agent what to change, or adds guidance to an approval.
 */
public record PlanReviewDecisionRequest(@NotNull Boolean approved, String action, String feedback,
        Boolean confirmed) {
}
