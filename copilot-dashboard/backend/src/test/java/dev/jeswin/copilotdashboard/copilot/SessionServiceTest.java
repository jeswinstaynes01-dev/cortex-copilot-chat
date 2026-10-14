package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.copilot.CopilotClient;
import com.github.copilot.CopilotSession;
import com.github.copilot.SystemMessageMode;
import com.github.copilot.generated.AssistantMessageEvent;
import com.github.copilot.generated.SessionEvent;
import com.github.copilot.rpc.ExitPlanModeInvocation;
import com.github.copilot.rpc.ExitPlanModeRequest;
import com.github.copilot.rpc.ExitPlanModeResult;
import com.github.copilot.rpc.MessageOptions;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.config.CopilotProperties.Persona;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

/** Exercises the service against a mocked runtime: no Copilot CLI is started. */
class SessionServiceTest {

    @TempDir
    Path workspace;

    private static CopilotProperties withOwnModel() {
        CopilotProperties props = new CopilotProperties();
        props.getProvider().setType("openai");
        props.getProvider().setBaseUrl("http://localhost:11434/v1");
        props.getProvider().setModels(List.of("llama3.2"));
        Persona qa = new Persona();
        qa.setId("qa-engineer");
        qa.setName("QA Engineer");
        qa.setPrompt("Act as QA.");
        props.setPersonas(List.of(qa));
        return props;
    }

    private static SessionService service(CopilotClientManager manager, CopilotProperties props) {
        // Spring-like mapper: event timestamps are OffsetDateTime, which a bare ObjectMapper can't write.
        return new SessionService(manager, props, FakeRpc.MAPPER, new SessionConfigFactory(props, name -> null),
                new CommandPolicy(props));
    }

