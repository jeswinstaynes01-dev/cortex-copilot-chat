package dev.jeswin.copilotdashboard.web.dto;

/** Picks a custom agent by name; null or blank goes back to the default agent. */
public record SelectAgentRequest(String name) {
}
