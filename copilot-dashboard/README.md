# Copilot Dashboard

A custom web dashboard that embeds the **GitHub Copilot agent** using the official
[GitHub Copilot SDK for Java](https://github.com/github/copilot-sdk-java), with a **Spring Boot**
backend and a **React + TypeScript** frontend.

This is the same agent runtime that powers Copilot CLI — streaming responses, real tool calls
(file reads/edits, shell, search), and permission prompts — but rendered in your own UI.

---

## Architecture

```
┌──────────────────────┐   HTTP + SSE    ┌───────────────────────┐   JSON-RPC    ┌──────────────────┐
│  React (Vite)        │ ──────────────► │  Spring Boot          │ ────────────► │  Copilot CLI     │
│  localhost:5173      │ ◄────────────── │  localhost:8080       │ ◄──────────── │  (server mode)   │
│  chat UI, tool cards │   event stream  │  CopilotClient + SDK  │               │  agent runtime   │
└──────────────────────┘                 └───────────────────────┘               └──────────────────┘
```

- **Spring Boot owns the agent.** One `CopilotClient` per application spawns and supervises the
  Copilot CLI process. Each dashboard conversation is a `CopilotSession`.
- **The browser never talks to Copilot directly.** It talks to your REST API, which is where you
  would add auth, auditing, rate limits, and tenant rules.
- **Events flow one way.** The SDK pushes session events on a runtime thread → the backend
  normalises them into `{type, timestamp, data}` → every connected browser gets them over
  Server-Sent Events.
- **Two UIs, one API.** `frontend/` is the original "mission control" UI (port 5173). The Cortex
  chat UI lives in the sibling `cortex-chat` project (port 5174 in dev). Once Cortex is built, the
  backend jar bundles it, so a single `java -jar` serves the UI and the API on port 8080.
- **Loopback only by default.** The API has no login and can run tools on this machine, so it
  binds to `127.0.0.1`. See [Security notes](#security-notes).

---

## Prerequisites

| Requirement | Why | Verify |
|---|---|---|
| **GitHub Copilot CLI** | The Java SDK does not bundle the CLI; it launches the one on your `PATH`. Sign in to use Copilot models; your own models ([BYOK](#6-own-models-mcp-servers-and-personas)) bypass Copilot authentication | `copilot --version` |
| **JDK 17+** (JDK 25 recommended) | SDK floor is 17; on 25+ it uses virtual threads | `java -version` |
| **Maven 3.9+** | Backend build | `mvn -v` |
| **Node.js 22 LTS** (20.19+ or 22.12+) | UI builds: Cortex uses Vite 8; the older `frontend/` also runs on Node 18 | `node -v` |
| An active **Copilot subscription** | Billing, unless you use BYOK | — |

Sign in once (this stores the OAuth token the SDK reuses):

```powershell
copilot
```

If `copilot` is not on your `PATH`, point the backend at it explicitly — either set
`COPILOT_CLI_PATH` in your environment, or edit `backend/src/main/resources/application.yml`:

```yaml
copilot:
  cli-path: C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/GitHub.Copilot_.../copilot.exe
```

> **Why the backend always resolves an explicit CLI path.** If `cliPath` is left unset, the Java
> SDK tries to materialise a *bundled native runtime* and fails with
> `FileNotFoundException: Native runtime metadata not found on classpath: native/win32-x64/platform.properties`,
> because that runtime ships in a separate `copilot-sdk-java-runtime` classifier JAR we don't depend
> on. It does **not** silently fall back to `PATH`. So `CopilotClientManager.resolveCliPath()`
> always supplies a concrete executable, resolving in this order:
> `copilot.cli-path` → `COPILOT_CLI_PATH` → the first `copilot` binary found on `PATH`.
> If none match it throws a descriptive `IllegalStateException` at startup instead of failing later.

---

## Running it

### One command: UI and API on port 8080

Build the Cortex UI, then package the backend. Maven copies `../cortex-chat/dist` into the jar
(when that folder is missing the jar is simply API-only).

```powershell
# from the copilot-dashboard folder
cd ..\cortex-chat
npm ci
npm run build
cd ..\copilot-dashboard\backend
mvn -q -DskipTests package
java -jar target\copilot-dashboard-backend-0.0.1-SNAPSHOT.jar
```

Open <http://localhost:8080>. Repeat the build steps after changing either project.

### Dev mode: hot reload

Two terminals.

**Terminal 1 — backend (port 8080):**

```powershell
cd backend      # from the copilot-dashboard folder
mvn spring-boot:run
```

Wait for `Copilot runtime started` in the log. The runtime starts lazily on the first
session request, so you may only see it after you create a session.

**Terminal 2 — a UI:**

```powershell
cd frontend     # from the copilot-dashboard folder; mission control on port 5173
npm install     # first time only
npm run dev
```

Open <http://localhost:5173>, click **+ New session**, pick a working directory, and chat.
For Cortex instead, run `npm run dev` in `..\cortex-chat` and open <http://localhost:5174>; its
Vite proxy forwards `/api` to the backend.

---

## Project layout

```
copilot-dashboard/
├── backend/
│   ├── pom.xml                              Spring Boot 3.3 + copilot-sdk-java; bundles cortex-chat/dist
│   ├── src/test/java/…                      JUnit 5 + Mockito; no network or sign-in needed
│   └── src/main/
│       ├── resources/application.yml        ports, model, cwd, CORS, timeouts
│       └── java/dev/jeswin/copilotdashboard/
│           ├── CopilotDashboardApplication.java
│           ├── config/
│           │   ├── CopilotProperties.java   typed binding for `copilot.*`
│           │   └── WebConfig.java           CORS for the Vite dev server
│           ├── copilot/
│           │   ├── CopilotClientManager.java  starts/stops the shared CopilotClient
│           │   ├── DashboardSession.java      session + SSE fan-out + replay buffer
│           │   ├── PendingPermission.java     a parked permission awaiting a human
│           │   ├── QuotaService.java          real premium quota from the account (cached 60s)
│           │   ├── SessionConfigFactory.java  own models (BYOK), MCP servers, personas
│           │   └── SessionService.java        create/stream/send/approve  ← the core
│           ├── history/
│           │   ├── HistoryStore.java          read-only view of the CLI's session store
│           │   └── HistoryController.java     past chats + month-to-date usage
│           └── web/
│               ├── SessionController.java     REST + SSE endpoints
│               ├── ConfigController.java      defaults for the UI
│               ├── ApiExceptionHandler.java   error → HTTP status mapping
│               └── dto/
└── frontend/
    ├── vite.config.ts                       dev server + /api proxy to :8080
    ├── public/favicon.svg
    └── src/
        ├── App.tsx                          layout, session list, modal
        ├── api.ts                           typed fetch wrappers
        ├── types.ts                         shared TS types
        ├── useSessionStream.ts              SSE → chat state reducer  ← the core
        ├── ripple.ts                        click ripple on buttons/tabs
        ├── styles.css                       design tokens + all 19 style sections
        └── components/
            ├── Sidebar.tsx  NewSessionForm.tsx  ChatPanel.tsx
            ├── MessageList.tsx  Composer.tsx
            ├── ToolCallCard.tsx  PermissionPrompt.tsx
            ├── Inspector.tsx                telemetry pane (tools / events)
            ├── Icons.tsx                    all SVG iconography — never emoji
            └── GridField.tsx                animated grid + radar canvas backdrop
```

### UI

A dark "mission control" theme: charcoal surfaces, a lime primary accent, aqua
secondary, and mono type for every path, number and event name. Layout is a
three-pane shell — sessions, chat, telemetry — that degrades to an overlay
telemetry pane below 1180px and a drawer sidebar below 900px.

`styles.css` is the single stylesheet, split into 19 numbered sections, and all
animation is covered by one blanket `prefers-reduced-motion` override at the end.

### Visual checks

The browser harness lives with the Cortex UI: `cortex-chat/shot.mjs` drives your
installed Chrome through every surface, screenshots each step to
`cortex-chat/shots/`, and fails on console errors, horizontal overflow or
elements spilling the viewport. Section 6 of `cortex-chat/README.md` has the
details.

```powershell
cd ..\cortex-chat          # with `npm run dev` running on :5174
node .\shot.mjs            # simulator (?mock): no backend, no model calls
node .\shot.mjs --live     # the same run against this backend on :8080
```

`CHROME_PATH` overrides the browser binary; `npx playwright install` is not required.

---

## API reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/config` | Defaults for the new-chat form: model list (own models first, tagged with `provider`), personas (without prompts), MCP servers (secrets masked), and a provider summary that reports only whether a key is set |
| `GET` | `/api/config/working-directory?path=` | Check a working directory; returns `{ok, resolved, error}` |
| `GET` | `/api/sessions` | List live sessions |
| `POST` | `/api/sessions` | Create a session — body `{model, workingDirectory, autoApprove, reasoningEffort, persona}`, all optional |
| `GET` | `/api/sessions/{id}` | Session summary |
| `DELETE` | `/api/sessions/{id}` | Close and discard a session |
| `GET` | `/api/sessions/{id}/events` | **SSE stream** of agent events |
| `POST` | `/api/sessions/{id}/messages` | Send a prompt — body `{prompt}`; returns `202` immediately |
| `POST` | `/api/sessions/{id}/abort` | Stop the running turn; returns `204` |
| `POST` | `/api/sessions/{id}/permissions/{requestId}` | Answer a permission — body `{decision, feedback}` |
| `POST` | `/api/sessions/{id}/plan-reviews/{reviewId}` | Answer a plan review — body `{approved, action, feedback, confirmed}`; `204`, `410` if already resolved |
| `GET` | `/api/commands` | The runtime's slash commands for a new chat (from a throwaway session, cached) |
| `GET` | `/api/sessions/{id}/commands` | The runtime's slash commands for this session, skills included |
| `POST` | `/api/sessions/{id}/commands` | Run one — body `{requestId, name, input, confirmed}`; `202`, `428` to confirm, `409` when busy |
| `GET`/`POST` | `/api/sessions/{id}/agents`, `/agent` | List custom agents / select one |
| `GET`/`POST` | `/api/sessions/{id}/rewind` | Rewind points / rewind to one |
| `GET` | `/api/sessions/{id}/tasks`, `/instructions`, `/schedules` | Background tasks, instruction files, scheduled prompts |
| `POST` | `/api/sessions/{id}/tasks/{taskId}/cancel`, `/schedules/{scheduleId}/stop` | Cancel a task / stop a schedule |
| `GET` | `/api/version` | App, SDK, CLI and Java versions |
| `GET` | `/api/history?limit=60` | Past conversations from the CLI's session store (read-only) |
| `GET` | `/api/history/{id}` | The turns of one past conversation |
| `GET` | `/api/usage` | Month-to-date premium usage. `source: "account"` is the real quota from GitHub, with `remainingPercent` and `resetDate`; `source: "estimate"` is a local sum against `monthly-premium-budget`. Always includes a per-model breakdown |

### Event envelope

Everything on the SSE stream is a single named event `copilot` with this JSON shape:

```json
{ "type": "tool.execution_start", "timestamp": 1738580000000, "data": { "toolName": "view", "...": "..." } }
```

| `type` | Meaning |
|---|---|
| `dashboard.connected` / `dashboard.ready` | Stream handshake; `ready` carries `busy` |
| `dashboard.user_message` | Echo of your prompt so every tab stays in sync |
| `dashboard.turn_start` / `dashboard.turn_end` | Turn boundaries (drives the composer lock) |
| `dashboard.permission_requested` | `{requestId, request}` — render the approve/reject card |
| `dashboard.permission_resolved` | `{requestId}` — remove the card |
| `dashboard.error` | Turn failed |
| `assistant.message_delta` | `data.deltaContent` — append to the streaming bubble |
| `assistant.message` | `data.content` — authoritative final text |
| `tool.execution_start` | `data.toolCallId`, `toolName`, `toolTitle`, `arguments` |
| `tool.execution_complete` | `data.toolCallId`, `success`, `result`, `error` |
| `session.idle` | Agent finished working |
| `session.usage_info` | `currentTokens`, `tokenLimit`, `messagesLength` |

Set `copilot.forward-all-events: true` to stream every runtime event (very chatty — useful when
you want to discover additional event types to render).

---

## How the important bits work

### 1. One client, many sessions

`CopilotClientManager` creates exactly one `CopilotClient`. Starting it spawns the CLI in server
mode, which is expensive — so it is created lazily, guarded by a lock, and stopped on shutdown.

```java
CopilotClientOptions options = new CopilotClientOptions().setCwd(defaultWorkingDirectory);
CopilotClient client = new CopilotClient(options);
client.start().get(120, TimeUnit.SECONDS);
```

### 2. Creating a session

`setStreaming(true)` is what makes `assistant.message_delta` events fire. `setWorkingDirectory`
scopes file tools to one folder.

```java
SessionConfig config = new SessionConfig()
        .setModel(model)
        .setStreaming(true)
        .setWorkingDirectory(workingDirectory)
        .setOnPermissionRequest(permissionHandler(dashboardId, autoApprove));
```

### 3. Events → SSE

A single catch-all listener receives every event. Jackson serializes the concrete event subclass,
so no payload field is lost, and the backend re-wraps it in a uniform envelope:

```java
copilotSession.on(event -> onRuntimeEvent(dashboardSession, event));
```

### 4. Human-in-the-loop permissions

The permission handler must return a `CompletableFuture`. The dashboard **parks** that future,
pushes a card to the browser, and completes it when a human clicks. The agent thread stays
blocked in the meantime — that is the whole mechanism.

```java
CompletableFuture<PermissionRequestResult> decision = new CompletableFuture<>();
session.getPendingPermissions().put(requestId, pending);
session.broadcast(permissionEvent(pending));
return decision.orTimeout(timeout, SECONDS)
               .exceptionally(ex -> PermissionRequestResult.userNotAvailable());
```

Policy-enforced requests (`getManagedApprovalRequired()`) are never auto-answered — the handler
returns `noResult()` and lets the runtime decide.

### 5. Non-blocking turns

`sendAndWait` blocks until the agent is idle, so it runs on a dedicated executor. The HTTP call
returns `202 Accepted` right away and all output arrives on the SSE stream.

### 6. Own models, MCP servers and personas

`SessionConfigFactory` turns `application.yml` into SDK session settings, so `SessionService`
never deals with provider or MCP details:

```java
ProviderConfig provider = providerFor(model);        // null unless the model is one of yours
if (provider != null) config.setProvider(provider);  // BYOK: your endpoint, your key, no Copilot quota
Map<String, McpServerConfig> servers = mcpServers();
if (!servers.isEmpty()) config.setMcpServers(servers);  // their tools still need approval
persona(personaId).ifPresent(p -> config.setSystemMessage(systemMessageFor(p)));  // APPEND mode
```

A persona is **appended** to the agent's system prompt, never replacing it, so tool use and
safety instructions stay intact. The provider key is read from an environment variable when the
session is created.

### 7. Real quota

`QuotaService` asks the runtime for the account quota (`client.getRpc().account.getQuota()`),
reads `premium_interactions` and caches the answer for 60 seconds. If the reported reset date is
not in the future, it uses the 1st of next month at 00:00 UTC, when GitHub resets premium
counters. If the call fails (not signed in, or BYOK only), `/api/usage` falls back to the local
estimate instead of erroring.

### 8. The runtime's slash commands

`CommandService` exposes the Copilot runtime's own commands (`/context`, `/review`, `/plan`,
`/every`, skills…) through `session.commands.list` / `invoke`. A command runs as a turn: the
stream carries `dashboard.turn_start`, one `dashboard.command_result`
(`kind`: `text`, `completed`, `select`, `turn`, `error` or `info`) and `dashboard.turn_end`, all
tagged with the caller's `requestId` so the browser can tell them from a chat reply. An
`agent-prompt` result becomes a real agent turn whose reply streams as usual.

`CommandPolicy` hides commands that only make sense in a terminal and makes the ones that give the
agent more autonomy (`/autopilot`, `/fleet`, `/every`, `/after`, `/add-dir`, `/plugin`, `/share`,
`/remote`, `/computer`) answer `428` until the request says `confirmed: true`. Plan reviews
(`exit_plan_mode`) are forwarded as `dashboard.plan_review_requested` and wait for the browser.

---

## Configuration (`application.yml`)

| Key | Default | Purpose |
|---|---|---|
| `copilot.cli-path` | *(empty)* | Absolute path to `copilot.exe`; empty = resolve from `COPILOT_CLI_PATH`, then `PATH` |
| `copilot.default-model` | `auto` | Model for new sessions |
| `copilot.default-working-directory` | `${user.home}` | Pre-filled in the new-session form |
| `copilot.event-history-limit` | `500` | Events replayed to a reconnecting browser |
| `copilot.permission-timeout-seconds` | `600` | Unanswered permissions are then denied |
| `copilot.turn-timeout-seconds` | `1800` | Max length of one agent turn. The SDK's own default is 60s, which is too short for real work, so the backend always passes this explicitly. |
| `copilot.forward-all-events` | `false` | Stream every runtime event |
| `copilot.allowed-origins` | `http://localhost:5173` | CORS allow-list |
| `copilot.history-db-path` | `~/.copilot/session-store.db` | CLI session store, read only, for history and the usage estimate |
| `copilot.monthly-premium-budget` | `25000` | Budget for the estimate; used only when the account quota can't be read |
| `copilot.provider.type` | *(empty = off)* | `openai` (also Ollama and other OpenAI-compatible servers), `anthropic` or `azure` |
| `copilot.provider.base-url` | *(empty)* | Provider endpoint, e.g. `http://localhost:11434/v1` for Ollama |
| `copilot.provider.api-key-env` | `CORTEX_PROVIDER_API_KEY` | Name of the environment variable that holds the key; the key itself never goes in a file |
| `copilot.provider.wire-api` | *(empty = completions)* | `completions` or `responses` |
| `copilot.provider.azure-api-version` | *(empty)* | Azure only |
| `copilot.provider.models` | `[]` | Model ids your provider serves; listed first in the model menu |
| `copilot.mcp-servers.<name>` | *(none)* | stdio: `command`, `args`, `env`, `working-directory`. HTTP: `type: http`, `url`, `headers`. Both: `tools` (default `["*"]`) and `timeout` in ms |
| `copilot.personas` | 3 built-ins | `id`, `name`, `description` and `prompt`; the prompt is appended to the system prompt |
| `copilot.default-persona` | *(empty = none)* | Persona used when the browser doesn't pick one |
| `server.address` | `127.0.0.1` | Bind address; override with `CORTEX_BIND_ADDRESS` |
| `spring.mvc.async.request-timeout` | `-1` | Required so SSE streams are not killed |

A local model with [Ollama](https://ollama.com) (no key, no Copilot quota), plus Playwright's
browser tools over MCP:

```yaml
copilot:
  provider:
    type: openai
    base-url: http://localhost:11434/v1
    models: [llama3.2]
  mcp-servers:
    playwright:
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
```

Any key can also be passed on the command line, e.g.
`java -jar app.jar "--copilot.provider.models[0]=llama3.2"`.

---

## Security notes

Sessions run with the SDK's default first-party tools, which include **file editing and shell
access** inside the working directory. What is already in place:

- The backend binds to `127.0.0.1`, so other machines can't reach it. Setting
  `CORTEX_BIND_ADDRESS=0.0.0.0` exposes an unauthenticated agent to your network.
- Provider keys come from an environment variable and are never written to disk or returned by
  the API; `/api/config` reports only `keyConfigured`.
- `/api/config` never returns MCP `env` or `headers`, masks command-line secrets such as
  `--token=…` and `--api-key …`, and strips query strings from MCP URLs.
- MCP tools go through the same permission prompt as built-in tools.

Before exposing this beyond localhost:

- Add authentication and per-user session ownership (sessions are currently global and in-memory).
- Keep `autoApprove` **off**, or restrict it to a safe tool allow-list.
- Run the backend in a container so shell tools cannot touch the host.
- Use `SessionConfig.setGitHubTokenProvider(...)` to issue per-user GitHub tokens instead of
  reusing your personal CLI login.

---

## Where to go next

- **Persist sessions** — keep the Copilot session id and use `client.resumeSession(id, config)` so
  conversations survive a restart.
- **Custom tools** — expose your own Java methods with `@CopilotTool` and let the agent call into
  your services (Jira, Oracle, Datadog…).
- **Markdown rendering** — swap the plain-text bubble for `react-markdown` + syntax highlighting.
- **Abort button** — surface a cancel control for long-running turns.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not locate the Copilot CLI` at startup | `copilot` isn't on `PATH` — set `copilot.cli-path` or `COPILOT_CLI_PATH` |
| `Native runtime metadata not found on classpath` | The SDK wasn't given a `cliPath`; see the note in [Prerequisites](#prerequisites) |
| `Could not start the Copilot runtime` | Run `copilot` once to sign in; or set `copilot.cli-path` |
| `503` on session create | Same as above — the runtime failed to start; check backend logs |
| SSE stream drops after ~30s | Confirm `spring.mvc.async.request-timeout: -1` is set |
| CORS errors in the console | Add your origin to `copilot.allowed-origins` |
| `Working directory does not exist` | Use an absolute path that exists on this machine |
| Permission card never appears | The session was created with `autoApprove: true` |
| Your own model is missing from the menu | `provider.type`, `provider.base-url` and at least one `provider.models` entry are all required |
| `401` / `403` from your provider | Set the key variable (`CORTEX_PROVIDER_API_KEY` by default) in the shell that starts the backend, then restart it |
| `Connection refused` with Ollama | Start it with `ollama serve`; the base URL needs the `/v1` suffix |
| MCP tools are never offered | The server's `command` must be on the backend's `PATH`; run the command by hand to see its error |
| Usage shows `estimate`, not `account` | The account quota couldn't be read (not signed in, or BYOK only), so the figure is local |
| Another machine can't open the app | By design — see `server.address` in [Configuration](#configuration-applicationyml) |
