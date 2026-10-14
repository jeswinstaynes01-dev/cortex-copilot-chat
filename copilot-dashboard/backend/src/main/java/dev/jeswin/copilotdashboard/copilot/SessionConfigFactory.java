package dev.jeswin.copilotdashboard.copilot;

import com.github.copilot.SystemMessageMode;
import com.github.copilot.rpc.AzureOptions;
import com.github.copilot.rpc.McpHttpServerConfig;
import com.github.copilot.rpc.McpServerConfig;
import com.github.copilot.rpc.McpStdioServerConfig;
import com.github.copilot.rpc.ProviderConfig;
import com.github.copilot.rpc.SessionConfig;
import com.github.copilot.rpc.SystemMessageConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.config.CopilotProperties.McpServer;
import dev.jeswin.copilotdashboard.config.CopilotProperties.Persona;
import dev.jeswin.copilotdashboard.config.CopilotProperties.Provider;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Turns the optional extras in {@code copilot.*} — your own model endpoint, MCP servers and
 * personas — into SDK session settings, and describes them for {@code /api/config}.
 *
 * <p>Descriptions sent to the browser never include secrets: API keys are only reported as
 * configured or not, MCP environment variables and headers are left out, and anything that looks
 * like a token in an MCP command line is masked.
 */
@Component
public class SessionConfigFactory {

    /** Matches {@code --token=abc} style arguments whose value should not reach the browser. */
    private static final Pattern SECRET_ASSIGNMENT =
            Pattern.compile("(?i)^(-{0,2}[\\w.-]*(key|token|secret|password|auth)[\\w.-]*=).+$");
    /** Matches {@code --api-key} style flags whose following argument is the secret. */
    private static final Pattern SECRET_FLAG =
            Pattern.compile("(?i)^-{1,2}[\\w.-]*(key|token|secret|password|auth)[\\w.-]*$");

    private final CopilotProperties properties;
    private final Function<String, String> environment;

    @Autowired
    public SessionConfigFactory(CopilotProperties properties) {
        this(properties, System::getenv);
    }

    /** Lets tests supply environment variables without touching the real process environment. */
    SessionConfigFactory(CopilotProperties properties, Function<String, String> environment) {
        this.properties = properties;
        this.environment = environment;
    }

    // ---------------------------------------------------------------- provider (bring your own model)

    public boolean providerEnabled() {
        return properties.getProvider().isEnabled();
    }

    /** Model ids served by the user's own endpoint, in configured order, blanks and repeats dropped. */
    public List<String> providerModels() {
        if (!providerEnabled()) {
            return List.of();
        }
        return properties.getProvider().getModels().stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .distinct()
                .toList();
    }

    public boolean isProviderModel(String modelId) {
        return modelId != null && providerModels().contains(modelId);
    }

    /**
     * The endpoint settings for a model, or null when the model belongs to GitHub Copilot.
     *
     * <p>The key is read from the environment on every call, so it can be rotated without a
     * restart and never sits in a config file. A missing key is not an error: local servers such
     * as Ollama do not need one.
     */
    public ProviderConfig providerFor(String modelId) {
        if (!isProviderModel(modelId)) {
            return null;
        }
        Provider provider = properties.getProvider();
        ProviderConfig config = new ProviderConfig()
                .setType(provider.getType().trim().toLowerCase())
                .setBaseUrl(provider.getBaseUrl().trim());
        if (StringUtils.hasText(provider.getWireApi())) {
            config.setWireApi(provider.getWireApi().trim());
        }
        apiKey().ifPresent(config::setApiKey);
        if (StringUtils.hasText(provider.getAzureApiVersion())) {
            config.setAzure(new AzureOptions().setApiVersion(provider.getAzureApiVersion().trim()));
        }
        return config;
    }

    public boolean providerKeyConfigured() {
        return apiKey().isPresent();
    }

    private Optional<String> apiKey() {
        String variable = properties.getProvider().getApiKeyEnv();
        if (!StringUtils.hasText(variable)) {
            return Optional.empty();
        }
        return Optional.ofNullable(environment.apply(variable.trim())).filter(StringUtils::hasText);
    }

    /**
     * The model a new chat gets when the browser does not name one. With only your own endpoint
     * configured and the default left at {@code auto}, that is your first model — Auto would mean
     * GitHub Copilot, which might not even be signed in.
     */
    public String defaultModel() {
        String configured = properties.getDefaultModel();
        boolean unset = !StringUtils.hasText(configured) || "auto".equalsIgnoreCase(configured.trim());
        List<String> own = providerModels();
        if (unset && !own.isEmpty()) {
            return own.get(0);
        }
        return StringUtils.hasText(configured) ? configured.trim() : "auto";
    }

    /** Model-menu entries for the user's own endpoint, shaped like the Copilot ones. */
    public List<Map<String, Object>> providerModelEntries() {
        String type = providerEnabled() ? properties.getProvider().getType().trim().toLowerCase() : null;
        List<Map<String, Object>> entries = new ArrayList<>();
        for (String id : providerModels()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", id);
            entry.put("name", id);
            entry.put("reasoningEfforts", List.of());
            entry.put("defaultReasoningEffort", null);
            entry.put("multiplier", null);
            entry.put("provider", type);
            entries.add(entry);
        }
        return entries;
    }

    /** The provider block of {@code /api/config}: what is configured, never the key itself. */
    public Map<String, Object> providerSummary() {
        if (!providerEnabled()) {
            return null;
        }
        Provider provider = properties.getProvider();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", provider.getType().trim().toLowerCase());
        out.put("baseUrl", provider.getBaseUrl().trim());
        out.put("keyConfigured", providerKeyConfigured());
        out.put("models", providerModels());
        return out;
    }

    // ---------------------------------------------------------------- MCP servers

