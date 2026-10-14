package dev.jeswin.copilotdashboard.copilot;

import dev.jeswin.copilotdashboard.config.CopilotProperties;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Decides which runtime slash commands the browser may run, and which need a confirmation first.
 *
 * <p>A command matches an entry by its name or by any alias, so a policy written as {@code yolo}
 * still covers {@code allow-all}. Without that, renaming or aliasing a command in a future CLI
 * would quietly move it out from behind its confirmation.
 */
@Component
public class CommandPolicy {

    private final Set<String> hidden;
    private final Set<String> confirm;

    public CommandPolicy(CopilotProperties properties) {
        this.hidden = normalise(properties.getCommands().getHidden());
        this.confirm = normalise(properties.getCommands().getConfirm());
    }

    public boolean isHidden(String name, Collection<String> aliases) {
        return matches(hidden, name, aliases);
    }

    public boolean needsConfirmation(String name, Collection<String> aliases) {
        return matches(confirm, name, aliases);
    }

    public boolean needsConfirmation(String name) {
        return needsConfirmation(name, List.of());
    }

    private static boolean matches(Set<String> entries, String name, Collection<String> aliases) {
        Stream<String> names = Stream.concat(Stream.of(name),
                aliases == null ? Stream.empty() : aliases.stream());
        return names.filter(Objects::nonNull)
                .map(n -> n.trim().toLowerCase(Locale.ROOT))
                .anyMatch(entries::contains);
    }

    private static Set<String> normalise(List<String> names) {
        return names.stream()
                .filter(StringUtils::hasText)
                .map(n -> n.trim().replaceFirst("^/", "").toLowerCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
    }
}
