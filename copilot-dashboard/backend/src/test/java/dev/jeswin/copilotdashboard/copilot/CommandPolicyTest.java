package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.jeswin.copilotdashboard.config.CopilotProperties;
import java.util.List;
import org.junit.jupiter.api.Test;

class CommandPolicyTest {

    @Test
    void defaultsHideCortexOwnedCommandsAndGuardRiskyOnes() {
        CommandPolicy policy = new CommandPolicy(new CopilotProperties());

        assertThat(policy.isHidden("model", List.of("models"))).isTrue();
        assertThat(policy.isHidden("context", List.of())).isFalse();
        assertThat(policy.needsConfirmation("fleet")).isTrue();
        assertThat(policy.needsConfirmation("every", List.of("loop"))).isTrue();
        assertThat(policy.needsConfirmation("usage")).isFalse();
    }

    @Test
    void entriesMatchByAliasIgnoringCaseAndLeadingSlash() {
        CopilotProperties props = new CopilotProperties();
        props.getCommands().setHidden(List.of(" /YOLO "));
        props.getCommands().setConfirm(List.of("Loop"));
        CommandPolicy policy = new CommandPolicy(props);

        assertThat(policy.isHidden("allow-all", List.of("yolo")))
                .as("an alias in the policy still covers the command").isTrue();
        assertThat(policy.needsConfirmation("every", List.of("loop"))).isTrue();
        assertThat(policy.needsConfirmation("every")).as("without its alias it is not matched").isFalse();
        assertThat(policy.isHidden("model", List.of("models"))).as("replaced, not merged").isFalse();
    }
}
