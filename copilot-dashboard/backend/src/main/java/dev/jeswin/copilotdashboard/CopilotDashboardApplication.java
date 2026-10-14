package dev.jeswin.copilotdashboard;

import dev.jeswin.copilotdashboard.config.CopilotProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(CopilotProperties.class)
public class CopilotDashboardApplication {

    public static void main(String[] args) {
        SpringApplication.run(CopilotDashboardApplication.class, args);
    }
}
