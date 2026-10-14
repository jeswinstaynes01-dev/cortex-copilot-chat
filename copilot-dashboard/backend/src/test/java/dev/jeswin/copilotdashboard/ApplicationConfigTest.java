package dev.jeswin.copilotdashboard;

import static org.assertj.core.api.Assertions.assertThat;

import dev.jeswin.copilotdashboard.copilot.SessionConfigFactory;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;

/**
 * Boots the real context with the shipped application.yml, which proves the configuration binds
 * and the safe defaults hold. The Copilot runtime is started lazily, so none is launched here.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class ApplicationConfigTest {

    @Autowired
    SessionConfigFactory factory;

    @Autowired
    Environment environment;

    @Test
    void shippedDefaultsAreSafe() {
        assertThat(environment.getProperty("server.address")).as("loopback only").isEqualTo("127.0.0.1");
        assertThat(factory.providerEnabled()).as("own model is opt-in").isFalse();
        assertThat(factory.mcpServers()).as("MCP servers are opt-in").isEmpty();
        assertThat(factory.defaultPersona()).isNull();
        assertThat(factory.defaultModel()).isEqualTo("auto");
    }

    @Test
    void shippedPersonasBind() {
        assertThat(factory.personaSummaries())
                .extracting(p -> p.get("id"))
                .containsExactly("qa-engineer", "code-reviewer", "eli5-tutor");
        assertThat(factory.persona("qa-engineer").orElseThrow().getPrompt())
                .contains("Preconditions")
                .contains("regression impact");
        assertThat(factory.personaSummaries()).allSatisfy(p -> assertThat(p).isInstanceOf(Map.class)
                .doesNotContainKey("prompt"));
    }
}
