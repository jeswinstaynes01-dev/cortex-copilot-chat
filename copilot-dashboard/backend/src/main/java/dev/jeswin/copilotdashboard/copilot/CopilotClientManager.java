package dev.jeswin.copilotdashboard.copilot;

import com.github.copilot.CopilotClient;
import com.github.copilot.rpc.CopilotClientOptions;
import dev.jeswin.copilotdashboard.config.CopilotProperties;
import jakarta.annotation.PreDestroy;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Owns the single {@link CopilotClient} for the whole application.
 *
 * <p>The client spawns and supervises the Copilot CLI in server mode and talks to it over JSON-RPC.
 * Starting it is expensive, so it is created lazily once and shared by every dashboard session.
 */
@Component
public class CopilotClientManager {

    private static final Logger log = LoggerFactory.getLogger(CopilotClientManager.class);

    private final CopilotProperties properties;
    private final Object lock = new Object();

    private volatile CopilotClient client;

    public CopilotClientManager(CopilotProperties properties) {
        this.properties = properties;
    }

    public CopilotClient client() {
        CopilotClient existing = client;
        if (existing != null) {
            return existing;
        }
        synchronized (lock) {
            if (client == null) {
                client = startClient();
            }
            return client;
        }
    }

    private CopilotClient startClient() {
        // Without an explicit cliPath the SDK looks for a bundled native runtime JAR that this
        // project does not ship, so always hand it a concrete executable.
        String cliPath = resolveCliPath();
        if (cliPath == null) {
            throw new IllegalStateException(
                    "Could not find the Copilot CLI. Install it (https://github.com/features/copilot/cli), "
                            + "make sure `copilot` is on your PATH, or set copilot.cli-path in application.yml.");
        }

        CopilotClientOptions options = new CopilotClientOptions()
                .setCwd(properties.getDefaultWorkingDirectory())
                .setCliPath(cliPath);

        log.info("Starting Copilot runtime (cwd={}, cliPath={})",
                properties.getDefaultWorkingDirectory(), cliPath);

        CopilotClient started = new CopilotClient(options);
        try {
            started.start().get(120, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while starting the Copilot runtime", ex);
        } catch (Exception ex) {
            throw new IllegalStateException(
                    "Could not start the Copilot runtime. Make sure the Copilot CLI is installed and you have run "
                            + "`copilot` at least once to sign in, or set copilot.cli-path in application.yml.",
                    ex);
        }
        log.info("Copilot runtime started");
        return started;
    }

    /** Configured path wins, then COPILOT_CLI_PATH, then the first match on PATH. */
    private String resolveCliPath() {
        if (StringUtils.hasText(properties.getCliPath())) {
            return properties.getCliPath();
        }
        String fromEnv = System.getenv("COPILOT_CLI_PATH");
        if (StringUtils.hasText(fromEnv)) {
            return fromEnv;
        }
        return findOnPath();
    }

    private String findOnPath() {
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        List<String> candidates = windows
                ? List.of("copilot.exe", "copilot.cmd", "copilot.bat")
                : List.of("copilot");

        String pathVariable = System.getenv("PATH");
        if (pathVariable == null) {
            return null;
        }
        for (String directory : pathVariable.split(File.pathSeparator)) {
            if (directory.isBlank()) {
                continue;
            }
            for (String name : candidates) {
                try {
                    Path candidate = Path.of(directory.trim(), name);
                    if (Files.isRegularFile(candidate)) {
                        return candidate.toAbsolutePath().toString();
                    }
                } catch (InvalidPathException ex) {
                    // Skip malformed PATH entries.
                }
            }
        }
        return null;
    }

    @PreDestroy
    void shutdown() {
        CopilotClient existing = client;
        if (existing == null) {
            return;
        }
        try {
            existing.stop().get(30, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            log.warn("Copilot runtime did not stop cleanly: {}", ex.getMessage());
        } finally {
            existing.close();
            client = null;
        }
    }
}
