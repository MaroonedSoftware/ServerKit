import { scimError } from '../errors/scim.error.js';

export type ScimTokenKind =
  | 'identifier' // attribute path, including dots, colons, dashes, and URN segments
  | 'string'
  | 'number'
  | 'true'
  | 'false'
  | 'null'
  | 'and'
  | 'or'
  | 'not'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'op'; // eq, ne, co, sw, ew, gt, ge, lt, le, pr

export interface ScimToken {
  kind: ScimTokenKind;
  /** For `identifier`/`string`/`op`: the textual value. For `number`: numeric. */
  value: string | number | boolean | null;
  /** Source position where the token starts. */
  start: number;
}

const COMPARISON_OPS = new Set(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le', 'pr']);

/**
 * Tokenize a SCIM filter expression into a stream of {@link ScimToken}s.
 * Throws a `400 invalidFilter` SCIM error on malformed input.
 */
export const tokenizeScimFilter = (input: string): ScimToken[] => {
  const tokens: ScimToken[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: '(', start: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ')', start: i });
      i += 1;
      continue;
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket', value: '[', start: i });
      i += 1;
      continue;
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket', value: ']', start: i });
      i += 1;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1]!;
          if (next === '"' || next === '\\' || next === '/') {
            value += next;
            i += 2;
            continue;
          }
          if (next === 'n') { value += '\n'; i += 2; continue; }
          if (next === 't') { value += '\t'; i += 2; continue; }
          if (next === 'r') { value += '\r'; i += 2; continue; }
          if (next === 'b') { value += '\b'; i += 2; continue; }
          if (next === 'f') { value += '\f'; i += 2; continue; }
          throw scimError(400, 'invalidFilter', 'Bad Request').withDetails({ position: i, message: `Unsupported escape sequence \\${next}` });
        }
        value += input[i];
        i += 1;
      }
      if (i >= input.length) {
        throw scimError(400, 'invalidFilter', 'Bad Request').withDetails({ position: start, message: 'Unterminated string literal' });
      }
      i += 1; // consume closing quote
      tokens.push({ kind: 'string', value, start });
      continue;
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      let raw = '';
      if (ch === '-') {
        raw += ch;
        i += 1;
      }
      while (i < input.length && /[0-9]/.test(input[i]!)) {
        raw += input[i];
        i += 1;
      }
      if (input[i] === '.') {
        raw += '.';
        i += 1;
        while (i < input.length && /[0-9]/.test(input[i]!)) {
          raw += input[i];
          i += 1;
        }
      }
      if (input[i] === 'e' || input[i] === 'E') {
        raw += input[i];
        i += 1;
        if (input[i] === '+' || input[i] === '-') {
          raw += input[i];
          i += 1;
        }
        while (i < input.length && /[0-9]/.test(input[i]!)) {
          raw += input[i];
          i += 1;
        }
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw scimError(400, 'invalidFilter', 'Bad Request').withDetails({ position: start, message: `Invalid numeric literal "${raw}"` });
      }
      tokens.push({ kind: 'number', value: num, start });
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = i;
      let raw = '';
      while (i < input.length && isIdentifierPart(input[i]!)) {
        raw += input[i];
        i += 1;
      }
      const lower = raw.toLowerCase();
      switch (lower) {
        case 'true':
          tokens.push({ kind: 'true', value: true, start });
          continue;
        case 'false':
          tokens.push({ kind: 'false', value: false, start });
          continue;
        case 'null':
          tokens.push({ kind: 'null', value: null, start });
          continue;
        case 'and':
        case 'or':
        case 'not':
          tokens.push({ kind: lower, value: lower, start });
          continue;
      }
      if (COMPARISON_OPS.has(lower)) {
        tokens.push({ kind: 'op', value: lower, start });
        continue;
      }
      tokens.push({ kind: 'identifier', value: raw, start });
      continue;
    }

    throw scimError(400, 'invalidFilter', 'Bad Request').withDetails({ position: i, message: `Unexpected character "${ch}"` });
  }

  return tokens;
};

const isIdentifierStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);

const isIdentifierPart = (ch: string): boolean => /[A-Za-z0-9_.\-:$]/.test(ch);
