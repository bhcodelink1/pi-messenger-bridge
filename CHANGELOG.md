# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Session creation and session switching stalled for 5-10 seconds. Pi awaits every `session_shutdown` handler before it builds the next session, and the bridge's handler awaited `transportManager.disconnectAll()`. Telegram's `stopPolling()` with no options waits for the in-flight `getUpdates` long-poll to come back from the server, which is `polling.params.timeout` (10 seconds by default), so `/new`, `/clear`, `/resume`, fork, clone, `/reload` and quit each froze the terminal until Telegram answered. Measured against the real bot: 9242ms before, 0ms after. `disconnect()` now passes `{ cancel: true }`, `TransportManager.disconnectAll()` takes a 1 second deadline so no transport can block Pi at all, and Matrix's `client.stop()` is bounded the same way

### Changed
- Messenger connections now survive session replacement. Pi re-runs the extension factory on every `/new`, `/resume`, fork and `/reload`, which used to tear every transport down and dial it back up; Telegram answered the fresh long-poll with `409 terminated by other getUpdates request` while the previous socket was still registered server-side, and the bridge was unreachable for the length of the redial. Transports, auth state and the sticky reply target moved to a process-wide holder in `src/runtime.ts` (the single-instance lock in `lock.ts` already assumed one live connection per machine), `session_shutdown` only disconnects on `reason: "quit"`, and each `session_start` rebinds the inbound sink to the live session's `sendUserMessage`. Inbound messages that arrive in the gap between sessions are logged and dropped instead of being written to a dead session. A session start also re-dials transports that are still idle, so a process that lost the lock at startup recovers once the other pi quits
- Extension startup no longer evaluates the messenger SDKs. `node-telegram-bot-api` (which pulls in `request`, hence the `util._extend is deprecated` warning) and `matrix-bot-sdk` were static imports, so both loaded even when only Telegram was configured. All five transports now load their SDK on `connect()`, and `qrcode-terminal` loads on the first WhatsApp QR prompt. Importing the compiled extension dropped from 207ms to 9ms
- `connect()` waits at most 2 seconds for the first `getUpdates` instead of the full 10 second long-poll, so `/msg-bridge connect` reports promptly. Polling failures still surface through `polling_error`
- The transient `409 terminated by other getUpdates request` during a reconnect window is no longer reported as a transport error
- Sticky reply status lines read `(no messenger chat seen yet)` instead of `(no messenger chat seen yet this session)`, since the sticky target now outlives a session

### Added
- `src/async-util.ts` with `withDeadline(promise, ms)`, used by the transport teardown paths
- `tests/manager.test.ts` covering the `disconnectAll` deadline, and six cases in `tests/extension-turn-end.test.ts` covering session replacement: no disconnect on `new`/`resume`/`fork`/`reload`, disconnect on `quit`, transports built once per process, inbound routing follows the live session, the sticky target survives replacement
- `interimMessages` config key (`"all"` default, `"first"`, `"off"`) controlling how much is forwarded between a remote question and its answer. A turn that ends in a tool call is Pi deciding on a next step rather than answering, and the old behaviour forwarded its assistant text too, so a research run reaching for a dozen pages sent a phone notification per step. With `"first"` one interim message goes out per request and the rest are dropped, which keeps the short "looking into it" line that rides the same turn as a `spawn` call while silencing the running commentary after it. `"off"` waits for the answer. A turn with no tool calls is a final answer and always delivers, including a late subagent report on a turn the bridge never saw a message for, and a suppressed turn leaves the in-flight request open so the answer still has somewhere to go. Tool-calling turns addressed to the sticky target are dropped under `"first"` and `"off"`, since those are terminal-driven work narrating at a phone with no request boundary to count against. The allowance is only recorded after a successful send, so a transport failure does not burn a request's one acknowledgement

## [0.5.0] - 2026-10-15

