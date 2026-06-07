# Plugins

Mimo TUI has a plugin system that lets you extend its functionality with custom tools and commands.

## Plugin Architecture

Plugins are discovered from two locations:

1. **Local plugins** -- `.mimo/plugins/` in your project directory
2. **npm plugins** -- packages in `node_modules/` matching the pattern `mimo-plugin-*` (including scoped packages like `@scope/mimo-plugin-*`)

Each plugin consists of:
- A `manifest.json` file describing the plugin
- A JavaScript/TypeScript entry point that exports a plugin object

## Plugin Manifest

Every plugin must have a `manifest.json` in its root directory:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A custom plugin for Mimo TUI",
  "main": "index.js"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique plugin name |
| `version` | string | yes | Semantic version |
| `description` | string | no | Human-readable description |
| `main` | string | yes | Entry point file path (relative to plugin root) |

## Plugin API (PluginContext)

When your plugin's `activate` function is called, it receives a `PluginContext` object:

```typescript
interface PluginContext {
  /** Register a custom tool the AI can call */
  registerTool(tool: Tool): void;

  /** Register a slash command */
  registerCommand(name: string, handler: PluginCommandHandler): void;

  /** Get the current Mimo TUI configuration */
  getConfig(): Config;

  /** Get the current working directory */
  getCwd(): string;
}
```

### registerTool

Register a tool that the AI can invoke during conversations. The tool object must implement:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  requiresApproval?: boolean;  // default true
}
```

### registerCommand

Register a slash command that users can type in the input area.

```typescript
type PluginCommandHandler = (args: string[], ctx: PluginContext) => Promise<string>;
```

The handler receives the command arguments and returns a string to display.

## Creating a Plugin

### Local plugin (project-specific)

1. Create the plugin directory:

```
your-project/
  .mimo/
    plugins/
      my-plugin/
        manifest.json
        index.js
```

2. Write `manifest.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom tool",
  "main": "index.js"
}
```

3. Write `index.js`:

```javascript
export default {
  manifest: {
    name: 'my-plugin',
    version: '1.0.0',
    description: 'My custom tool',
    main: 'index.js',
  },

  activate(ctx) {
    // Register a custom tool
    ctx.registerTool({
      name: 'count_lines',
      description: 'Count the number of lines in a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
      requiresApproval: false,
      async execute(args, toolCtx) {
        const fs = await import('fs');
        const content = fs.readFileSync(args.path, 'utf-8');
        return `File has ${content.split('\\n').length} lines`;
      },
    });

    // Register a custom command
    ctx.registerCommand('hello', async (args) => {
      const name = args[0] || 'world';
      return `Hello, ${name}!`;
    });
  },

  deactivate() {
    // Cleanup if needed
  },
};
```

### npm plugin (reusable)

Create a standard npm package with the naming convention `mimo-plugin-*`:

```
mimo-plugin-my-feature/
  package.json
  manifest.json
  index.js
```

Install it in any project:

```bash
npm install mimo-plugin-my-feature
```

Mimo TUI will automatically discover and activate it.

## Example Plugin: Database Query Tool

Here is a more complete example that adds a SQL query tool:

```javascript
// .mimo/plugins/db-query/index.js
import Database from 'better-sqlite3';

export default {
  activate(ctx) {
    const config = ctx.getConfig();
    const dbPath = config.provider?.dbPath || './data.db';

    ctx.registerTool({
      name: 'db_query',
      description: 'Execute a read-only SQL query against the project database',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL SELECT query' },
        },
        required: ['sql'],
      },
      requiresApproval: false,
      async execute(args) {
        const db = new Database(dbPath, { readonly: true });
        try {
          const rows = db.prepare(args.sql).all();
          return JSON.stringify(rows, null, 2);
        } finally {
          db.close();
        }
      },
    });

    ctx.registerCommand('dbtables', async () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();
        return tables.map(t => t.name).join('\\n');
      } finally {
        db.close();
      }
    });
  },
};
```

## Plugin Lifecycle

1. **Discovery** -- Mimo TUI scans `.mimo/plugins/` and `node_modules/mimo-plugin-*`
2. **Loading** -- Each plugin's entry point is dynamically imported
3. **Activation** -- The `activate(ctx)` function is called with a `PluginContext`
4. **Runtime** -- Registered tools and commands are available throughout the session
5. **Deactivation** -- When the session ends, `deactivate()` is called for cleanup

Errors during plugin loading or activation are logged to stderr but do not prevent Mimo TUI from starting.
