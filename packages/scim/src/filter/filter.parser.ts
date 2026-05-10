import { scimError } from '../errors/scim.error.js';
import type { ScimFilterNode, ScimComparisonOperator } from './filter.ast.js';
import { tokenizeScimFilter, type ScimToken } from './filter.tokenizer.js';

/**
 * Parse a SCIM filter expression (RFC 7644 §3.4.2.2) into a typed AST.
 * Throws a `400 invalidFilter` SCIM error on malformed input.
 *
 * Operator precedence (highest first):
 *   1. parentheses, value-path brackets, `not(...)`
 *   2. comparison
 *   3. `and`
 *   4. `or`
 */
export const parseScimFilter = (input: string): ScimFilterNode => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw scimError(400, 'invalidFilter', 'Bad Request').withDetails({ message: 'Filter is empty' });
  }
  const tokens = tokenizeScimFilter(trimmed);
  const parser = new Parser(tokens);
  const node = parser.parseOr();
  parser.expectEnd();
  return node;
};

class Parser {
  private pos = 0;

  constructor(private readonly tokens: ScimToken[]) {}

  parseOr(): ScimFilterNode {
    let left = this.parseAnd();
    while (this.peek()?.kind === 'or') {
      this.consume();
      const right = this.parseAnd();
      left = { kind: 'logical', operator: 'or', left, right };
    }
    return left;
  }

  parseAnd(): ScimFilterNode {
    let left = this.parseUnary();
    while (this.peek()?.kind === 'and') {
      this.consume();
      const right = this.parseUnary();
      left = { kind: 'logical', operator: 'and', left, right };
    }
    return left;
  }

  parseUnary(): ScimFilterNode {
    const token = this.peek();
    if (token?.kind === 'not') {
      this.consume();
      this.expect('lparen', 'Expected "(" after "not"');
      const inner = this.parseOr();
      this.expect('rparen', 'Expected ")" to close "not(...)"');
      return { kind: 'not', filter: inner };
    }
    if (token?.kind === 'lparen') {
      this.consume();
      const inner = this.parseOr();
      this.expect('rparen', 'Expected ")"');
      return inner;
    }
    return this.parseComparisonOrValuePath();
  }

  parseComparisonOrValuePath(): ScimFilterNode {
    const token = this.peek();
    if (!token || token.kind !== 'identifier') {
      throw this.error(token, 'Expected attribute path');
    }
    this.consume();
    const attribute = String(token.value);

    const next = this.peek();
    if (next?.kind === 'lbracket') {
      this.consume();
      const inner = this.parseOr();
      this.expect('rbracket', 'Expected "]" to close value-path filter');
      return { kind: 'valuePath', attribute, filter: inner };
    }

    if (!next || next.kind !== 'op') {
      throw this.error(next, 'Expected comparison operator');
    }
    this.consume();
    const operator = String(next.value) as ScimComparisonOperator;

    if (operator === 'pr') {
      return { kind: 'comparison', attribute, operator };
    }

    const valueToken = this.peek();
    if (!valueToken) {
      throw this.error(valueToken, `Expected value after operator "${operator}"`);
    }
    this.consume();

    if (valueToken.kind === 'string' || valueToken.kind === 'number' || valueToken.kind === 'true' || valueToken.kind === 'false' || valueToken.kind === 'null') {
      return { kind: 'comparison', attribute, operator, value: valueToken.value as string | number | boolean | null };
    }
    throw this.error(valueToken, `Expected literal value after operator "${operator}"`);
  }

  expectEnd(): void {
    const remaining = this.peek();
    if (remaining) {
      throw this.error(remaining, 'Unexpected trailing tokens');
    }
  }

  private peek(): ScimToken | undefined {
    return this.tokens[this.pos];
  }

  private consume(): ScimToken | undefined {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  private expect(kind: ScimToken['kind'], message: string): ScimToken {
    const token = this.peek();
    if (!token || token.kind !== kind) {
      throw this.error(token, message);
    }
    this.consume();
    return token;
  }

  private error(token: ScimToken | undefined, message: string) {
    return scimError(400, 'invalidFilter', 'Bad Request').withDetails({
      message,
      position: token?.start ?? -1,
    });
  }
}