### Added
- Sticky replies — the bridge remembers the last messenger chat a message arrived from and delivers turns that finish after their request was already answered. This is the fix for background subagent reports: pi answers "the subagent is running" from Telegram, which closed the in-flight request, and the report arriving minutes later was written to the pi session and never sent. On by default. Toggle with `stickyReplies` in config, `/msg-bridge sticky [on|off]` in pi, or `/sticky [on|off]` in a DM with the bot. Sticky deliveries carry assistant text only, so tool call summaries never leak into your terminal-driven work. Routing rules live in `src/reply-routing.ts` with unit tests, and `tests/extension-turn-end.test.ts` drives the real `turn_end` handler through the three-turn sequence that used to fail
- Typing indicator heartbeat — the indicator now survives long tool runs. `turn_start` starts it, `tool_execution_start` re-pings and resets the timer, and a refresh timer re-sends every `typingRefreshMs` (default 4000 ms, clamped to 1000-20000) until the answer is delivered. Previously one indicator was sent per turn, which Telegram, WhatsApp, and Discord cleared after 3-10 seconds while a build or fetch was still running
- `typingIndicator` and `typingRefreshMs` config keys, `/msg-bridge typing [seconds]` pi command, matching `/typing [seconds]` DM admin command, and a Typing entry in the `/msg-bridge` interactive menu
- Sticky replies entry in the `/msg-bridge` interactive menu, and a `Sticky replies: on -> telegram:<chatId>` line in `/msg-bridge status`

### Fixed
- `npm test` picked up the compiled copies of the test files in `dist/` (committed so pi can install from git) and failed on missing dev dependencies. `vitest.config.mjs` now runs `src/` and `tests/` only

## [0.4.0] - 2026-05-09

### Added
- Matrix transport via `matrix-bot-sdk` — works with Element X, Element Web, FluffyChat, any Matrix client. Auto-joins rooms, group chat support with mention detection, optional E2EE (Rust SDK crypto store). Set `"encryption": false` in the `matrix` config to disable E2EE (thanks @jchidley)
- `hideToolCalls` config option, `/msg-bridge toggletools` pi command, and matching `/toggletools` DM admin command — trusted users can hide/show tool call summaries in their replies from either side
- Empty-message guard in all transports (Discord, Telegram, Slack, WhatsApp, Matrix) to prevent provider errors on whitespace-only payloads

### Changed
- Tool call summaries now wrap the tool name in inline-code backticks (`🔧 \`hud_canvas\` (...)`), rendering as code across all 5 transports and avoiding Telegram's underscore-escape backslashes leaking into messages
- Migrated peer dependencies from deprecated `@mariozechner/pi-{ai,coding-agent,tui}` to `@earendil-works/pi-{ai,coding-agent,tui}` (>=0.74). The `@mariozechner` packages were deprecated upstream with the message "please use @earendil-works/pi-coding-agent instead going forward"
- Tightened peer constraints from `*` to `>=0.74` and removed the duplicated entries from devDependencies (npm auto-installs peers in dev)
- Bumped devDependency floors: `@biomejs/biome` ^2.4.14, `@types/node` ^25.6.2, `typescript` ^6.0.3, `vitest` ^4.1.5

