# Tools Reference

Tools are functions the AI can call to interact with your environment. In **Agent** mode, write and shell tools require your approval. In **YOLO** mode all tools run without confirmation.

## read_file

Read file contents with line numbers. You must read a file before editing it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path, e.g. `"src/index.ts"` |
| `offset` | number | no | Starting line number (0-based). Defaults to 0 |
| `limit` | number | no | Maximum lines to read. Defaults to 2000 |

**Requires approval:** No

## write_file

Create a new file or completely overwrite an existing one. Auto-creates parent directories. For modifying existing files prefer `edit_file`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `content` | string | yes | Complete file content to write |

**Requires approval:** Yes

## edit_file

Precise search-and-replace in an existing file. The `old_string` must match exactly (including whitespace) and must appear only once in the file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `old_string` | string | yes | Text to replace (must be unique in the file) |
| `new_string` | string | yes | Replacement text. Empty string `""` to delete |

**Requires approval:** Yes

## multi_edit

Atomic batch edit across multiple files. All edits are validated first; if any validation fails, none are applied.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `edits` | array | yes | Array of `{file, old_text, new_text}` objects |

**Requires approval:** Yes

## shell

Execute a shell command. On Windows, commands run in PowerShell automatically. Output is truncated at 100 KB (stdout) and 50 KB (stderr).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Shell command to execute |
| `timeout` | number | no | Timeout in milliseconds. Default 60000, max 300000 |

**Requires approval:** Yes

## glob

Find files matching a glob pattern. Automatically excludes `node_modules`, `.git`, and `dist`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Glob pattern, e.g. `"**/*.ts"` |
| `path` | string | no | Search directory. Defaults to cwd |
| `limit` | number | no | Maximum results. Default 100 |

**Requires approval:** No

## grep

Search file contents with a regular expression. Uses ripgrep when available, falls back to a built-in search.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Regex pattern |
| `path` | string | no | Search directory or file |
| `glob` | string | no | File filter, e.g. `"*.ts"` |
| `case_insensitive` | boolean | no | Ignore case. Default false |
| `max_results` | number | no | Maximum results. Default 50 |

**Requires approval:** No

## web_fetch

Fetch a URL and return its text content. Useful for reading documentation or API references.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to fetch |
| `max_length` | number | no | Maximum characters to return. Default 10000 |

**Requires approval:** Yes

## todo

Manage a task list for the current session. Break complex work into steps and track progress.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add`, `update`, `list`, or `clear` |
| `content` | string | no | Task description (required for `add`) |
| `id` | number | no | Task ID (for `update`) |
| `status` | string | no | New status: `pending`, `in_progress`, `completed` (for `update`) |

**Requires approval:** No

## test_runner

Detect and run the project test suite. Supports Jest, Vitest, Mocha, pytest, Go test, and Cargo test. Returns a structured summary of passed/failed/skipped counts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | no | Custom test command (overrides auto-detection) |
| `pattern` | string | no | Test file filter |
| `verbose` | boolean | no | Return full output instead of summary |

**Requires approval:** Yes

## codebase

Codebase intelligence tool. **Call this first** when starting a new task to understand the project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | Sub-command (see below) |
| `target` | string | no | File path or symbol name |
| `path` | string | no | Scan root directory |

Sub-commands:

- `index` -- scan project, return file count, line count, entry points, exported symbols
- `symbols` -- find symbol definitions by name or path
- `deps` -- show import/dependency graph for a file
- `related` -- find files related to a given file (same directory, shared imports, similar names)
- `deps-analysis` -- analyse npm dependencies, detect unused or undeclared packages

**Requires approval:** No

## docker

Manage Docker containers and images.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `build`, `run`, `ps`, `logs`, `stop`, `rm`, `images`, `exec` |
| `target` | string | no | Image name, container name, or Dockerfile path |
| `args` | string | no | Extra arguments |
| `command` | string | no | Command for `exec` action |

**Requires approval:** Yes

## coverage

Run tests with coverage and report results. Auto-detects the coverage tool for the project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `run` (execute tests) or `report` (view existing report) |
| `pattern` | string | no | Test file filter |
| `threshold` | number | no | Coverage percentage threshold (0-100) |

**Requires approval:** Yes

## Common Patterns

### Read then edit

The AI always reads a file with `read_file` before using `edit_file`. This ensures `old_string` matches the actual file content.

### Cross-file refactoring

For changes spanning multiple files, the AI uses `multi_edit` which validates all edits atomically before applying any.

### Explore before acting

In Plan mode the AI will use `codebase`, `read_file`, `glob`, and `grep` to understand the project before proposing changes.
