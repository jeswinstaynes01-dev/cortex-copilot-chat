package dev.jeswin.copilotdashboard.web.dto;

import jakarta.validation.constraints.NotBlank;

/** The rewind point to go back to, as listed by {@code GET /api/sessions/{id}/rewind}. */
public record RewindRequest(@NotBlank String eventId) {
}
