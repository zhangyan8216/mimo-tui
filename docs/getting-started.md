# Getting Started

This guide walks you through installing Mimo TUI, configuring your API key, and running your first session. The npm package is `mimo-ai-cli` and it installs the `mimo` command.

## Prerequisites

- **Node.js** 20 or later
- **npm** 9 or later
- An API key for your chosen provider (see [Providers](providers.md))

## Installation

```bash
npm install -g mimo-ai-cli
```

After installation the `mimo` command is available globally.

## First Run -- Setup Wizard

Run the interactive setup wizard to configure your API provider:

```bash
mimo --setup
```

The wizard will prompt you for:

1. **Provider** -- which AI backend to use (MiMo, OpenAI, or Gemini)
2. **API Key** -- your authentication key
3. **Base URL** -- the API endpoint (auto-filled for known providers)
4. **Model** -- which model to use (auto-filled with the provider default)
5. **Theme** -- UI colour scheme

The configuration is saved to `~/.mimo/config.toml`.

## Configuration File

`~/.mimo/config.toml` is the central configuration file. Here is a minimal example:

```toml
[provider]
api_key = "tp-your-key"
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"
model = "mimo-v2.5-pro"
```

See [Configuration Reference](configuration.md) for every available option.

## Basic Usage

### Starting a session

```bash
mimo
```

This launches the full-screen TUI in the current directory.

### Sending messages

Type your message in the input area at the bottom of the screen and press **Enter** to send. The AI responds with streaming text and may invoke tools (reading files, running commands, etc.) as needed.

### Using tools

Tools are invoked automatically by the AI when it needs to interact with your codebase. You will see tool calls rendered as collapsible cards in the conversation. In **Agent** mode, write operations require your approval before execution.

### Keyboard shortcuts

| Shortcut | Action | Shortcut | Action |
|----------|--------|----------|--------|
| `Ctrl+K` | Command palette | `Ctrl+R` | Session list |
| `Ctrl+N` | New session | `Ctrl+L` | Clear screen |
| `Ctrl+Z` | Undo | `Ctrl+C` | Cancel / Exit |
| `Alt+1` | Plan mode | `Alt+2` | Agent mode |
| `Alt+3` | YOLO mode | `Ctrl+/` | Help |

### Agent modes

Mimo TUI has three execution modes that control how the AI interacts with your project:

- **Plan** (read-only) -- the AI analyses and plans but does not modify files or run commands.
- **Agent** (default) -- the AI can read freely but write operations require your approval.
- **YOLO** -- all operations are auto-approved. Use with caution.

Switch modes with `Alt+1/2/3` or the `/mode` command.

## Next Steps

- [Commands Reference](commands.md) -- all slash commands
- [Tools Reference](tools.md) -- built-in tools the AI can use
- [Providers](providers.md) -- configure different AI backends
- [Plugins](plugins.md) -- extend Mimo TUI with plugins
- [Configuration](configuration.md) -- full config.toml reference
