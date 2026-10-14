package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.copilot.rpc.PermissionRequestResult;
import java.util.concurrent.CompletableFuture;

/**
 * A permission request from the agent that is parked until the browser answers it.
 *
 * @param id        dashboard-generated id the UI echoes back when it decides
 * @param payload   the serialized SDK permission request, rendered by the UI
 * @param future    completed with the human decision; the agent thread is blocked on it
 */
public record PendingPermission(
        String id,
        JsonNode payload,
        CompletableFuture<PermissionRequestResult> future) {
}
