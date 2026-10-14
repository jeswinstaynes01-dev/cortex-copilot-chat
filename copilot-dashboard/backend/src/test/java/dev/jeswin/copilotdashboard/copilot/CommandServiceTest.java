package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.copilot.CopilotClient;
import com.github.copilot.CopilotSession;
import com.github.copilot.generated.rpc.SessionRpc;
import com.github.copilot.rpc.AgentInfo;
import com.github.copilot.rpc.AgentMode;
import com.github.copilot.rpc.MessageOptions;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.copilot.CommandService.CommandInfo;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

/** Drives the real generated SDK APIs over a fake RPC connection: no Copilot CLI is started. */
class CommandServiceTest {

    private static final String COMMANDS = """
            {"commands": [
              {"name": "context", "aliases": [], "description": "Show context use", "kind": "builtin",
               "allowDuringAgentExecution": true},
              {"name": "model", "aliases": ["models"], "kind": "builtin", "allowDuringAgentExecution": true},
              {"name": "fleet", "aliases": [], "kind": "builtin", "input": {"hint": "<prompt>", "required": true}},
              {"name": "every", "aliases": ["loop"], "kind": "builtin", "allowDuringAgentExecution": true,
               "input": {"hint": "<interval or time> <prompt>", "required": true}},
              {"name": "plan", "aliases": [], "kind": "builtin",
               "input": {"hint": "[prompt]", "choices": [{"name": "show", "description": "Show the plan"}]}},
              {"name": "tidy-up", "aliases": [], "description": "Repo skill", "kind": "skill"},
              {"name": "theme", "aliases": [], "kind": "client"}
            ]}""";

    @TempDir
    Path workspace;

    private FakeRpc rpc;
    private CopilotSession runtime;
    private SessionService sessions;
    private CommandService commands;
    private DashboardSession session;

    @BeforeEach
    void setUp() {
        CopilotProperties props = new CopilotProperties();
        rpc = new FakeRpc().answer("session.commands.list", COMMANDS);
        runtime = mock(CopilotSession.class);
        when(runtime.getRpc()).thenReturn(new SessionRpc(rpc, "rt-1"));
        when(runtime.getSessionId()).thenReturn("rt-1");
        when(runtime.sendAndWait(any(MessageOptions.class), anyLong()))
                .thenReturn(CompletableFuture.completedFuture(null));

        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotClient client = mock(CopilotClient.class);
        when(manager.client()).thenReturn(client);
        when(client.createSession(any(SessionConfig.class))).thenReturn(CompletableFuture.completedFuture(runtime));

        SessionConfigFactory configFactory = new SessionConfigFactory(props, name -> null);
        CommandPolicy policy = new CommandPolicy(props);
        sessions = new SessionService(manager, props, FakeRpc.MAPPER, configFactory, policy);
        commands = new CommandService(sessions, manager, configFactory, props, policy, FakeRpc.MAPPER);
        session = sessions.createSession(null, workspace.toString(), false, null, null);
    }

    // ---------------------------------------------------------------- catalog

    @Test
    void catalogDropsHiddenAndClientCommandsAndFlagsConfirmations() {
        List<CommandInfo> catalog = commands.sessionCatalog(session.getId());

        assertThat(catalog).extracting(CommandInfo::name).containsExactly("context", "fleet", "every", "plan", "tidy-up");
        assertThat(byName(catalog, "fleet").confirm()).isTrue();
        assertThat(byName(catalog, "every").confirm()).isTrue();
        assertThat(byName(catalog, "every").aliases()).containsExactly("loop");
        assertThat(byName(catalog, "every").hint()).isEqualTo("<interval or time> <prompt>");
        assertThat(byName(catalog, "context").confirm()).isFalse();
        assertThat(byName(catalog, "context").allowDuringTurn()).isTrue();
        assertThat(byName(catalog, "plan").choices()).extracting(CommandService.Choice::name).containsExactly("show");
        assertThat(byName(catalog, "tidy-up").kind()).isEqualTo("skill");
        assertThat(rpc.lastParams.get("session.commands.list").path("includeClientCommands").asBoolean(true)).isFalse();
    }

    // ---------------------------------------------------------------- invoke: refusals

