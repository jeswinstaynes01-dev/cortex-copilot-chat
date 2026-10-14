package dev.jeswin.copilotdashboard.config;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.StringUtils;

@ConfigurationProperties(prefix = "copilot")
public class CopilotProperties {

    private String cliPath;
    private String defaultModel = "auto";
    private String defaultWorkingDirectory = System.getProperty("user.dir");
    private int eventHistoryLimit = 500;
    private long permissionTimeoutSeconds = 600;
    private long turnTimeoutSeconds = 1800;
    private boolean forwardAllEvents = false;
    private List<String> allowedOrigins = List.of("http://localhost:5173");

    /**
     * The Copilot CLI's own session store. It records every past conversation and every model
     * request the CLI has ever made, which is where real history and real spend come from. We only
     * ever open it read-only.
     */
    private String historyDbPath =
            Path.of(System.getProperty("user.home"), ".copilot", "session-store.db").toString();

    /**
     * Premium requests included in the plan each calendar month. A request's cost is its model
     * multiplier, so one "max" effort Opus call can cost 15 while a cheap call costs 1 — which is
     * why this is counted in multiplier units and not in requests or tokens.
     */
    private int monthlyPremiumBudget = 25000;

    /**
     * Bring your own model. When configured, the listed models are served by this endpoint with
     * the user's own key instead of GitHub Copilot — a local Ollama, OpenAI, Azure OpenAI or
     * Anthropic. Those requests need no Copilot sign-in and do not count against its quota.
     */
    private Provider provider = new Provider();

    /**
     * MCP servers handed to every new session, keyed by name. Each one adds tools; every call to
     * one of those tools still goes through the permission prompt like any other tool.
     */
    private Map<String, McpServer> mcpServers = new LinkedHashMap<>();

    /** System-prompt add-ons the user can pick per chat, e.g. "QA Engineer". */
    private List<Persona> personas = new ArrayList<>();

    /** Persona id applied when the browser does not ask for one. Blank means none. */
    private String defaultPersona;

    /**
     * Load the user's own customisations into every session, as the terminal CLI does: custom
     * agents and skills from {@code ~/.copilot}, and instruction files, agents and skills from the
     * working directory's repository. Off means a bare session with built-in commands only.
     */
    private boolean configDiscovery = true;

    /** Which of the runtime's slash commands the browser may run, and which need a confirmation. */
    private Commands commands = new Commands();

    public boolean isConfigDiscovery() {
        return configDiscovery;
    }

    public void setConfigDiscovery(boolean configDiscovery) {
        this.configDiscovery = configDiscovery;
    }

    public Commands getCommands() {
        return commands;
    }

    public void setCommands(Commands commands) {
        this.commands = commands == null ? new Commands() : commands;
    }

    public Provider getProvider() {
        return provider;
    }

    public void setProvider(Provider provider) {
        this.provider = provider == null ? new Provider() : provider;
    }

    public Map<String, McpServer> getMcpServers() {
        return mcpServers;
    }

    public void setMcpServers(Map<String, McpServer> mcpServers) {
        this.mcpServers = mcpServers == null ? new LinkedHashMap<>() : mcpServers;
    }

    public List<Persona> getPersonas() {
        return personas;
    }

    public void setPersonas(List<Persona> personas) {
        this.personas = personas == null ? new ArrayList<>() : personas;
    }

    public String getDefaultPersona() {
        return defaultPersona;
    }

    public void setDefaultPersona(String defaultPersona) {
        this.defaultPersona = defaultPersona;
    }

    public String getHistoryDbPath() {
        return historyDbPath;
    }

    public void setHistoryDbPath(String historyDbPath) {
        this.historyDbPath = historyDbPath;
    }

    public int getMonthlyPremiumBudget() {
        return monthlyPremiumBudget;
    }

    public void setMonthlyPremiumBudget(int monthlyPremiumBudget) {
        this.monthlyPremiumBudget = monthlyPremiumBudget;
    }

    public String getCliPath() {
        return cliPath;
    }

    public void setCliPath(String cliPath) {
        this.cliPath = cliPath;
    }

    public String getDefaultModel() {
        return defaultModel;
    }

    public void setDefaultModel(String defaultModel) {
        this.defaultModel = defaultModel;
    }

    public String getDefaultWorkingDirectory() {
        return defaultWorkingDirectory;
    }

    public void setDefaultWorkingDirectory(String defaultWorkingDirectory) {
        this.defaultWorkingDirectory = defaultWorkingDirectory;
    }

    public int getEventHistoryLimit() {
        return eventHistoryLimit;
    }

    public void setEventHistoryLimit(int eventHistoryLimit) {
        this.eventHistoryLimit = eventHistoryLimit;
    }

    public long getPermissionTimeoutSeconds() {
        return permissionTimeoutSeconds;
    }

    public void setPermissionTimeoutSeconds(long permissionTimeoutSeconds) {
        this.permissionTimeoutSeconds = permissionTimeoutSeconds;
    }

    /**
     * How long a single agent turn may run before the SDK gives up. The SDK default is 60s, which
     * is far too short for real agent work (multi-step tool use, builds, test runs).
     */
    public long getTurnTimeoutSeconds() {
        return turnTimeoutSeconds;
    }

