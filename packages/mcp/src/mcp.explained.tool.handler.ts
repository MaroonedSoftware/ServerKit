import { IsHttpError, type HttpError } from '@maroonedsoftware/errors';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolContext } from './mcp.request.context.js';
import { McpToolHandlerMap, type McpToolHandler } from './mcp.tool.handler.js';

/** Detail-key prefixes an HTTP validator adds that mean nothing to a tool's caller. */
const FIELD_PREFIXES = ['body.', 'query.'];

/** What the model is told when the failure is not one it can do anything about. */
const GENERIC_FAILURE = 'The tool failed. Try again later.';

/** Reads a header from an `HttpError` without assuming its casing. */
const headerValue = (error: HttpError, name: string): string | undefined => {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(error.headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
};

/** Strips a transport prefix (`body.`, `query.`) from a detail key and names the root. */
const fieldName = (key: string): string => {
  const prefix = FIELD_PREFIXES.find(candidate => key.startsWith(candidate));
  const field = prefix ? key.slice(prefix.length) : key;
  return field === '_root' || field === '' ? 'the arguments as a whole' : field;
};

/** Renders one detail value (`zodErrorDetails` shape: a string or a string array). */
const fieldMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const messages = value.filter((message): message is string => typeof message === 'string');
    return messages.length > 0 ? messages.join('; ') : undefined;
  }
  return undefined;
};

const explainInvalidArguments = (error: HttpError): string => {
  const lines = Object.entries(error.details ?? {}).flatMap(([key, value]) => {
    const message = fieldMessage(value);
    return message === undefined ? [] : [`- ${fieldName(key)}: ${message}`];
  });

  if (lines.length === 0) return 'The arguments were not valid. Ask the user for the correct values, then call the tool again.';
  return ['The arguments were not valid:', ...lines, 'Ask the user for these, then call the tool again.'].join('\n');
};

const explainNotAllowed = (error: HttpError): string => {
  const denial = 'This caller is not allowed to do that.';
  const challenge = headerValue(error, 'WWW-Authenticate');
  if (!challenge || !/error="insufficient_scope"/.test(challenge)) return denial;

  const scope = /scope="([^"]*)"/.exec(challenge)?.[1];
  return scope ? `${denial} It needs the \`${scope}\` scope.` : denial;
};

/**
 * The text the model sees for a failed call. Only what the caller can act on is
 * relayed: field names for a validation failure, the missing scope for a denial,
 * the message for a 404 or 409. Anything else gets {@link GENERIC_FAILURE}, so an
 * internal message never reaches the model.
 */
const explainHttpError = (error: HttpError): string => {
  switch (error.statusCode) {
    case 400:
    case 422:
      return explainInvalidArguments(error);
    case 401:
    case 403:
      return explainNotAllowed(error);
    case 404:
    case 409:
      return error.message;
    default:
      return GENERIC_FAILURE;
  }
};

/** Status codes whose explanation is specific enough to count as an expected outcome. */
const EXPLAINED_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Wraps an {@link McpToolHandler} so a thrown `HttpError` becomes a tool result the
 * model can read (`{ isError: true, content: [text] }`) instead of a JSON-RPC
 * protocol error. A validation failure lists the fields to ask the user for, a
 * 401/403 says the caller is not allowed (naming an `insufficient_scope` scope
 * from `WWW-Authenticate`), a 404/409 relays its message, and any other status
 * gets a generic failure that never includes the internal message.
 *
 * Anything that is not an `HttpError` is rethrown unchanged, so it still surfaces
 * as a protocol error.
 *
 * @example
 * ```ts
 * const tool = new ExplainedToolHandler(container.get(CreateTicketTool));
 * ```
 */
export class ExplainedToolHandler implements McpToolHandler {
  constructor(private readonly inner: McpToolHandler) {}

  /** The wrapped handler's advertisement, unchanged. */
  get definition(): Tool {
    return this.inner.definition;
  }

  async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
    try {
      return await this.inner.handle(args, context);
    } catch (error) {
      if (!IsHttpError(error)) throw error;

      // A generic failure hides the error from the model, so it has to be logged
      // here or nobody sees it; an explained one is an expected outcome.
      if (EXPLAINED_STATUSES.has(error.statusCode)) {
        context.logger.debug('MCP tool call failed; explained to the model', { tool: context.toolName, statusCode: error.statusCode });
      } else {
        context.logger.error('MCP tool call failed', { tool: context.toolName, statusCode: error.statusCode, error });
      }

      return { isError: true, content: [{ type: 'text', text: explainHttpError(error) }] };
    }
  }
}

/**
 * Wraps every handler in `tools` with {@link ExplainedToolHandler}. Returns a new
 * {@link McpToolHandlerMap} under the same keys; `tools` is not modified.
 *
 * @example
 * ```ts
 * registry
 *   .register(McpToolHandlerMap)
 *   .useFactory(container => explainToolErrors(new McpToolHandlerMap([['create_ticket', container.get(CreateTicketTool)]])))
 *   .asSingleton();
 * ```
 */
export const explainToolErrors = (tools: McpToolHandlerMap): McpToolHandlerMap => {
  const explained = new McpToolHandlerMap();
  for (const [name, handler] of tools) explained.set(name, new ExplainedToolHandler(handler));
  return explained;
};
