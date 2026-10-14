package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.copilot.rpc.ExitPlanModeResult;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * A finished plan waiting for the user to approve it or ask for changes. The agent's turn is
 * blocked on {@code future} until then, exactly like a {@link PendingPermission}.
 *
 * @param id      dashboard-generated id the browser echoes back with its answer
 * @param payload the event the browser renders: summary, plan, actions, recommended action
 * @param actions what the runtime offered to do after approval, e.g. {@code interactive} or
 *                {@code autopilot}; an approval may only pick one of these
 * @param future  completed with the user's answer
 */
public record PendingPlanReview(
        String id,
        ObjectNode payload,
        List<String> actions,
        CompletableFuture<ExitPlanModeResult> future) {
}
