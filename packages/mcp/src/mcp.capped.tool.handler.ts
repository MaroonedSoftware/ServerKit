import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpError } from './mcp.error.js';
import type { McpToolContext } from './mcp.request.context.js';
import { McpToolHandlerMap, type McpToolHandler } from './mcp.tool.handler.js';

/** What a cut result ends with: how to get the rest, so the model narrows its call rather than answering from part of it. */
export const MCP_CUT_HINT = 'ask for less: a narrower search or filter, a smaller limit, or the next page';

/** Options for {@link CappedToolHandler} and {@link capToolResults}. */
export interface McpResultCapOptions {
  /** The most characters of text a result may carry, summed over its text blocks. A positive integer. */
  maxChars: number;
}

/** `text` cut to at most `length` UTF-16 units without splitting a surrogate pair. */
const sliceSafely = (text: string, length: number): string => {
  const code = text.charCodeAt(length - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
};

/**
 * Wraps an {@link McpToolHandler} so a result whose text runs past
 * {@link McpResultCapOptions.maxChars} is cut, ending with
 * `… [cut at N of M characters: ask for less: …]` so the model narrows its call
 * (a filter, a smaller limit, the next page) instead of answering from part of it.
 *
 * The count is summed over the result's text blocks in order. The block the cap
 * falls in is cut and carries the hint, text blocks after it are dropped, and
 * every non-text block (an image, a resource link) is kept where it was.
 *
 * A cut result drops `structuredContent`: it is usually the same data as the
 * text, so leaving it would send the whole payload anyway and contradict the hint.
 * A tool that declares an `outputSchema` must return `structuredContent` unless
 * the result is an error, so its cut result is marked `isError: true`; the text,
 * hint included, still reaches the model.
 *
 * A result within the cap is returned unchanged. A thrown error passes through.
 *
 * @example
 * ```ts
 * const tool = new CappedToolHandler(container.get(SearchDocsTool), { maxChars: 20_000 });
 * ```
 */
export class CappedToolHandler implements McpToolHandler {
  private readonly maxChars: number;

  constructor(
    private readonly inner: McpToolHandler,
    options: McpResultCapOptions,
  ) {
    if (!Number.isInteger(options.maxChars) || options.maxChars < 1) {
      throw new McpError('maxChars must be a positive integer').withDetails({ maxChars: options.maxChars });
    }
    this.maxChars = options.maxChars;
  }

  /** The wrapped handler's advertisement, unchanged. */
  get definition(): Tool {
    return this.inner.definition;
  }

  async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
    const result = await this.inner.handle(args, context);

    const total = result.content.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0);
    if (total <= this.maxChars) return result;

    let remaining = this.maxChars;
    const content: CallToolResult['content'] = [];
    for (const block of result.content) {
      if (block.type !== 'text') {
        content.push(block);
      } else if (remaining > 0) {
        if (block.text.length <= remaining) {
          content.push(block);
          remaining -= block.text.length;
        } else {
          const text = `${sliceSafely(block.text, remaining)}… [cut at ${this.maxChars} of ${total} characters: ${MCP_CUT_HINT}]`;
          content.push({ ...block, text });
          remaining = 0;
        }
      }
    }

    context.logger.debug('MCP tool result cut', { tool: context.toolName, maxChars: this.maxChars, characters: total });

    const cut: CallToolResult = { ...result, content };
    delete cut.structuredContent;
    if (result.isError === true || this.inner.definition.outputSchema !== undefined) cut.isError = true;
    return cut;
  }
}

/**
 * Wraps every handler in `tools` with {@link CappedToolHandler}. Returns a new
 * {@link McpToolHandlerMap} under the same keys; `tools` is not modified. Composes
 * with `explainToolErrors` in either order.
 *
 * @example
 * ```ts
 * registry
 *   .register(McpToolHandlerMap)
 *   .useFactory(container =>
 *     capToolResults(explainToolErrors(new McpToolHandlerMap([['search_docs', container.get(SearchDocsTool)]])), { maxChars: 20_000 }),
 *   )
 *   .asSingleton();
 * ```
 */
export const capToolResults = (tools: McpToolHandlerMap, options: McpResultCapOptions): McpToolHandlerMap => {
  const capped = new McpToolHandlerMap();
  for (const [name, handler] of tools) capped.set(name, new CappedToolHandler(handler, options));
  return capped;
};
