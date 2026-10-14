package dev.jeswin.copilotdashboard.copilot;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.github.copilot.generated.rpc.RpcCaller;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Stands in for the Copilot runtime's JSON-RPC connection. Wrapped in a real {@code SessionRpc},
 * it lets tests drive the generated SDK APIs with canned answers — no CLI is started.
 */
final class FakeRpc implements RpcCaller {

    /** Configured like Spring Boot's: java.time support, ISO dates, unknown fields ignored. */
    static final ObjectMapper MAPPER = JsonMapper.builder()
            .findAndAddModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private final Map<String, Object> answers = new ConcurrentHashMap<>();
    final List<String> calls = new CopyOnWriteArrayList<>();
    final Map<String, JsonNode> lastParams = new ConcurrentHashMap<>();

    /** Answers {@code method} with this JSON from now on. */
    FakeRpc answer(String method, String json) {
        answers.put(method, json);
        return this;
    }

    /** Makes {@code method} fail the way the runtime refuses a request. */
    FakeRpc fail(String method, String message) {
        answers.put(method, new IllegalStateException(message));
        return this;
    }

    @Override
    public <T> CompletableFuture<T> invoke(String method, Object params, Class<T> type) {
        return respond(method, params, MAPPER.constructType(type));
    }

    @Override
    public <T> CompletableFuture<T> invoke(String method, Object params, JavaType type) {
        return respond(method, params, type);
    }

    private <T> CompletableFuture<T> respond(String method, Object params, JavaType type) {
        calls.add(method);
        if (params != null) {
            lastParams.put(method, MAPPER.valueToTree(params));
        }
        Object answer = answers.get(method);
        if (answer == null) {
            return CompletableFuture.failedFuture(new IllegalStateException("No fake answer for " + method));
        }
        if (answer instanceof Throwable failure) {
            return CompletableFuture.failedFuture(failure);
        }
        try {
            if (type.getRawClass() == Void.class) {
                return CompletableFuture.completedFuture(null);
            }
            T value = MAPPER.readerFor(type).readValue((String) answer);
            return CompletableFuture.completedFuture(value);
        } catch (Exception ex) {
            return CompletableFuture.failedFuture(ex);
        }
    }
}
