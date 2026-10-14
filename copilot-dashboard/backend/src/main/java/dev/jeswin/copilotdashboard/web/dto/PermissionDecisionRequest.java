package dev.jeswin.copilotdashboard.web.dto;

import jakarta.validation.constraints.NotBlank;

public record PermissionDecisionRequest(@NotBlank String decision, String feedback) {
}
