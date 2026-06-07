// src/hooks/index.ts - Hook/Event system for extensible lifecycle callbacks

export type HookName =
  | 'pre-tool-execute'
  | 'post-tool-execute'
  | 'pre-send'
  | 'post-response'
  | 'on-error'
  | 'on-session-start'
  | 'on-session-end';

export interface HookContext {
  /** Name of the tool being executed (for tool-related hooks) */
  toolName?: string;
  /** Arguments passed to the tool */
  args?: Record<string, unknown>;
  /** Result returned by the tool (for post-tool-execute) */
  result?: string;
  /** Error that occurred (for on-error / post-tool-execute on failure) */
  error?: Error;
  /** Message history (for pre-send / post-response) */
  messages?: unknown[];
  /** Session ID (for session hooks) */
  sessionId?: string;
  /** Arbitrary extra data hooks can use */
  data?: Record<string, unknown>;
}

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

/**
 * HookManager provides a pub/sub event system for lifecycle hooks.
 *
 * Hooks are triggered at various points in the application lifecycle:
 * - pre-tool-execute: Before a tool runs
 * - post-tool-execute: After a tool runs (success or failure)
 * - pre-send: Before sending messages to the API
 * - post-response: After receiving a response from the API
 * - on-error: When an error occurs
 * - on-session-start: When a new session starts
 * - on-session-end: When a session ends
 *
 * Handlers are executed in registration order. A failing handler does not
 * prevent subsequent handlers from running.
 */
export class HookManager {
  private hooks: Map<HookName, HookHandler[]> = new Map();

  /**
   * Register a handler for a hook.
   */
  register(hookName: HookName, handler: HookHandler): void {
    const handlers = this.hooks.get(hookName) || [];
    handlers.push(handler);
    this.hooks.set(hookName, handlers);
  }

  /**
   * Remove a previously registered handler.
   */
  unregister(hookName: HookName, handler: HookHandler): void {
    const handlers = this.hooks.get(hookName) || [];
    this.hooks.set(hookName, handlers.filter(h => h !== handler));
  }

  /**
   * Trigger all handlers for a hook, in registration order.
   * Errors in individual handlers are caught and logged but do not
   * interrupt execution of remaining handlers.
   */
  async trigger(hookName: HookName, ctx: HookContext): Promise<void> {
    const handlers = this.hooks.get(hookName) || [];
    for (const handler of handlers) {
      try {
        await handler(ctx);
      } catch (err) {
        // Don't let hook errors break the main flow
        console.error(`Hook error (${hookName}):`, err);
      }
    }
  }

  /**
   * Remove all registered hooks.
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Get the number of handlers registered for a specific hook.
   */
  count(hookName: HookName): number {
    return (this.hooks.get(hookName) || []).length;
  }

  /**
   * Get all hook names that have at least one handler registered.
   */
  activeHooks(): HookName[] {
    const active: HookName[] = [];
    for (const [name, handlers] of this.hooks) {
      if (handlers.length > 0) {
        active.push(name);
      }
    }
    return active;
  }
}

/**
 * Global hook manager instance for the application.
 */
export const globalHooks = new HookManager();