### Fixed
- `sendUserMessage` crash when a remote message arrives mid-turn — messages are now queued via `{ deliverAs: "followUp" }` so each remote message gets its own turn after the current one finishes, instead of being interleaved into it (fixes #10)
- `pendingRemoteChat` no longer cleared on tool-call-only turns, so the next response reaches the right chat
- Whitespace-only assistant responses no longer trigger Discord's "Cannot send an empty message" error
- Telegram MarkdownV1 parse errors on stray special chars (e.g. snake_case tool names like `hud_canvas` triggering `400 Bad Request: can't parse entities`). `formatForTelegram` now lifts valid markdown patterns into sentinel placeholders, escapes literal `_*[\``, then restores

## [0.3.0] - 2026-03-25

### Added
- Interactive menu (`/msg-bridge` with no args) — configure, connect, widget, help via `ui.select()`
- Single-instance connection guard to prevent duplicate polling / 409 conflicts (fixes #2)
  - Layer 1: global flag for same-process re-entrant calls (sub-agents)
  - Layer 2: PID lock file (`~/.pi/msg-bridge.lock`) for cross-process duplicates
- Session shutdown handler — releases lock and disconnects transports on exit
- Lock check on `/msg-bridge configure` connect calls to prevent bypassing the guard
- Test suite (vitest): config, lock, and formatting modules
- CI workflow (GitHub Actions: lint + typecheck + test)
- Biome linter configuration

### Fixed
- Discord DM messages not received — added required `Partials.Channel` and `Partials.Message` to client options (fixes #5, thanks @chr15m)
- Transport errors now show clean messages instead of full stack traces

### Changed
- Extracted `config.ts`, `lock.ts`, `formatting.ts`, `ui/main-menu.ts` from index.ts
- Moved `@mariozechner/pi-*` packages to peerDependencies
- Updated devDependencies: typescript ^6.0.2, @types/node ^25.3.0, @biomejs/biome ^2.4.8, vitest ^4.1.1
- `prepublishOnly` now runs lint and typecheck before build
- Applied `npm audit fix` for transitive dependency vulnerabilities

## [0.2.1] - 2026-02-11

### Changed
- Package renamed from `pi-msg-bridge` to `pi-messenger-bridge` for better clarity
- Updated all repository URLs and documentation to reflect new package name
- Command remains `/msg-bridge` for brevity and ease of use

## [0.2.0] - 2026-02-11

### Added
- WhatsApp integration via Baileys library with QR code authentication
- Slack integration with Socket Mode support
- Discord integration with Message Content intent support
- Debug mode for troubleshooting (config.debug or MSG_BRIDGE_DEBUG env var)
- Non-blocking async transport initialization for faster startup
- Widget toggle command (`/msg-bridge widget`)
- Help command with full command reference
- Automatic invalid session cleanup (WhatsApp 401 handling)
- Session detection to prevent QR spam on startup

### Changed
- Renamed from "remote-pilot" to "msg-bridge" throughout codebase
- Command changed from `/remote` to `/msg-bridge`
- Config file moved from `~/.pi/msg-bridge/config.json` to `~/.pi/msg-bridge.json`
- WhatsApp auth directory: `~/.pi/msg-bridge-whatsapp-auth/`
- All debug output now behind debug flag (no spam by default)
- Status widget only shows connected transports
- Environment variables now override config file settings

### Security
- Config file permissions enforced: chmod 600 for files, 700 for directories
- Config directory permissions validated on startup with warnings
- WhatsApp auth directory created with secure permissions (700)
- Invalid WhatsApp sessions automatically cleared on 401 errors

### Fixed
- QR code display for WhatsApp (using qrcode-terminal instead of Baileys built-in)
- Tool call formatting now shows actual parameters instead of speculation
- Username extraction from WhatsApp messages
- Connection state tracking for accurate widget display
- Startup performance (transports load in background)

### Dependencies
- Added: @whiskeysockets/baileys, qrcode-terminal, @slack/bolt, discord.js
- Known vulnerabilities in transitive dependencies (node-telegram-bot-api, discord.js) - low impact for this use case

## [0.1.0] - 2026-02-10

### Added
- Initial MVP release
- Event-driven architecture using `pi.sendUserMessage()` and `turn_end` events
- Telegram bot integration with polling support
- Challenge-based authentication (6-digit codes)
- Trusted user management
- Admin commands for user and channel management
- Status widget showing connection status
- Commands: `/remote`, `/remote connect`, `/remote disconnect`, `/remote configure`
- Environment variable and file-based configuration
- Support for group chats with mention detection
- Channel authorization modes: all, mentions, trusted-only

### Security
- 6-digit challenge codes with 2-minute expiry
- 3-attempt limit with 5-minute blocking
- First authenticated user becomes admin
- Trusted user validation on all messages

[unreleased]: https://github.com/tintinweb/pi-messenger-bridge/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/tintinweb/pi-messenger-bridge/releases/tag/v0.4.0
[0.1.0]: https://github.com/tintinweb/pi-messenger-bridge/releases/tag/v0.1.0
