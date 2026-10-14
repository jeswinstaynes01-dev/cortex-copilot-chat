package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;

import com.github.copilot.SystemMessageMode;
import com.github.copilot.rpc.McpHttpServerConfig;
import com.github.copilot.rpc.McpServerConfig;
import com.github.copilot.rpc.McpStdioServerConfig;
import com.github.copilot.rpc.ProviderConfig;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.config.CopilotProperties.McpServer;
import dev.jeswin.copilotdashboard.config.CopilotProperties.Persona;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SessionConfigFactoryTest {

    private static final String KEY = "sk-test-not-a-real-key";

    private static CopilotProperties withProvider(String type, String... models) {
        CopilotProperties props = new CopilotProperties();
        props.getProvider().setType(type);
        props.getProvider().setBaseUrl("http://localhost:11434/v1");
        props.getProvider().setModels(List.of(models));
        return props;
    }

    private static SessionConfigFactory factory(CopilotProperties props, String key) {
        return new SessionConfigFactory(props, name -> "CORTEX_PROVIDER_API_KEY".equals(name) ? key : null);
    }

    private static Persona persona(String id, String prompt) {
        Persona persona = new Persona();
        persona.setId(id);
        persona.setName(id.toUpperCase());
        persona.setDescription("about " + id);
        persona.setPrompt(prompt);
        return persona;
    }

    @Test
    void providerIsOffUntilTypeUrlAndModelAreAllSet() {
        CopilotProperties props = new CopilotProperties();
        SessionConfigFactory factory = factory(props, KEY);

        assertThat(factory.providerEnabled()).isFalse();
        assertThat(factory.providerFor("auto")).isNull();
        assertThat(factory.providerSummary()).isNull();
        assertThat(factory.providerModelEntries()).isEmpty();
        assertThat(factory.defaultModel()).isEqualTo("auto");

        props.getProvider().setType("openai");
        props.getProvider().setBaseUrl("http://localhost:11434/v1");
        assertThat(factory.providerEnabled()).as("no models yet").isFalse();

        props.getProvider().setModels(List.of(" ", "llama3.2"));
        assertThat(factory.providerEnabled()).isTrue();
        assertThat(factory.providerModels()).containsExactly("llama3.2");
    }

    @Test
    void providerConfigCarriesTheKeyFromTheEnvironmentOnlyForItsOwnModels() {
        SessionConfigFactory factory = factory(withProvider("OpenAI", "llama3.2", "qwen2.5", "llama3.2"), KEY);

        ProviderConfig config = factory.providerFor("llama3.2");
        assertThat(config.getType()).isEqualTo("openai");
        assertThat(config.getBaseUrl()).isEqualTo("http://localhost:11434/v1");
        assertThat(config.getApiKey()).isEqualTo(KEY);
        assertThat(config.getAzure()).isNull();

        assertThat(factory.providerFor("gpt-5")).as("Copilot models go to Copilot").isNull();
        assertThat(factory.providerModels()).as("duplicates dropped").containsExactly("llama3.2", "qwen2.5");
    }

    @Test
    void missingKeyIsAllowedForLocalServers() {
        SessionConfigFactory factory = factory(withProvider("openai", "llama3.2"), null);

        assertThat(factory.providerFor("llama3.2").getApiKey()).isNull();
        assertThat(factory.providerSummary()).containsEntry("keyConfigured", false);
    }

    @Test
    void summaryReportsTheKeyAsConfiguredWithoutRevealingIt() {
        SessionConfigFactory factory = factory(withProvider("openai", "llama3.2"), KEY);

        Map<String, Object> summary = factory.providerSummary();
        assertThat(summary)
                .containsEntry("type", "openai")
                .containsEntry("baseUrl", "http://localhost:11434/v1")
                .containsEntry("keyConfigured", true)
                .containsEntry("models", List.of("llama3.2"));
        assertThat(summary.toString()).doesNotContain(KEY);
        assertThat(factory.providerModelEntries().toString()).doesNotContain(KEY);
    }

    @Test
    void azureGetsItsApiVersionAndWireApiPassesThrough() {
        CopilotProperties props = withProvider("azure", "my-deployment");
        props.getProvider().setAzureApiVersion("2024-10-21");
        props.getProvider().setWireApi("responses");

        ProviderConfig config = factory(props, KEY).providerFor("my-deployment");
        assertThat(config.getType()).isEqualTo("azure");
        assertThat(config.getAzure().getApiVersion()).isEqualTo("2024-10-21");
        assertThat(config.getWireApi()).isEqualTo("responses");
    }

    @Test
    void defaultModelPrefersOwnModelOnlyWhenTheDefaultIsAuto() {
        CopilotProperties props = withProvider("openai", "llama3.2", "qwen2.5");
        assertThat(factory(props, null).defaultModel()).isEqualTo("llama3.2");

        props.setDefaultModel("gpt-5");
        assertThat(factory(props, null).defaultModel()).isEqualTo("gpt-5");
    }

    @Test
    void modelEntriesLookLikeCopilotOnesPlusTheProviderType() {
        List<Map<String, Object>> entries = factory(withProvider("openai", "llama3.2"), null).providerModelEntries();

        assertThat(entries).hasSize(1);
        assertThat(entries.get(0))
                .containsEntry("id", "llama3.2")
                .containsEntry("name", "llama3.2")
                .containsEntry("reasoningEfforts", List.of())
                .containsEntry("defaultReasoningEffort", null)
                .containsEntry("multiplier", null)
                .containsEntry("provider", "openai");
    }

    @Test
    void mcpServersMapToStdioAndHttpConfigsAndSkipIncompleteOnes() {
        CopilotProperties props = new CopilotProperties();
        McpServer local = new McpServer();
        local.setCommand("node");
        local.setArgs(List.of("server.js"));
        local.setEnv(Map.of("DEBUG", "1"));
        local.setWorkingDirectory("/tmp");
        local.setTimeout(30000);
        McpServer remote = new McpServer();
        remote.setType("http");
        remote.setUrl("https://example.com/mcp");
        remote.setHeaders(Map.of("Authorization", "Bearer secret"));
        remote.setTools(List.of("search"));
        McpServer broken = new McpServer();
        props.getMcpServers().put("local", local);
        props.getMcpServers().put("remote", remote);
        props.getMcpServers().put("broken", broken);

        Map<String, McpServerConfig> servers = factory(props, null).mcpServers();

        assertThat(servers).containsOnlyKeys("local", "remote");
        McpStdioServerConfig stdio = (McpStdioServerConfig) servers.get("local");
        assertThat(stdio.getCommand()).isEqualTo("node");
        assertThat(stdio.getArgs()).containsExactly("server.js");
        assertThat(stdio.getEnv()).containsEntry("DEBUG", "1");
        assertThat(stdio.getWorkingDirectory()).isEqualTo("/tmp");
        assertThat(stdio.getTools()).containsExactly("*");
        assertThat(stdio.getTimeout()).isEqualTo(30000);
        McpHttpServerConfig http = (McpHttpServerConfig) servers.get("remote");
        assertThat(http.getUrl()).isEqualTo("https://example.com/mcp");
        assertThat(http.getHeaders()).containsEntry("Authorization", "Bearer secret");
        assertThat(http.getTools()).containsExactly("search");
    }

    @Test
    void mcpSummariesMaskSecretsAndNeverIncludeEnvOrHeaders() {
        CopilotProperties props = new CopilotProperties();
        McpServer local = new McpServer();
        local.setCommand("node");
        local.setArgs(List.of("server.js", "--token=abc123", "--api-key", "xyz789", "--port", "3000"));
        local.setEnv(Map.of("GITHUB_TOKEN", "envsecret"));
        McpServer remote = new McpServer();
        remote.setType("http");
        remote.setUrl("https://example.com/mcp?key=querysecret");
        remote.setHeaders(Map.of("Authorization", "Bearer headersecret"));
        props.getMcpServers().put("local", local);
        props.getMcpServers().put("remote", remote);

        List<Map<String, Object>> summaries = factory(props, null).mcpSummaries();

        assertThat(summaries).hasSize(2);
        assertThat(summaries.get(0))
                .containsEntry("name", "local")
                .containsEntry("type", "stdio")
                .containsEntry("target", "node server.js --token=*** --api-key *** --port 3000")
                .containsEntry("tools", List.of("*"));
        assertThat(summaries.get(1))
                .containsEntry("name", "remote")
                .containsEntry("type", "http")
                .containsEntry("target", "https://example.com/mcp");
        assertThat(summaries.toString())
                .doesNotContain("abc123", "xyz789", "envsecret", "querysecret", "headersecret");
    }

    @Test
    void personasAreListedWithoutTheirPromptsAndIncompleteOnesAreIgnored() {
        CopilotProperties props = new CopilotProperties();
        Persona noPrompt = persona("empty", " ");
        props.setPersonas(List.of(persona("qa-engineer", "Act as QA. SECRET-PROMPT"), noPrompt));
        props.setDefaultPersona("qa-engineer");
        SessionConfigFactory factory = factory(props, null);

        assertThat(factory.personaSummaries()).containsExactly(
                Map.of("id", "qa-engineer", "name", "QA-ENGINEER", "description", "about qa-engineer"));
        assertThat(factory.personaSummaries().toString()).doesNotContain("SECRET-PROMPT");
        assertThat(factory.persona("qa-engineer")).isPresent();
        assertThat(factory.persona("empty")).isEmpty();
        assertThat(factory.persona("nope")).isEmpty();
        assertThat(factory.defaultPersona()).isEqualTo("qa-engineer");

        props.setDefaultPersona("nope");
        assertThat(factory.defaultPersona()).as("an unknown default is ignored").isNull();
    }

    @Test
    void applyAddsProviderMcpAndAppendedPersonaPrompt() {
        CopilotProperties props = withProvider("openai", "llama3.2");
        McpServer local = new McpServer();
        local.setCommand("node");
        props.getMcpServers().put("demo", local);
        props.setPersonas(List.of(persona("qa-engineer", "Act as QA.")));
        SessionConfigFactory factory = factory(props, KEY);

        SessionConfig own = factory.apply(new SessionConfig().setModel("llama3.2"), "llama3.2", "qa-engineer");
        assertThat(own.getProvider().getBaseUrl()).isEqualTo("http://localhost:11434/v1");
        assertThat(own.getMcpServers()).containsOnlyKeys("demo");
        assertThat(own.getSystemMessage().getMode()).isEqualTo(SystemMessageMode.APPEND);
        assertThat(own.getSystemMessage().getContent()).isEqualTo("Act as QA.");

        SessionConfig copilot = factory.apply(new SessionConfig().setModel("gpt-5"), "gpt-5", null);
        assertThat(copilot.getProvider()).isNull();
        assertThat(copilot.getSystemMessage()).isNull();
        assertThat(copilot.getMcpServers()).containsOnlyKeys("demo");
    }

    @Test
    void applyLeavesMcpUnsetWhenNoneAreConfigured() {
        SessionConfig config = factory(new CopilotProperties(), null)
                .apply(new SessionConfig().setModel("auto"), "auto", null);

        assertThat(config.getMcpServers()).isNullOrEmpty();
        assertThat(config.getProvider()).isNull();
    }
}
