package dev.jeswin.copilotdashboard.web;

import dev.jeswin.copilotdashboard.copilot.SessionService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(SessionService.SessionNotFoundException.class)
    public ResponseEntity<Map<String, String>> notFound(RuntimeException ex) {
        return body(HttpStatus.NOT_FOUND, ex);
    }

    @ExceptionHandler(SessionService.PermissionNotFoundException.class)
    public ResponseEntity<Map<String, String>> permissionGone(RuntimeException ex) {
        return body(HttpStatus.GONE, ex);
    }

    @ExceptionHandler(SessionService.SessionBusyException.class)
    public ResponseEntity<Map<String, String>> busy(RuntimeException ex) {
        return body(HttpStatus.CONFLICT, ex);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(RuntimeException ex) {
        return body(HttpStatus.BAD_REQUEST, ex);
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> runtimeUnavailable(RuntimeException ex) {
        return body(HttpStatus.SERVICE_UNAVAILABLE, ex);
    }

    private ResponseEntity<Map<String, String>> body(HttpStatus status, RuntimeException ex) {
        return ResponseEntity.status(status).body(Map.of("error", String.valueOf(ex.getMessage())));
    }
}
