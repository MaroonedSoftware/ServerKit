import { describe, expect, it } from 'vitest';
import { parseScimFilter } from '../src/filter/filter.parser.js';
import type { ScimFilterNode } from '../src/filter/filter.ast.js';

describe('parseScimFilter — RFC 7644 §3.4.2.2 examples', () => {
  it('userName eq "bjensen"', () => {
    const ast = parseScimFilter('userName eq "bjensen"');
    expect(ast).toEqual({ kind: 'comparison', attribute: 'userName', operator: 'eq', value: 'bjensen' });
  });

  it('case-insensitive operator', () => {
    const ast = parseScimFilter('userName EQ "bjensen"');
    expect(ast).toMatchObject({ operator: 'eq' });
  });

  it('name.familyName co "O\'Malley"', () => {
    const ast = parseScimFilter('name.familyName co "O\'Malley"');
    expect(ast).toEqual({ kind: 'comparison', attribute: 'name.familyName', operator: 'co', value: "O'Malley" });
  });

  it('userName sw "J"', () => {
    expect(parseScimFilter('userName sw "J"')).toMatchObject({ operator: 'sw', value: 'J' });
  });

  it('title pr', () => {
    expect(parseScimFilter('title pr')).toEqual({ kind: 'comparison', attribute: 'title', operator: 'pr' });
  });

  it('meta.lastModified gt "2011-05-13T04:42:34Z"', () => {
    expect(parseScimFilter('meta.lastModified gt "2011-05-13T04:42:34Z"')).toMatchObject({
      attribute: 'meta.lastModified',
      operator: 'gt',
      value: '2011-05-13T04:42:34Z',
    });
  });

  it('combines AND with higher precedence than OR', () => {
    const ast = parseScimFilter('title pr or userType eq "Intern" and active eq true');
    expect(ast).toEqual<ScimFilterNode>({
      kind: 'logical',
      operator: 'or',
      left: { kind: 'comparison', attribute: 'title', operator: 'pr' },
      right: {
        kind: 'logical',
        operator: 'and',
        left: { kind: 'comparison', attribute: 'userType', operator: 'eq', value: 'Intern' },
        right: { kind: 'comparison', attribute: 'active', operator: 'eq', value: true },
      },
    });
  });

  it('parentheses override precedence', () => {
    const ast = parseScimFilter('(userType eq "Employee" or userType eq "Intern") and active eq true');
    expect(ast).toMatchObject({
      kind: 'logical',
      operator: 'and',
      left: { kind: 'logical', operator: 'or' },
      right: { kind: 'comparison', attribute: 'active', operator: 'eq', value: true },
    });
  });

  it('not(...) wraps a sub-expression', () => {
    const ast = parseScimFilter('not (active eq true)');
    expect(ast).toEqual<ScimFilterNode>({
      kind: 'not',
      filter: { kind: 'comparison', attribute: 'active', operator: 'eq', value: true },
    });
  });

  it('value-path filter on a multi-valued attribute', () => {
    const ast = parseScimFilter('emails[type eq "work" and value co "@example.com"]');
    expect(ast).toMatchObject({
      kind: 'valuePath',
      attribute: 'emails',
      filter: {
        kind: 'logical',
        operator: 'and',
        left: { attribute: 'type', operator: 'eq', value: 'work' },
        right: { attribute: 'value', operator: 'co', value: '@example.com' },
      },
    });
  });

  it('numeric and boolean literals', () => {
    expect(parseScimFilter('priority gt 3')).toMatchObject({ value: 3 });
    expect(parseScimFilter('active eq false')).toMatchObject({ value: false });
    expect(parseScimFilter('manager eq null')).toMatchObject({ value: null });
  });

  it('schema-qualified attributes parse as a single identifier', () => {
    const ast = parseScimFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "bjensen"');
    expect(ast).toMatchObject({ attribute: 'urn:ietf:params:scim:schemas:core:2.0:User:userName' });
  });

  const expectInvalidFilter = (input: string, messagePattern: RegExp) => {
    try {
      parseScimFilter(input);
      expect.fail('expected parseScimFilter to throw');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        scimType: 'invalidFilter',
        details: { message: expect.stringMatching(messagePattern) },
      });
    }
  };

  it('rejects an empty filter', () => {
    expectInvalidFilter('', /Filter is empty/);
  });

  it('rejects an unterminated string', () => {
    expectInvalidFilter('userName eq "bjensen', /Unterminated string/);
  });

  it('rejects a missing operator', () => {
    expectInvalidFilter('userName "bjensen"', /Expected comparison operator/);
  });

  it('rejects trailing tokens', () => {
    expectInvalidFilter('userName eq "bjensen" "extra"', /Unexpected trailing tokens/);
  });
});
