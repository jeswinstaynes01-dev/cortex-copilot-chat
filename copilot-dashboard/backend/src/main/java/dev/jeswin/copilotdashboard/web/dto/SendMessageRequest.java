package dev.jeswin.copilotdashboard.web.dto;

import jakarta.validation.constraints.NotBlank;

public record SendMessageRequest(@NotBlank String prompt) {
}
