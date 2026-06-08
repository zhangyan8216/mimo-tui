# Changelog

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