    /** SDK settings for every usable MCP server. Entries missing a command or URL are skipped. */
    public Map<String, McpServerConfig> mcpServers() {
        Map<String, McpServerConfig> out = new LinkedHashMap<>();
        properties.getMcpServers().forEach((name, server) -> {
            if (!StringUtils.hasText(name) || server == null) {
                return;
            }
            if (isHttp(server)) {
                if (!StringUtils.hasText(server.getUrl())) {
                    return;
                }
                McpHttpServerConfig http = new McpHttpServerConfig()
                        .setUrl(server.getUrl().trim())
                        .setTools(clean(server.getTools()));
                Map<String, String> headers = clean(server.getHeaders());
                if (!headers.isEmpty()) {
                    http.setHeaders(headers);
                }
                if (server.getTimeout() != null) {
                    http.setTimeout(server.getTimeout());
                }
                out.put(name, http);
            } else {
                if (!StringUtils.hasText(server.getCommand())) {
                    return;
                }
                McpStdioServerConfig stdio = new McpStdioServerConfig()
                        .setCommand(server.getCommand().trim())
                        .setArgs(clean(server.getArgs()))
                        .setTools(clean(server.getTools()));
                Map<String, String> env = clean(server.getEnv());
                if (!env.isEmpty()) {
                    stdio.setEnv(env);
                }
                if (StringUtils.hasText(server.getWorkingDirectory())) {
                    stdio.setWorkingDirectory(server.getWorkingDirectory().trim());
                }
                if (server.getTimeout() != null) {
                    stdio.setTimeout(server.getTimeout());
                }
                out.put(name, stdio);
            }
        });
        return out;
    }

    /** What the model menu shows for each MCP server: name, kind, what it runs and its tools. */
    public List<Map<String, Object>> mcpSummaries() {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, McpServerConfig> usable = mcpServers();
        properties.getMcpServers().forEach((name, server) -> {
            if (!usable.containsKey(name)) {
                return;
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", name);
            entry.put("type", isHttp(server) ? "http" : "stdio");
            entry.put("target", isHttp(server) ? withoutQuery(server.getUrl()) : commandLine(server));
            entry.put("tools", clean(server.getTools()));
            out.add(entry);
        });
        return out;
    }

    /** YAML can bind an empty entry as null, which the immutable copies would reject. */
    private static List<String> clean(List<String> values) {
        return values.stream().filter(Objects::nonNull).toList();
    }

    private static Map<String, String> clean(Map<String, String> values) {
        Map<String, String> out = new LinkedHashMap<>();
        values.forEach((key, value) -> {
            if (key != null && value != null) {
                out.put(key, value);
            }
        });
        return out;
    }

    private static boolean isHttp(McpServer server) {
        String type = server.getType();
        return type != null && ("http".equalsIgnoreCase(type.trim()) || "sse".equalsIgnoreCase(type.trim()));
    }

    private static String withoutQuery(String url) {
        String trimmed = url.trim();
        int cut = trimmed.indexOf('?');
        return cut < 0 ? trimmed : trimmed.substring(0, cut);
    }

    private static String commandLine(McpServer server) {
        List<String> parts = new ArrayList<>();
        parts.add(server.getCommand().trim());
        boolean hideNext = false;
        for (String arg : server.getArgs()) {
            if (hideNext) {
                parts.add("***");
                hideNext = false;
                continue;
            }
            String value = arg == null ? "" : arg;
            if (SECRET_ASSIGNMENT.matcher(value).matches()) {
                parts.add(value.substring(0, value.indexOf('=') + 1) + "***");
            } else {
                parts.add(value);
                hideNext = SECRET_FLAG.matcher(value).matches();
            }
        }
        return String.join(" ", parts);
    }

    // ---------------------------------------------------------------- personas

    public List<Persona> personas() {
        return properties.getPersonas().stream()
                .filter(p -> p != null && StringUtils.hasText(p.getId()) && StringUtils.hasText(p.getPrompt()))
                .toList();
    }

    public Optional<Persona> persona(String id) {
        if (!StringUtils.hasText(id)) {
            return Optional.empty();
        }
        String wanted = id.trim();
        return personas().stream().filter(p -> p.getId().trim().equals(wanted)).findFirst();
    }

    /** The configured default persona, if it names one that exists. */
    public String defaultPersona() {
        return persona(properties.getDefaultPersona()).map(p -> p.getId().trim()).orElse(null);
    }

    /** Persona list for the browser — the prompts stay on the server. */
    public List<Map<String, Object>> personaSummaries() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Persona persona : personas()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", persona.getId().trim());
            entry.put("name", StringUtils.hasText(persona.getName()) ? persona.getName().trim() : persona.getId().trim());
            entry.put("description", persona.getDescription() == null ? "" : persona.getDescription().trim());
            out.add(entry);
        }
        return out;
    }

    /**
     * Appends rather than replaces: the runtime's own system prompt carries the tool and safety
     * instructions, and a persona should change the tone and output format, not remove those.
     */
    public static SystemMessageConfig systemMessageFor(Persona persona) {
        return new SystemMessageConfig()
                .setMode(SystemMessageMode.APPEND)
                .setContent(persona.getPrompt().trim());
    }

    // ---------------------------------------------------------------- assembly

    /** Adds the provider, MCP servers and persona that apply to this model and persona id. */
    public SessionConfig apply(SessionConfig config, String model, String personaId) {
        ProviderConfig provider = providerFor(model);
        if (provider != null) {
            config.setProvider(provider);
        }
        Map<String, McpServerConfig> servers = mcpServers();
        if (!servers.isEmpty()) {
            config.setMcpServers(servers);
        }
        persona(personaId).ifPresent(p -> config.setSystemMessage(systemMessageFor(p)));
        return config;
    }
}
