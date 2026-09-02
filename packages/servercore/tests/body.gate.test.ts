import { describe, it, expect, vi } from 'vitest';
import { httpError } from '@maroonedsoftware/errors';
import { assertBodyExpectation, parseRouteBody, type BodyGateRequest } from '../src/body.gate.js';
import type { ServerKitBodyParser } from '../src/serverkit.bodyparser.js';
import type { IncomingMessage } from 'node:http';

const request = (overrides: Partial<BodyGateRequest> = {}): BodyGateRequest => ({
  length: 0,
  type: '',
  is: vi.fn((): string | false => false),
  ...overrides,
});

describe('assertBodyExpectation', () => {
  describe('when no content types are allowed', () => {
    it('returns false for a request without a body', () => {
      expect(assertBodyExpectation(request(), [])).toBe(false);
    });

    it('throws 400 when a body is present', () => {
      expect(() => assertBodyExpectation(request({ length: 12 }), [])).toThrow(
        expect.objectContaining({ statusCode: 400, details: { body: 'Unexpected body' } }),
      );
    });
  });

  describe('when content types are allowed', () => {
    it('throws 411 when the body is missing', () => {
      expect(() => assertBodyExpectation(request(), ['application/json'])).toThrow(expect.objectContaining({ statusCode: 411 }));
    });

    it('throws 415 with details when the content type is not allowed', () => {
      const req = request({ length: 5, type: 'text/xml', is: vi.fn((): string | false => false) });

      expect(() => assertBodyExpectation(req, ['application/json', 'text/plain'])).toThrow(
        expect.objectContaining({
          statusCode: 415,
          details: { 'content-type': 'must be one of application/json, text/plain', value: 'text/xml' },
        }),
      );
    });

    it('phrases a single allowed type without "one of"', () => {
      const req = request({ length: 5, type: 'text/xml' });

      expect(() => assertBodyExpectation(req, ['application/json'])).toThrow(
        expect.objectContaining({ details: { 'content-type': 'must be application/json', value: 'text/xml' } }),
      );
    });

    it('returns true when the content type is allowed', () => {
      const is = vi.fn(() => 'application/json');

      expect(assertBodyExpectation(request({ length: 5, type: 'application/json', is }), ['application/json'])).toBe(true);
      expect(is).toHaveBeenCalledWith(['application/json']);
    });
  });
});

describe('parseRouteBody', () => {
  const req = {} as IncomingMessage;

  it('returns the parser result', async () => {
    const result = { parsed: { a: 1 }, raw: '{"a":1}' };
    const parser = { parse: vi.fn().mockResolvedValue(result) } as unknown as ServerKitBodyParser;

    await expect(parseRouteBody(parser, req)).resolves.toBe(result);
    expect(parser.parse).toHaveBeenCalledWith(req);
  });

  it('rethrows an HttpError from the parser unchanged', async () => {
    const error = httpError(413);
    const parser = { parse: vi.fn().mockRejectedValue(error) } as unknown as ServerKitBodyParser;

    await expect(parseRouteBody(parser, req)).rejects.toBe(error);
  });

  it('wraps any other failure as 422 with the cause attached', async () => {
    const cause = new Error('boom');
    const parser = { parse: vi.fn().mockRejectedValue(cause) } as unknown as ServerKitBodyParser;

    await expect(parseRouteBody(parser, req)).rejects.toMatchObject({
      statusCode: 422,
      details: { body: 'Invalid request body format' },
      cause,
    });
  });
});
