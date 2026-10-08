import type { McpContextBase } from './mcp.request.context.js';

/**
 * Server `instructions` for one MCP endpoint: fixed text, or a function of the
 * request that computes it.
 *
 * The function form is how an app tailors the text to the caller. It receives the
 * request's {@link McpContextBase}, so it can read `authenticationSession` and
 * resolve permission or policy services from `container`. It runs only for an
 * `initialize` request, and its answer holds for the rest of the MCP session.
 *
 * Instructions steer the model; they grant nothing. Every tool still enforces its
 * own permissions, and the text must not mention anything the caller is not
 * allowed to know.
 *
 * Return `undefined` to fall back to {@link import('./mcp.config.js').McpConfig.instructions},
 * or `''` to send none.
 */
export type McpInstructions = string | ((context: McpContextBase) => string | undefined | Promise<string | undefined>);

/**
 * Per-call options for {@link import('./mcp.dispatcher.js').McpDispatcher}. Lets
 * a route vary what it advertises without a container of its own, e.g. one
 * welcome text per product endpoint.
 */
export interface McpDispatchOptions {
  /**
   * Overrides {@link import('./mcp.config.js').McpConfig.instructions} for the
   * `initialize` request this call carries. Ignored for every other message.
   */
  instructions?: McpInstructions;
}

/**
 * Resolves {@link McpInstructions} against a request.
 *
 * @param instructions - Fixed text, a resolver, or `undefined`.
 * @param context - The request the text is for.
 * @returns The text, or `undefined` when there is no override.
 */
export const resolveMcpInstructions = async (instructions: McpInstructions | undefined, context: McpContextBase): Promise<string | undefined> =>
  typeof instructions === 'function' ? instructions(context) : instructions;
