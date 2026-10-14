package dev.jeswin.copilotdashboard.copilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.copilot.CopilotClient;
import com.github.copilot.CopilotSession;
import com.github.copilot.SystemMessageMode;
import com.github.copilot.rpc.SessionConfig;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import dev.jeswin.copilotdashboard.config.CopilotProperties.Persona;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
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
        return new SessionService(manager, props, new ObjectMapper(), new SessionConfigFactory(props, name -> null));
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
}
