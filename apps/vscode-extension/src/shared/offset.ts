import type { Range } from 'vscode-languageserver/node.js';
import type { SourceSpan } from '@maroonedsoftware/permissions-dsl';
import { offsetToPosition } from '@maroonedsoftware/permissions-dsl';

/**
 * Convert a `SourceSpan` (UTF-16 offsets, half-open) into an LSP `Range`.
 * `offsetToPosition` returns 1-indexed line/column; LSP wants 0-indexed.
 */
export const spanToRange = (source: string, span: SourceSpan): Range => {
    const start = offsetToPosition(source, span.start);
    const end = offsetToPosition(source, span.end);
    return {
        start: { line: start.line - 1, character: start.column - 1 },
        end: { line: end.line - 1, character: end.column - 1 },
    };
};
