# Providers

Mimo TUI supports three AI provider backends. The provider is configured in `~/.mimo/config.toml` or via environment variables.

## Supported Providers

### Anthropic / MiMo (default)

Xiaomi's MiMo models are served through an Anthropic-compatible API. This is the default and recommended provider.

```toml
[provider]
api_key = "tp-your-key"
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"
model = "mimo-v2.5-pro"
```

**Features:**

- Streaming responses with thinking/reasoning display
- Prompt caching for reduced latency and cost
- Automatic retry on 429 rate limits (exponential backoff)
- JSON repair for malformed tool_use parameters
- Adaptive reasoning budget (low / medium / high)

**Available models:** `mimo-v2.5-pro`, `mimo-v2-lite` (check provider for current list)

### OpenAI / GPT

Use OpenAI models or any OpenAI-compatible API.

```toml
[provider]
api_key = "sk-your-key"
base_url = "https://api.openai.com/v1"
model = "gpt-4o"
provider_type = "openai"
```

**Features:**

- Full tool use support
- Streaming responses
- Compatible with Azure OpenAI (set the Azure endpoint as `base_url`)

**Available models:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`, `o1-mini`, etc.

### Google Gemini

Use Google's Gemini models.

```toml
[provider]
api_key = "your-gemini-key"
base_url = "https://generativelanguage.googleapis.com/v1beta"
model = "gemini-2.0-flash"
provider_type = "gemini"
```

**Features:**

- Streaming responses
- Tool use via function declarations
- System instruction support

**Available models:** `gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-flash`, `gemini-1.5-pro`, etc.

## Auto-Detection

When `provider_type` is set to `"auto"` (the default), the provider is detected from the `base_url`:

| URL contains | Detected provider |
|---|---|
| `openai.com` or `azure` | OpenAI |
| `google` or `gemini` | Gemini |
| Anything else | Anthropic |

You can override auto-detection by setting `provider_type` explicitly:

```toml
[provider]
provider_type = "openai"  # or "anthropic" or "gemini"
```

## Environment Variables

All provider settings can be overridden with environment variables:

| Variable | Description |
|----------|-------------|
| `MIMO_API_KEY` | API key |
| `MIMO_BASE_URL` | API base URL |
| `MIMO_MODEL` | Model name |
| `MIMO_PROVIDER_TYPE` | Provider type (`anthropic`, `openai`, `gemini`, `auto`) |

Environment variables take precedence over the config file.

## Model-Specific Features

### Thinking / Reasoning (Anthropic/MiMo only)

The Anthropic provider supports extended thinking with a configurable reasoning budget:

```toml
[agent]
thinking_enabled = true
reasoning_effort = "medium"  # low | medium | high
```

The reasoning budget maps to token limits:
- `low` -- 5,000 tokens
- `medium` -- 10,000 tokens (default)
- `high` -- 20,000 tokens

When thinking is enabled, the AI's reasoning process is displayed in the TUI (can be toggled with `show_thinking` in the UI config).

### Prompt Caching (Anthropic/MiMo only)

The Anthropic provider automatically applies prompt caching to:
- The system prompt (entire prompt is cached)
- Historical messages (messages older than the last 4 are cached)

This reduces latency and cost for long conversations. Cache hit/miss statistics are shown in the token usage display.
