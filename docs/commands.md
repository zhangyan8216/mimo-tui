# Commands Reference

Mimo TUI exposes slash commands that you type in the input area. Commands are case-insensitive.

## Session Management

| Command | Description |
|---------|-------------|
| `/new` | Create a new conversation session |
| `/retry` | Retry the last AI response |
| `/undo` | Undo the last round (user message + AI response) |
| `/rename <name>` | Rename the current session |
| `/export` | Export the conversation as Markdown |
| `/search <query>` | Search across conversation history |
| `/history` | Show command history |
| `/compact` | Compress the conversation context (summarises older messages to free tokens) |

## Git and Project

| Command | Description |
|---------|-------------|
| `/git status` | Show git working tree status |
| `/git diff` | Show unstaged changes |
| `/git log` | Show recent commit history |
| `/tree` | Display the project file tree |
| `/project` | Show project metadata (name, framework, dependencies) |
| `/changes` | List files modified in the current session |

## Model and Configuration

| Command | Description |
|---------|-------------|
| `/mode <mode>` | Switch agent mode: `plan`, `agent`, or `yolo` |
| `/model <name>` | Switch the AI model at runtime |
| `/theme <name>` | Switch UI theme: `default`, `whale`, `matrix`, `dracula`, `solarized` |
| `/config` | Display the current configuration |
| `/health` | Run an API health check (validates key, endpoint, model) |
| `/debug` | Show debug information (session state, token counts, provider details) |

## Cost and Statistics

| Command | Description |
|---------|-------------|
| `/cost` | Show token usage and estimated cost for the current session (including cumulative) |
| `/tokens` | Show context window usage breakdown |
| `/stats` | Show session statistics (message count, tool calls, duration) |
| `/snip` | Open the code snippet library |

## AI Capabilities

| Command | Description |
|---------|-------------|
| `/tpl` | Browse and use conversation templates (12 built-in templates) |
| `/wf` | Browse and run workflows (5 built-in workflows: code review, test generation, refactoring, git commit, debugging) |
| `/mem <key> <value>` | Store a piece of information in AI memory (persists across sessions) |
| `/forget <key>` | Remove a key from AI memory |
| `/suggest` | Get intelligent suggestions based on the current context |
| `/chain` | Chain multiple commands together |

## Plugin Commands

Plugins can register additional slash commands. Any command not recognised as a built-in is forwarded to the plugin system. See [Plugins](plugins.md) for details.
