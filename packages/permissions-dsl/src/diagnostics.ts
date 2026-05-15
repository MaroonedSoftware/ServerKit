import type { FailedMatchResult } from 'ohm-js';
import type { SourceSpan } from './ast.js';

/** 1-indexed line and column inside a source string. */
export interface Position {
    line: number;
    column: number;
}

/**
 * Convert a UTF-16 character offset into a 1-indexed `{ line, column }`. Clamps
 * `offset` to the source length so callers can safely pass `source.length` or
 * a span end past the end.
 */
export const offsetToPosition = (source: string, offset: number): Position => {
    let line = 1;
    let column = 1;
    const cap = Math.min(offset, source.length);
    for (let i = 0; i < cap; i++) {
        if (source.charCodeAt(i) === 10) {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column };
};

const lineAt = (source: string, offset: number): { text: string; lineStart: number } => {
    let lineStart = offset;
    while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) lineStart--;
    let lineEnd = offset;
    while (lineEnd < source.length && source.charCodeAt(lineEnd) !== 10) lineEnd++;
    return { text: source.slice(lineStart, lineEnd), lineStart };
};

/**
 * Format a diagnostic with a `filename:line:column error: message` header, the
 * offending source line, and a `^`-caret pointing at the span. Used as the
 * `message` of {@link CompileError} so the formatted diagnostic surfaces in
 * stack traces and CLI output without extra glue.
 */
export const formatDiagnostic = (opts: { source: string; filename?: string; span: SourceSpan; message: string }): string => {
    const { source, filename = '<input>', span, message } = opts;
    const { line, column } = offsetToPosition(source, span.start);
    const { text, lineStart } = lineAt(source, span.start);
    const caretCol = span.start - lineStart;
    const caretLen = Math.max(1, Math.min(span.end, lineStart + text.length) - span.start);
    const caret = ' '.repeat(caretCol) + '^'.repeat(caretLen);
    return `${filename}:${line}:${column} error: ${message}\n  ${text}\n  ${caret}`;
};

/**
 * Compile-time error with a pre-formatted, caret-annotated message. The
 * original `source`, `filename`, and `span` are retained on the instance so
 * tooling (IDEs, language servers) can re-render diagnostics with richer
 * UI than the plain-text message.
 */
export class CompileError extends Error {
    readonly filename?: string;
    readonly span: SourceSpan;
    readonly source: string;

    constructor(opts: { source: string; filename?: string; span: SourceSpan; message: string }) {
        super(formatDiagnostic(opts));
        this.name = 'CompileError';
        this.filename = opts.filename;
        this.span = opts.span;
        this.source = opts.source;
    }
}

/**
 * {@link CompileError} subclass for grammar/syntax failures. The
 * {@link fromMatchFailure} static adapts Ohm's failed-match output into a
 * span-carrying error, stripping Ohm's redundant `Line X, col Y:` prefix
 * since the caret already conveys position.
 */
export class ParseError extends CompileError {
    constructor(opts: { source: string; filename?: string; span: SourceSpan; message: string }) {
        super(opts);
        this.name = 'ParseError';
    }

    /** Build a {@link ParseError} from Ohm's `FailedMatchResult`. */
    static fromMatchFailure(result: FailedMatchResult, source: string, filename?: string): ParseError {
        const offset = result.getInterval().startIdx;
        const message: string = result.shortMessage ?? 'syntax error';
        return new ParseError({
            source,
            filename,
            span: { start: offset, end: Math.min(offset + 1, source.length) },
            message: message.replace(/^Line \d+, col \d+:\s*/i, ''),
        });
    }
}

/**
 * Wraps one or more {@link CompileError}s collected during a multi-file
 * compile so callers can report every diagnostic at once instead of stopping
 * at the first failure. The `message` is the concatenation of each child
 * error's pre-formatted message separated by blank lines, suitable for direct
 * terminal output.
 */
export class AggregateCompileError extends Error {
    readonly errors: readonly CompileError[];

    constructor(errors: CompileError[]) {
        super(errors.map(e => e.message).join('\n\n'));
        this.name = 'AggregateCompileError';
        this.errors = errors;
    }
}
