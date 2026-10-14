package dev.jeswin.copilotdashboard.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Runs one runtime slash command. {@code requestId} is chosen by the browser and comes back on the
 * events this command produces, so it can tell them apart from a reply that is still streaming.
 * {@code confirmed} is the user's explicit yes for commands that need one.
 */
public record InvokeCommandRequest(
        @NotBlank @Size(max = 100) String requestId,
        @NotBlank @Size(max = 200) String name,
        String input,
        Boolean confirmed) {
}
