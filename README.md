# Mimo TUI

Terminal AI coding agent powered by Xiaomi MiMo. A full-screen TUI (Terminal User Interface) that connects to AI models through an Anthropic-compatible API for interactive code editing, tool use, and agentic workflows.

## Features

- **Full-screen TUI** -- built with Ink (React for CLI), card-based message rendering
- **Streaming responses** -- real-time output at 30fps, displays reasoning/thinking process
- **16 built-in tools** -- read/write/edit files, shell commands, glob, grep, web fetch, todo, test runner, codebase analysis (6 actions), docker (8 actions), coverage, multi-edit, database (4 actions), code review (4 actions), benchmark (4 actions)
- **3 provider backends** -- Anthropic/MiMo (default), OpenAI/GPT, Google Gemini with auto-detection
- **3 agent modes** -- Plan (read-only), Agent (interactive approval), YOLO (auto-approve)
- **AI memory** -- persist user preferences across sessions, auto-injected into system prompt
- **5 workflows** -- code review, test generation, refactoring, git commit, debugging
- **50+ slash commands** -- session, git, model, cost, AI, and plugin commands
- **35+ git sub-commands** -- full git workflow integration
- **Context compression** -- automatic summarisation of old messages when context grows too long
- **Plugin system** -- extend with custom tools and commands via local or npm plugins
- **5 themes** -- default, Whale, Matrix, Dracula, Solarized
- **MiMo fault tolerance** -- automatic retry on rate limits, JSON repair for malformed tool parameters, streaming reconnection

## Quick Start

```bash
# Install globally
npm install -g mimo-tui

# Run the setup wizard
mimo --setup

# Start a session
mimo
```

## Installation

```bash
npm install -g mimo-tui
```

Requires Node.js 18 or later.

Alternatively, clone and build from source:

```bash
git clone https://github.com/YOUR_USERNAME/mimo-tui.git
cd mimo-tui
npm install
npm run build
npm start
```

## Configuration

Run the interactive setup wizard:

```bash
mimo --setup
```

Or create `~/.mimo/config.toml` manually:

```toml
[provider]
api_key = "tp-your-key"
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"
model = "mimo-v2.5-pro"
# provider_type = "auto"  # auto | anthropic | openai | gemini

[agent]
mode = "agent"              # plan | agent | yolo
max_iterations = 32
auto_approve_reads = true
thinking_enabled = true
reasoning_effort = "medium" # low | medium | high

[ui]
theme = "default"           # default | whale | matrix | dracula | solarized
show_thinking = true
show_tokens = true
```

Environment variables override config file values:

| Variable | Description |
|----------|-------------|
| `MIMO_API_KEY` | API key |
| `MIMO_BASE_URL` | API base URL |
| `MIMO_MODEL` | Model name |
| `MIMO_PROVIDER_TYPE` | Provider type |

See the full [Configuration Reference](docs/configuration.md).

## Keyboard Shortcuts

| Shortcut | Action | Shortcut | Action |
|----------|--------|----------|--------|
| `Ctrl+K` | Command palette | `Ctrl+R` | Session list |
| `Ctrl+N` | New session | `Ctrl+L` | Clear screen |
| `Ctrl+Z` | Undo | `Ctrl+C` | Cancel / Exit |
| `Alt+1` | Plan mode | `Alt+2` | Agent mode |
| `Alt+3` | YOLO mode | `?` | Help |

## Commands

### Session
```
/new            New session          /retry          Retry last response
/undo           Undo last round      /export         Export as Markdown
/rename <name>  Rename session       /search <query> Search history
/history        Command history      /compact        Compress context
```

### Git and Project
```
/git status     Git status           /git diff       Git diff
/git log        Commit log           /tree           File tree
/project        Project info         /changes        Modified files
```

### Model and Config
```
/mode <mode>    Switch mode          /model <name>   Switch model
/theme <name>   Switch theme         /config         Show config
/health         API health check     /debug          Debug info
```

### Cost and Stats
```
/cost           Cost tracking        /tokens         Context usage
/stats          Session stats        /snip           Snippet library
```