    @Test
    void unknownAndHiddenCommandsAreRefusedWithAWayForward() {
        assertThatThrownBy(() -> commands.invoke(session.getId(), "r1", "/nope", null, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not a command");
        assertThatThrownBy(() -> commands.invoke(session.getId(), "r2", "/models", null, false))
                .as("hidden through its alias")
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("model menu");
        assertThat(rpc.calls).doesNotContain("session.commands.invoke");
    }

    @Test
    void guardedCommandsNeedAnExplicitConfirmation() {
        assertThatThrownBy(() -> commands.invoke(session.getId(), "r1", "loop", "5m check", false))
                .isInstanceOf(SessionService.ConfirmationRequiredException.class);
        assertThat(rpc.calls).doesNotContain("session.commands.invoke");
        assertThat(session.isBusy()).isFalse();
    }

    @Test
    void commandsThatStartWorkAreRefusedWhileAReplyStreams() {
        session.markBusy();

        assertThatThrownBy(() -> commands.invoke(session.getId(), "r1", "plan", "add tests", false))
                .isInstanceOf(SessionService.SessionBusyException.class)
                .hasMessageContaining("/plan can't run while a reply is in progress");
    }

    // ---------------------------------------------------------------- invoke: results

    @Test
    void textResultIsCleanedAndTheTurnIsTaggedWithTheRequestId() {
        rpc.answer("session.commands.invoke",
                "{\"kind\":\"text\",\"text\":\"\\u001b[1mTokens\\u001b[0m: 12\\r\\n\\u001b]8;;http://x\\u0007link\\u001b]8;;\\u0007\",\"markdown\":false}");

        commands.invoke(session.getId(), "r1", "/Context", "  ", false);
        awaitEvent(e -> isType(e, "dashboard.turn_end") && "r1".equals(e.path("requestId").asText()));

        JsonNode start = event(e -> isType(e, "dashboard.turn_start"));
        assertThat(start.path("requestId").asText()).isEqualTo("r1");
        assertThat(start.path("command").path("name").asText()).isEqualTo("context");
        JsonNode result = event(e -> isType(e, "dashboard.command_result"));
        assertThat(result.path("kind").asText()).isEqualTo("text");
        assertThat(result.path("text").asText()).isEqualTo("Tokens: 12\nlink");
        assertThat(result.path("markdown").asBoolean(true)).isFalse();
        JsonNode params = rpc.lastParams.get("session.commands.invoke");
        assertThat(params.path("name").asText()).as("canonical name").isEqualTo("context");
        assertThat(params.path("input").isNull() || params.path("input").isMissingNode()).isTrue();
        assertThat(session.isBusy()).isFalse();
    }

    @Test
    void safeCommandsRunBesideAStreamingReplyWithoutFreeingIt() {
        rpc.answer("session.commands.invoke", "{\"kind\":\"text\",\"text\":\"ctx\",\"markdown\":true}");
        session.markBusy();

        commands.invoke(session.getId(), "side", "context", null, false);
        awaitEvent(e -> isType(e, "dashboard.turn_end") && "side".equals(e.path("requestId").asText()));

        assertThat(event(e -> isType(e, "dashboard.command_result")).path("text").asText()).isEqualTo("ctx");
        assertThat(session.replayBuffer()).noneMatch(e -> isType(e, "dashboard.turn_start"));
        assertThat(session.isBusy()).as("the reply still owns the session").isTrue();
    }

    @Test
    void agentPromptRunsAsATurnWithoutShowingTheExpandedPrompt() {
        rpc.answer("session.commands.invoke",
                "{\"kind\":\"agent-prompt\",\"prompt\":\"PAGES OF INSTRUCTIONS\",\"displayPrompt\":\"/plan add tests\",\"mode\":\"plan\"}");

        commands.invoke(session.getId(), "r1", "plan", "add tests", false);
        awaitEvent(e -> isType(e, "dashboard.turn_end"));

        JsonNode result = event(e -> isType(e, "dashboard.command_result"));
        assertThat(result.path("kind").asText()).isEqualTo("turn");
        assertThat(result.path("displayPrompt").asText()).isEqualTo("/plan add tests");
        assertThat(result.path("mode").asText()).isEqualTo("plan");
        assertThat(session.replayBuffer()).noneMatch(e -> e.toString().contains("PAGES OF INSTRUCTIONS"));

        ArgumentCaptor<MessageOptions> sent = ArgumentCaptor.forClass(MessageOptions.class);
        verify(runtime).sendAndWait(sent.capture(), anyLong());
        assertThat(sent.getValue().getPrompt()).isEqualTo("PAGES OF INSTRUCTIONS");
        assertThat(sent.getValue().getDisplayPrompt()).isEqualTo("/plan add tests");
        assertThat(sent.getValue().getAgentMode()).isEqualTo(AgentMode.PLAN);
    }

    @Test
    void runtimeRefusalBecomesAnErrorResultNotAFailedTurn() {
        rpc.fail("session.commands.invoke", "Usage: /every <interval or time> <prompt>");

        commands.invoke(session.getId(), "r1", "every", null, true);
        awaitEvent(e -> isType(e, "dashboard.turn_end"));

        JsonNode result = event(e -> isType(e, "dashboard.command_result"));
        assertThat(result.path("kind").asText()).isEqualTo("error");
        assertThat(result.path("error").asText()).isEqualTo("Usage: /every <interval or time> <prompt>");
        assertThat(session.replayBuffer()).noneMatch(e -> isType(e, "dashboard.error"));
        verify(runtime, never()).sendAndWait(any(MessageOptions.class), anyLong());
    }

    @Test
    void otherResultKindsMapToWhatTheBrowserRenders() {
        ObjectNode select = FakeRpc.MAPPER.createObjectNode();
        commands.describe("mcp", "select-subcommand", tree("""
                {"command":"mcp","title":"MCP servers","options":[{"name":"show","description":"List","group":"view"}]}"""),
                select);
        assertThat(select.path("kind").asText()).isEqualTo("select");
        assertThat(select.path("options").get(0).path("name").asText()).isEqualTo("show");

        ObjectNode failed = FakeRpc.MAPPER.createObjectNode();
        commands.describe("share", "add-timeline-entry",
                tree("{\"entry\":{\"type\":\"error\",\"text\":\"Not signed in\"},\"prefillInput\":\"/share\"}"), failed);
        assertThat(failed.path("kind").asText()).isEqualTo("error");
        assertThat(failed.path("error").asText()).isEqualTo("Not signed in");
        assertThat(failed.path("prefill").asText()).isEqualTo("/share");

        ObjectNode dialog = FakeRpc.MAPPER.createObjectNode();
        commands.describe("model", "show-dialog", tree("{}"), dialog);
        assertThat(dialog.path("kind").asText()).isEqualTo("info");

        ObjectNode planModel = FakeRpc.MAPPER.createObjectNode();
        commands.describe("plan", "set-plan-model", tree("{\"planModel\":\"gpt-5\"}"), planModel);
        assertThat(planModel.path("message").asText()).isEqualTo("Plan model set to gpt-5.");
    }

    // ---------------------------------------------------------------- extras

    @Test
    void rewindForgetsTheReplayBufferAndReportsFailures() {
        rpc.answer("session.history.rewind", "{\"outcome\":\"success\",\"eventsRemoved\":4}");
        session.broadcast(FakeRpc.MAPPER.createObjectNode().put("type", "assistant.message"));

        Map<String, Object> out = commands.rewind(session.getId(), "evt-1");

        assertThat(out).containsEntry("outcome", "success").containsEntry("eventsRemoved", 4L);
        assertThat(session.replayBuffer()).extracting(e -> e.path("type").asText()).containsExactly("dashboard.rewound");
        assertThat(rpc.lastParams.get("session.history.rewind").path("mode").asText()).isEqualTo("conversation");

        rpc.answer("session.history.rewind", "{\"outcome\":\"session-busy\"}");
        assertThatThrownBy(() -> commands.rewind(session.getId(), "evt-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("session-busy");
        session.markBusy();
        assertThatThrownBy(() -> commands.rewind(session.getId(), "evt-1"))
                .isInstanceOf(SessionService.SessionBusyException.class);
    }

    @Test
    void rewindPointsStayAvailableWithoutFileTracking() {
        rpc.answer("session.history.listRewindPoints", """
                {"fileChangeTrackingEnabled":false,"unavailableReason":"file-change-tracking-disabled",
                 "points":[{"eventId":"e1","userMessage":"hello","timestamp":"2025-01-01T00:00:00Z"}]}""");

        Map<String, Object> out = commands.rewindPoints(session.getId());

        assertThat(out).containsEntry("available", true).containsEntry("reason", "file-change-tracking-disabled");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> points = (List<Map<String, Object>>) out.get("points");
        assertThat(points).singleElement().satisfies(p -> {
            assertThat(p).containsEntry("eventId", "e1").containsEntry("userMessage", "hello");
            assertThat(String.valueOf(p.get("timestamp"))).startsWith("2025-01-01T00:00");
        });
    }

    @Test
    void tasksAndSchedulesAreFlattenedAndClipped() {
        rpc.answer("session.tasks.list", "{\"tasks\":[{\"id\":\"t1\",\"status\":\"running\",\"latestResponse\":\""
                + "x".repeat(900) + "\",\"nested\":{\"a\":1}}]}");
        rpc.answer("session.schedule.list", """
                {"entries":[{"id":3,"intervalMs":60000,"prompt":"check the build","recurring":true,
                 "nextRunAt":"2030-01-01T00:00:00Z"}]}""");

        Map<String, Object> task = commands.tasks(session.getId()).get(0);
        assertThat(task).containsEntry("id", "t1").containsEntry("status", "running").doesNotContainKey("nested");
        assertThat((String) task.get("latestResponse")).hasSize(501).endsWith("…");

        Map<String, Object> schedule = commands.schedules(session.getId()).get(0);
        assertThat(schedule).containsEntry("prompt", "check the build").containsEntry("recurring", true);
        assertThat(((Number) schedule.get("id")).longValue()).isEqualTo(3L);
    }

    @Test
    void stoppingAScheduleThatIsGoneIsAClearError() {
        rpc.answer("session.schedule.stop", "{}");

        assertThatThrownBy(() -> commands.stopSchedule(session.getId(), 9))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("#9");
        assertThat(rpc.lastParams.get("session.schedule.stop").path("id").asLong()).isEqualTo(9L);
    }

    @Test
    void instructionSourcesNeverIncludeTheirText() {
        rpc.answer("session.instructions.getSources", """
                {"sources":[{"id":"repo","label":"Repository instructions","sourcePath":".github/copilot-instructions.md",
                 "content":"SECRET HOUSE RULES","type":"repo","location":"repository","applyTo":["**/*.java"]}]}""");

        Map<String, Object> source = commands.instructions(session.getId()).get(0);

        assertThat(source).containsEntry("label", "Repository instructions").containsEntry("chars", 18)
                .containsEntry("type", "repo").containsEntry("applyTo", List.of("**/*.java"));
        assertThat(source.values()).noneMatch(v -> String.valueOf(v).contains("SECRET"));
    }

    @Test
    void onlyKnownAgentsCanBeSelected() {
        when(runtime.listAgents()).thenReturn(CompletableFuture.completedFuture(
                List.of(new AgentInfo().setName("reviewer").setDisplayName("Reviewer"))));
        when(runtime.getCurrentAgent()).thenReturn(CompletableFuture.completedFuture(null));

        assertThat(commands.agents(session.getId())).containsEntry("current", null);
        assertThatThrownBy(() -> commands.selectAgent(session.getId(), "pirate"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("pirate");
        verify(runtime, never()).selectAgent(any());
    }

    // ---------------------------------------------------------------- helpers

    private static CommandInfo byName(List<CommandInfo> catalog, String name) {
        return catalog.stream().filter(c -> c.name().equals(name)).findFirst().orElseThrow();
    }

    private static JsonNode tree(String json) {
        try {
            return FakeRpc.MAPPER.readTree(json);
        } catch (Exception ex) {
            throw new IllegalArgumentException(ex);
        }
    }

    private static boolean isType(JsonNode event, String type) {
        return type.equals(event.path("type").asText());
    }

    private JsonNode event(Predicate<JsonNode> match) {
        return session.replayBuffer().stream().filter(match).findFirst()
                .orElseThrow(() -> new AssertionError("No matching event in " + session.replayBuffer()));
    }

    /** Commands run on the turn thread pool; wait for the event that marks them finished. */
    private void awaitEvent(Predicate<JsonNode> match) {
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            if (session.replayBuffer().stream().anyMatch(match)) {
                return;
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        throw new AssertionError("Timed out; events were " + session.replayBuffer());
    }
}
