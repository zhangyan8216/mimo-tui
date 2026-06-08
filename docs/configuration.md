# Configuration Reference

Mimo TUI is configured through `~/.mimo/config.toml` and environment variables.

## Config File Location

- **Path:** `~/.mimo/config.toml`
- **Format:** TOML
- The `~/.mimo/` directory is created automatically when you run `mimo --setup` or save configuration changes.

## Full Reference

```toml
[provider]
api_key = "tp-your-key"                                # API authentication key
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"  # API endpoint
model = "mimo-v2.5-pro"                                 # Model identifier
provider_type = "auto"                                   # auto | anthropic | openai | gemini

[agent]
mode = "agent"                    # plan | agent | yolo
max_iterations = 32               # Maximum tool-call iterations per response
auto_approve_reads = true         # Auto-approve read-only tools (read_file, glob, grep)
thinking_enabled = true           # Enable extended thinking/reasoning (Anthropic/MiMo)
reasoning_effort = "medium"       # low | medium | high

[ui]
theme = "default"                 # default | whale | matrix | dracula | solarized
show_thinking = true              # Display the AI's reasoning process
show_tokens = true                # Display token usage in the status bar
compact_mode = false              # Use a more compact message layout

[mcp]
# MCP (Model Context Protocol) servers
# Add one or more [[mcp.servers]] entries
```

## Section: [provider]

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `api_key` | string | `""` | API authentication key. Required. |
| `base_url` | string | `"https://token-plan-cn.xiaomimimo.com/anthropic"` | API endpoint URL. |
| `model` | string | `"mimo-v2.5-pro"` | Model identifier to use. |
| `provider_type` | string | `"auto"` | Provider backend: `auto`, `anthropic`, `openai`, or `gemini`. When `auto`, detected from `base_url`. |

## Section: [agent]

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | string | `"agent"` | Starting agent mode: `plan` (read-only), `agent` (interactive), `yolo` (auto-approve all). |
| `max_iterations` | number | `32` | Maximum tool-call iterations the AI can make in a single response. |
| `auto_approve_reads` | boolean | `true` | Automatically approve read-only tool calls without user confirmation. |
| `thinking_enabled` | boolean | `true` | Enable extended thinking / reasoning display. Anthropic/MiMo provider only. |
| `reasoning_effort` | string | `"medium"` | Reasoning budget: `low` (5K tokens), `medium` (10K tokens), `high` (20K tokens). |

## Section: [ui]

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `theme` | string | `"default"` | UI colour theme. Options: `default`, `whale`, `matrix`, `dracula`, `solarized`. |
| `show_thinking` | boolean | `true` | Show the AI's reasoning/thinking blocks in the conversation. |
| `show_tokens` | boolean | `true` | Show token usage statistics in the status bar. |
| `compact_mode` | boolean | `false` | Use a more compact layout for messages (less whitespace). |

## Section: [mcp]

MCP (Model Context Protocol) servers allow you to connect external tool servers.

```toml
[[mcp.servers]]
name = "my-server"
transport = "stdio"
command = "node"
args = ["path/to/server.js"]

[[mcp.servers]]
name = "remote-server"
transport = "http"
url = "http://localhost:3000"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | yes | Unique server name |
| `transport` | string | yes | `stdio` or `http` |
| `command` | string | for stdio | Command to launch the server process |
| `args` | string[] | no | Arguments for the command |
| `url` | string | for http | Server URL |
| `env` | map | no | Environment variables for the server process |

## Environment Variables

Environment variables override config file values:

| Variable | Overrides |
|----------|-----------|
| `MIMO_API_KEY` | `provider.api_key` |
| `MIMO_BASE_URL` | `provider.base_url` |
| `MIMO_MODEL` | `provider.model` |
| `MIMO_PROVIDER_TYPE` | `provider.provider_type` |
| `MIMO_HOME` | User data directory. Defaults to `~/.mimo` |

## Setup Wizard

Run the interactive setup wizard to generate or update the config file:

```bash
mimo --setup
```

The wizard guides you through provider selection, API key entry, and basic preferences.