    private static CopilotClientManager unavailableRuntime() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        when(manager.client()).thenThrow(new IllegalStateException("Copilot CLI not installed"));
        return manager;
    }

    private static CopilotClient runtimeThatAcceptsSessions(CopilotClientManager manager) {
        CopilotClient client = mock(CopilotClient.class);
        when(manager.client()).thenReturn(client);
        when(client.createSession(any(SessionConfig.class)))
                .thenReturn(CompletableFuture.completedFuture(mock(CopilotSession.class)));
        return client;
    }

    @Test
    void ownModelsStillListWhenCopilotCannotAnswer() {
        List<Map<String, Object>> models = service(unavailableRuntime(), withOwnModel()).listModels();

        assertThat(models).extracting(m -> m.get("id")).containsExactly("llama3.2");
        assertThat(models.get(0)).containsEntry("provider", "openai");
    }

    @Test
    void withoutOwnModelsTheFallbackIsAutoAlone() {
        List<Map<String, Object>> models = service(unavailableRuntime(), new CopilotProperties()).listModels();

        assertThat(models).extracting(m -> m.get("id")).containsExactly("auto");
        assertThat(models.get(0)).containsEntry("provider", null);
    }

    @Test
    void sessionOnOwnModelGetsProviderAndPersona() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotClient client = runtimeThatAcceptsSessions(manager);
        SessionService service = service(manager, withOwnModel());

        DashboardSession session = service.createSession(null, workspace.toString(), false, null, "qa-engineer");

        ArgumentCaptor<SessionConfig> captor = ArgumentCaptor.forClass(SessionConfig.class);
        verify(client).createSession(captor.capture());
        SessionConfig config = captor.getValue();
        assertThat(config.getModel()).as("own model is the default when default-model is auto").isEqualTo("llama3.2");
        assertThat(config.getProvider().getBaseUrl()).isEqualTo("http://localhost:11434/v1");
        assertThat(config.getSystemMessage().getMode()).isEqualTo(SystemMessageMode.APPEND);
        assertThat(config.getSystemMessage().getContent()).isEqualTo("Act as QA.");
        assertThat(session.getPersona()).isEqualTo("qa-engineer");
        assertThat(session.getModel()).isEqualTo("llama3.2");
    }

    @Test
    void unknownPersonaIsDroppedNotFatal() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotClient client = runtimeThatAcceptsSessions(manager);
        SessionService service = service(manager, withOwnModel());

        DashboardSession session = service.createSession("gpt-5", workspace.toString(), false, null, "pirate");

        ArgumentCaptor<SessionConfig> captor = ArgumentCaptor.forClass(SessionConfig.class);
        verify(client).createSession(captor.capture());
        assertThat(captor.getValue().getSystemMessage()).isNull();
        assertThat(captor.getValue().getProvider()).as("Copilot model").isNull();
        assertThat(session.getPersona()).isNull();
    }

    @Test
    void workingDirectoryMustExist() {
        SessionService service = service(unavailableRuntime(), new CopilotProperties());

        assertThat(service.resolveWorkingDirectory(workspace.toString()))
                .isEqualTo(workspace.toAbsolutePath().normalize().toString());
        assertThatThrownBy(() -> service.resolveWorkingDirectory(workspace.resolve("missing").toString()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not exist");
    }

    // ---------------------------------------------------------------- plan review

    @Test
    void planReviewWaitsForTheUserAndGuardsAutopilot() throws Exception {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotClient client = runtimeThatAcceptsSessions(manager);
        SessionService service = service(manager, new CopilotProperties());
        DashboardSession session = service.createSession(null, workspace.toString(), false, null, null);
        SessionConfig config = capturedConfig(client);
        assertThat(config.getEnableConfigDiscovery()).contains(true);

        CompletableFuture<ExitPlanModeResult> decision = config.getOnExitPlanMode()
                .handle(plan("autopilot", "interactive", "exit_only"), new ExitPlanModeInvocation());

        JsonNode requested = only(session, "dashboard.plan_review_requested");
        String reviewId = requested.path("reviewId").asText();
        assertThat(texts(requested.path("actions"))).containsExactly("autopilot", "interactive", "exit_only");
        assertThat(texts(requested.path("confirmActions"))).containsExactly("autopilot");
        assertThatThrownBy(() -> service.resolvePlanReview(session.getId(), reviewId, true, null, null, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Choose what happens next");
        assertThatThrownBy(() -> service.resolvePlanReview(session.getId(), reviewId, true, "autopilot_fleet", null, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("was not offered");
        assertThatThrownBy(() -> service.resolvePlanReview(session.getId(), reviewId, true, "autopilot", null, false))
                .isInstanceOf(SessionService.ConfirmationRequiredException.class);
        assertThat(decision).isNotDone();

        service.resolvePlanReview(session.getId(), reviewId, true, "autopilot", " go ahead ", true);

        ExitPlanModeResult result = decision.get(5, TimeUnit.SECONDS);
        assertThat(result.isApproved()).isTrue();
        assertThat(result.getSelectedAction()).isEqualTo("autopilot");
        assertThat(result.getFeedback()).isEqualTo("go ahead");
        JsonNode resolved = only(session, "dashboard.plan_review_resolved");
        assertThat(resolved.path("approved").asBoolean()).isTrue();
        assertThat(resolved.path("action").asText()).isEqualTo("autopilot");
        assertThatThrownBy(() -> service.resolvePlanReview(session.getId(), reviewId, false, null, null, false))
                .as("answered once only")
                .isInstanceOf(SessionService.PlanReviewNotFoundException.class);
    }

    @Test
    void stoppingTheTurnDeclinesAWaitingPlan() throws Exception {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotSession runtime = runtimeFor(manager);
        when(runtime.abort()).thenReturn(CompletableFuture.completedFuture(null));
        SessionService service = service(manager, new CopilotProperties());
        DashboardSession session = service.createSession(null, workspace.toString(), false, null, null);
        CompletableFuture<ExitPlanModeResult> decision = capturedConfig(manager.client()).getOnExitPlanMode()
                .handle(plan("interactive"), new ExitPlanModeInvocation());

        service.abortTurn(session.getId());

        ExitPlanModeResult result = decision.get(5, TimeUnit.SECONDS);
        assertThat(result.isApproved()).isFalse();
        assertThat(result.getFeedback()).endsWith("End your turn.");
        assertThat(session.getPendingPlanReviews()).isEmpty();
    }

    // ---------------------------------------------------------------- runtime-started turns

    @Test
    void aScheduledPromptOpensATurnOfItsOwn() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotSession runtime = runtimeFor(manager);
        SessionService service = service(manager, new CopilotProperties());
        DashboardSession session = service.createSession(null, workspace.toString(), false, null, null);
        Consumer<SessionEvent> runtimeEvents = listener(runtime);
        String eventId = UUID.randomUUID().toString();

        runtimeEvents.accept(event("user.message", eventId,
                "{\"content\":\"[Scheduled prompt #1]\\ncheck the build\",\"transformedContent\":\"EXPANDED\","
                        + "\"source\":\"schedule-1\"}"));

        JsonNode start = only(session, "dashboard.turn_start");
        assertThat(start.path("external").asBoolean()).isTrue();
        assertThat(start.path("source").asText()).isEqualTo("schedule-1");
        assertThat(only(session, "dashboard.prompt_recorded").path("eventId").asText()).isEqualTo(eventId);
        assertThat(session.replayBuffer()).noneMatch(e -> e.toString().contains("EXPANDED"));
        assertThat(session.isBusy()).isTrue();
        assertThatThrownBy(() -> service.sendMessage(session.getId(), "hi"))
                .isInstanceOf(SessionService.SessionBusyException.class);

        runtimeEvents.accept(event("session.idle", UUID.randomUUID().toString(), "{}"));

        JsonNode end = only(session, "dashboard.turn_end");
        assertThat(end.path("external").asBoolean()).isTrue();
        assertThat(end.path("turnId").asText()).isEqualTo(start.path("turnId").asText());
        assertThat(session.isBusy()).isFalse();
    }

    @Test
    void duringOurTurnOnlyAScheduledPromptCountsAsANewOne() {
        CopilotClientManager manager = mock(CopilotClientManager.class);
        CopilotSession runtime = runtimeFor(manager);
        CompletableFuture<AssistantMessageEvent> reply = new CompletableFuture<>();
        when(runtime.sendAndWait(any(MessageOptions.class), anyLong())).thenReturn(reply);
        SessionService service = service(manager, new CopilotProperties());
        DashboardSession session = service.createSession(null, workspace.toString(), false, null, null);
        Consumer<SessionEvent> runtimeEvents = listener(runtime);
        try {
            service.sendMessage(session.getId(), "hello");

            runtimeEvents.accept(event("user.message", UUID.randomUUID().toString(),
                    "{\"content\":\"hello\",\"source\":\"user\"}"));
            assertThat(session.replayBuffer()).noneMatch(SessionServiceTest::isExternalStart);
            assertThat(session.replayBuffer()).anyMatch(e -> "dashboard.prompt_recorded".equals(e.path("type").asText()));

            runtimeEvents.accept(event("user.message", UUID.randomUUID().toString(),
                    "{\"content\":\"[Scheduled prompt #2]\\nping\",\"source\":\"schedule-2\"}"));
            assertThat(session.replayBuffer()).filteredOn(SessionServiceTest::isExternalStart).hasSize(1);
        } finally {
            reply.complete(null);
        }
    }

    // ---------------------------------------------------------------- helpers

    private static CopilotSession runtimeFor(CopilotClientManager manager) {
        CopilotClient client = mock(CopilotClient.class);
        CopilotSession runtime = mock(CopilotSession.class);
        when(manager.client()).thenReturn(client);
        when(client.createSession(any(SessionConfig.class))).thenReturn(CompletableFuture.completedFuture(runtime));
        return runtime;
    }

    private static SessionConfig capturedConfig(CopilotClient client) {
        ArgumentCaptor<SessionConfig> captor = ArgumentCaptor.forClass(SessionConfig.class);
        verify(client).createSession(captor.capture());
        return captor.getValue();
    }

    @SuppressWarnings("unchecked")
    private static Consumer<SessionEvent> listener(CopilotSession runtime) {
        ArgumentCaptor<Consumer<SessionEvent>> captor = ArgumentCaptor.forClass(Consumer.class);
        verify(runtime).on(captor.capture());
        return captor.getValue();
    }

    private static ExitPlanModeRequest plan(String... actions) {
        return new ExitPlanModeRequest().setSummary("Add tests").setPlanContent("1. Write the tests")
                .setActions(List.of(actions)).setRecommendedAction(actions[0]);
    }

    private static SessionEvent event(String type, String id, String data) {
        try {
            return FakeRpc.MAPPER.readValue("{\"type\":\"" + type + "\",\"id\":\"" + id
                    + "\",\"timestamp\":\"2025-01-01T00:00:00Z\",\"data\":" + data + "}", SessionEvent.class);
        } catch (Exception ex) {
            throw new IllegalArgumentException(ex);
        }
    }

    private static JsonNode only(DashboardSession session, String type) {
        List<JsonNode> matches = session.replayBuffer().stream()
                .filter(e -> type.equals(e.path("type").asText()))
                .toList();
        assertThat(matches).as("%s events in %s", type, session.replayBuffer()).hasSize(1);
        return matches.get(0);
    }

    private static boolean isExternalStart(JsonNode event) {
        return "dashboard.turn_start".equals(event.path("type").asText()) && event.path("external").asBoolean();
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(item -> out.add(item.asText()));
        return out;
    }
}