### AI Capabilities
```
/tpl            Templates (12)       /wf             Workflows (5)
/mem <k> <v>    Remember info        /forget <k>     Forget info
/suggest        Smart suggestions    /chain          Command chain
/kb             Knowledge base       /parallel       Parallel execution
/pipeline       Pipeline mode        /explore        Code exploration
/review         Code review          /auto           Auto-pilot mode
/sub            Sub-agent            /batch          Batch operations
/monitor        Performance monitor  /metrics        Metrics report
/tips           Usage tips           /kill           Kill process
/clean          Clean workspace      /improve        Improve code
/doctor         Health diagnostics   /fix            Auto-fix issues
/think          Deep reasoning       /context        Context info
/debug agents   Agent debug          /config edit    Edit config
/config reset   Reset config
```

See the full [Commands Reference](docs/commands.md).

## Tools

The AI has access to 15 built-in tools:

| Tool | Description | Approval |
|------|-------------|----------|
| `read_file` | Read file contents with line numbers | No |
| `write_file` | Create or overwrite files | Yes |
| `edit_file` | Precise search-and-replace in files | Yes |
| `multi_edit` | Atomic batch edits across files | Yes |
| `shell` | Execute shell commands | Yes |
| `glob` | Find files by glob pattern | No |
| `grep` | Search file contents with regex | No |
| `web_fetch` | Fetch URL content | Yes |
| `todo` | Session task management | No |
| `test_runner` | Auto-detect and run tests | Yes |
| `codebase` | Codebase analysis (index, symbols, deps) | No |
| `docker` | Docker container operations | Yes |
| `coverage` | Test coverage reporting | Yes |

See the full [Tools Reference](docs/tools.md).

## Providers

Mimo TUI supports three AI backends with automatic detection from the base URL:

| Provider | URL pattern | Default model |
|----------|-------------|---------------|
| **Anthropic/MiMo** | default | `mimo-v2.5-pro` |
| **OpenAI** | `openai.com`, `azure` | `gpt-4o` |
| **Google Gemini** | `google`, `gemini` | `gemini-2.0-flash` |

Set `provider_type` explicitly in config or use the `MIMO_PROVIDER_TYPE` env var to override auto-detection.

See the full [Providers Guide](docs/providers.md).

## Plugins

Extend Mimo TUI with custom tools and commands:

- **Local plugins** -- place in `.mimo/plugins/<name>/` in your project
- **npm plugins** -- install packages matching `mimo-plugin-*`

Each plugin has a `manifest.json` and an entry point that exports an `activate(ctx)` function. The `PluginContext` lets you register tools and slash commands.

See the full [Plugins Guide](docs/plugins.md).

## Project Structure

```
src/
  index.tsx              Entry point
  config.ts              Configuration (~/.mimo/config.toml)
  api/
    client.ts            Anthropic API client (with retry/fault tolerance)
    provider.ts          Unified provider adapter interface
    types.ts             Type definitions
    providers/
      anthropic.ts       Anthropic/MiMo provider
      openai.ts          OpenAI provider
      gemini.ts          Google Gemini provider
  tools/                 15 built-in tools
  tui/                   Ink/React UI components
  agent/
    loop.ts              Agent main loop
    modes.ts             Plan/Agent/YOLO modes
    compact.ts           Context compression
    sub-agent.ts         Sub-agent support
  session/               SQLite session persistence
  mcp/                   MCP protocol client
  skills/                Skill system
  plugins/               Plugin system
  analysis/              Code analysis (deps, AST)
  utils/                 Utilities (git, memory, cost, etc.)
```

## MiMo Fault Tolerance

Automatic handling for known MiMo model issues:

| Issue | Handling |
|-------|----------|
| Infinite repetition loops | Detects repeated text, truncates and prompts |
| 429 rate limits | Exponential backoff with automatic retry |
| tool_use parameter serialisation | Dual-parse repair |
| System message position | System in top-level field only |
| Streaming disconnection | Automatic reconnection via fetchWithRetry |
| Malformed JSON in tool args | Multi-step JSON repair (trailing commas, single quotes, unescaped newlines, missing brackets) |

## Documentation

- [Getting Started](docs/getting-started.md)
- [Commands Reference](docs/commands.md)
- [Tools Reference](docs/tools.md)
- [Providers Guide](docs/providers.md)
- [Plugins Guide](docs/plugins.md)
- [Configuration Reference](docs/configuration.md)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run the build (`npm run build`) and type check (`npx tsc --noEmit`)
5. Commit and push
6. Open a Pull Request

## License

MIT