    public void setTurnTimeoutSeconds(long turnTimeoutSeconds) {
        this.turnTimeoutSeconds = turnTimeoutSeconds;
    }

    public boolean isForwardAllEvents() {
        return forwardAllEvents;
    }

    public void setForwardAllEvents(boolean forwardAllEvents) {
        this.forwardAllEvents = forwardAllEvents;
    }

    public List<String> getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    /**
     * An OpenAI-compatible, Azure OpenAI or Anthropic endpoint. The key itself is never stored
     * here: {@code apiKeyEnv} names the environment variable that holds it, so the configuration
     * can be committed without leaking a secret.
     */
    public static class Provider {

        /** {@code openai} (also Ollama, LM Studio, vLLM...), {@code azure} or {@code anthropic}. */
        private String type;
        private String baseUrl;
        private String apiKeyEnv = "CORTEX_PROVIDER_API_KEY";
        /** {@code completions} (the default, widest support) or {@code responses}. */
        private String wireApi;
        private String azureApiVersion;
        /** Model ids the endpoint serves. They appear in the model menu, first one is the default. */
        private List<String> models = new ArrayList<>();

        /** A provider without a type, a URL or a single model has nothing to offer. */
        public boolean isEnabled() {
            return StringUtils.hasText(type) && StringUtils.hasText(baseUrl)
                    && models.stream().anyMatch(StringUtils::hasText);
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public String getApiKeyEnv() {
            return apiKeyEnv;
        }

        public void setApiKeyEnv(String apiKeyEnv) {
            this.apiKeyEnv = apiKeyEnv;
        }

        public String getWireApi() {
            return wireApi;
        }

        public void setWireApi(String wireApi) {
            this.wireApi = wireApi;
        }

        public String getAzureApiVersion() {
            return azureApiVersion;
        }

        public void setAzureApiVersion(String azureApiVersion) {
            this.azureApiVersion = azureApiVersion;
        }

        public List<String> getModels() {
            return models;
        }

        public void setModels(List<String> models) {
            this.models = models == null ? new ArrayList<>() : models;
        }
    }

    /** One MCP server: a local command ({@code stdio}) or a remote endpoint ({@code http}). */
    public static class McpServer {

        private String type = "stdio";
        private String command;
        private List<String> args = new ArrayList<>();
        private Map<String, String> env = new LinkedHashMap<>();
        private String workingDirectory;
        private String url;
        private Map<String, String> headers = new LinkedHashMap<>();
        /** Tool names to expose; {@code *} means all of them. */
        private List<String> tools = new ArrayList<>(List.of("*"));
        private Integer timeout;

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public List<String> getArgs() {
            return args;
        }

        public void setArgs(List<String> args) {
            this.args = args == null ? new ArrayList<>() : args;
        }

        public Map<String, String> getEnv() {
            return env;
        }

        public void setEnv(Map<String, String> env) {
            this.env = env == null ? new LinkedHashMap<>() : env;
        }

        public String getWorkingDirectory() {
            return workingDirectory;
        }

        public void setWorkingDirectory(String workingDirectory) {
            this.workingDirectory = workingDirectory;
        }

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public Map<String, String> getHeaders() {
            return headers;
        }

        public void setHeaders(Map<String, String> headers) {
            this.headers = headers == null ? new LinkedHashMap<>() : headers;
        }

        public List<String> getTools() {
            return tools;
        }

        public void setTools(List<String> tools) {
            this.tools = tools == null || tools.isEmpty() ? new ArrayList<>(List.of("*")) : tools;
        }

        public Integer getTimeout() {
            return timeout;
        }

        public void setTimeout(Integer timeout) {
            this.timeout = timeout;
        }
    }

    /**
     * Slash-command policy. Names match a command's name or any of its aliases, case-insensitively,
     * so {@code yolo} and {@code allow-all} are the same entry.
     */
    public static class Commands {

        /**
         * Never offered and refused if called. Cortex has its own control for each of these, and
         * the runtime's version would change the session behind Cortex's back — a model switch the
         * model menu does not show, or an allow-all that skips Cortex's approval prompts.
         */
        private List<String> hidden = new ArrayList<>(List.of("model", "cwd", "allow-all", "permissions"));

        /**
         * Run only after the user confirms. These hand the agent more autonomy (autopilot, fleet,
         * scheduled prompts), widen what it can touch (add-dir, computer), or reach outside this
         * machine (share, remote, plugin).
         */
        private List<String> confirm = new ArrayList<>(List.of(
                "add-dir", "autopilot", "fleet", "every", "after", "plugin", "share", "remote", "computer"));

        public List<String> getHidden() {
            return hidden;
        }

        public void setHidden(List<String> hidden) {
            this.hidden = hidden == null ? new ArrayList<>() : hidden;
        }

        public List<String> getConfirm() {
            return confirm;
        }

        public void setConfirm(List<String> confirm) {
            this.confirm = confirm == null ? new ArrayList<>() : confirm;
        }
    }

    /** Instructions appended to the agent's system prompt for one chat. */
    public static class Persona {

        private String id;
        private String name;
        private String description;
        private String prompt;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public String getPrompt() {
            return prompt;
        }

        public void setPrompt(String prompt) {
            this.prompt = prompt;
        }
    }
}
