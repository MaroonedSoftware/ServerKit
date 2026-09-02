import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { requestBodyLength, requestHeader, requestMediaType, requestPath } from '../src/serverkit.request.js';

const request = (url: string | undefined, headers: Record<string, string | string[]> = {}): FastifyRequest =>
  ({ url, headers }) as unknown as FastifyRequest;

describe('request helpers', () => {
  it('requestPath strips the query string', () => {
    expect(requestPath(request('/a/b?x=1'))).toBe('/a/b');
    expect(requestPath(request('/a'))).toBe('/a');
    expect(requestPath(request(undefined))).toBe('/');
  });

  it('requestMediaType strips parameters', () => {
    expect(requestMediaType(request('/', { 'content-type': 'application/json; charset=utf-8' }))).toBe('application/json');
    expect(requestMediaType(request('/', { 'content-type': 'text/plain' }))).toBe('text/plain');
    expect(requestMediaType(request('/'))).toBe('');
  });

  it('requestBodyLength parses content-length and defaults to 0', () => {
    expect(requestBodyLength(request('/', { 'content-length': '42' }))).toBe(42);
    expect(requestBodyLength(request('/'))).toBe(0);
  });

  it('requestHeader is case-insensitive and takes the first repeated value', () => {
    expect(requestHeader(request('/', { 'x-signature': 'abc' }), 'X-Signature')).toBe('abc');
    expect(requestHeader(request('/', { 'x-multi': ['one', 'two'] }), 'x-multi')).toBe('one');
    expect(requestHeader(request('/'), 'missing')).toBe('');
  });
});
