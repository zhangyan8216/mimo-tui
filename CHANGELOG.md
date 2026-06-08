# Changelog

## v1.3.0 (2025-06-08)

### 🚀 New Features — Skill & MCP Installation

- **`/install skill <source>`** — Install skills from URL, npm package, or local path
- **`/install mcp <name> <command> [args...]`** — Install and connect MCP servers
- **`/uninstall skill <name>`** — Remove installed skills
- **`/uninstall mcp <name>`** — Remove MCP server from config
- **`/skills`** — List all installed skills with triggers
- **`/mcp`** — List connected MCP servers and their tools
- **MCP config persistence** — `saveConfig()` now writes `[mcp.servers]` to TOML
- **`addMcpServer()` / `removeMcpServer()`** — Config helper functions

## v1.2.0 (2025-06-08)

### 🎨 UX/Interactivity Overhaul (20+ improvements)

**Critical Fixes:**
- `?` key no longer hijacks typing — help moved to `Ctrl+/`
- Ctrl+C preserves streamed content (adds ⚠️ interrupted marker)
- Approval dialog shows alongside chat, not replacing it
- Approval accepts uppercase Y/A/N keys

**Input Improvements:**
- `Ctrl+W` word-delete, `Ctrl+←/→` word-level cursor movement
- `←/→` arrow keys for character-level cursor movement
- Updated hint bar: `Enter 发送 · Shift+Enter 换行 · ↑↓ 历史 · Ctrl+W 删词`

**Scrollable Views:**
- HelpOverlay: `↑↓`/`PgUp`/`PgDn` scrolling, compact layout, `Esc` to close
- CommandPalette: scrollable with "↑/↓ 更多..." indicators
- SessionPicker: scrollable with delete confirmation (Ctrl+D → Enter confirm)
- SessionPicker: year included in date format

**Display Improvements:**
- Markdown: table rendering, heading differentiation (█/▓/▒), link URLs shown in parentheses
- Markdown: code block background uses theme color instead of hardcoded hex
- Approval dialog: Chinese tool labels, 80-character preview
- StatusBar: context limit updated to 200K (was hardcoded 128K)
- SubAgentPanel: 1-second re-render timer for live duration display
- ThinkingBlock: clean elapsed time tracking (ms-based)
- ChatView: version shows v1.2.0, help shortcut shows Ctrl+/

**Bug Fixes:**
- Tool result matching: prefer name-based match over sequential iteration

## v1.1.0 (2025-06-08)

### 🚀 New Features

- **Multi-agent parallel execution** -- AI can autonomously spawn parallel sub-agents with 3 strategies: `parallel`, `race`, `consensus`
- **AgentMessageBus** -- inter-agent communication for coordinated multi-agent workflows
- **SubAgentPanel** -- real-time progress display for running sub-agents
- **17 built-in tools** -- including the new `multi_agent` tool
- **Configurable concurrency** -- `max_concurrent_agents`, `agent_timeout`, `enable_nested_agents` settings

### 🛡️ Security Fixes (25)

- Fixed 15 command injection vulnerabilities in git commands
- Fixed SQL injection in database CLI fallback
- Fixed pattern injection in test-runner and coverage tools
- Fixed PowerShell/osascript injection in notifications
- Fixed shell injection in auto-commit messages
- Added sandbox path validation to grep, glob, and database tools
- Tightened shell command allow-list (removed `npm publish`, `npx`, `node -e`, `git push`, `git rebase`, `git merge` from auto-approve)
- Added URL protocol validation to web-fetch tool (blocks `file://`)

### 🐛 Bug Fixes (84)

- **API Layer**: Fixed `isAborted` always returning false, `repairJson` destroying URLs, cache marker mutation, system message overwrite
- **Agent Layer**: Fixed empty response infinite loop, regex pipe false positives, token estimation missing tool_calls, compaction breaking conversation alternation
- **Tools**: Fixed multi-edit same-file corruption, shell stdin hanging, todo status validation, database sandbox bypass
- **UI**: Fixed ThinkingBlock duplicate content, CommandPalette/SessionPicker out-of-bounds, SetupWizard API key leak, global timeout unhandled rejection
- **Config**: Fixed shallow copy mutating DEFAULT_CONFIG, reasoningEffort type omission
- **Session**: Fixed deleteSession non-atomic, forkSession losing timestamps, listSessions performance
- **Utils**: Fixed sandbox path boundary bypass, Windows case-sensitivity, symlink cycle stack overflow, Go/Python test detection, cross-platform stderr suppression
- **Data Safety**: Added Array.isArray guards to all JSON persistence (memory, snippets, knowledge-base, history, cost) to prevent data loss on corruption

### 🏗️ Infrastructure

- Graceful shutdown handlers (SIGINT, SIGTERM, unhandledRejection, uncaughtException)
- Production-grade logger with log rotation (max 10 files) and warn/error to stderr
- CI matrix expanded to Node 18, 20, 22
- Release workflow now publishes to npm automatically
- Added `typecheck` and `ci` scripts to package.json
- Added `.npmrc` with engine-strict
- Added CHANGELOG.md and LICENSE file
- Version flag reads from package.json at runtime

### 📝 Documentation

- Fixed tool count (17, not 15/16)
- Fixed placeholder GitHub URL
- Added multi-agent documentation
