import { describe, it, expect } from 'vitest';
import { httpError, ServerkitError } from '@maroonedsoftware/errors';
import { notFoundBody, renderError } from '../src/errors/error.renderer.js';

describe('renderError', () => {
  it('renders an HttpError with its status, message, details, and headers', () => {
    const error = httpError(403, 'Forbidden').withDetails({ reason: 'nope' }).withHeaders({ 'www-authenticate': 'Bearer' });

    expect(renderError(error)).toEqual({
      status: 403,
      body: { statusCode: 403, message: 'Forbidden', details: { reason: 'nope' } },
      headers: { 'www-authenticate': 'Bearer' },
    });
  });

  it('renders a bare ServerkitError as a 500 that keeps its message and details', () => {
    const error = new ServerkitError('domain rule broken').withDetails({ rule: 'x' });

    expect(renderError(error)).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'domain rule broken', details: { rule: 'x' } },
    });
  });

  it('renders a plain Error as a generic 500 with no details key', () => {
    const rendered = renderError(new Error('secret internals'));

    expect(rendered).toEqual({ status: 500, body: { statusCode: 500, message: 'Internal Server Error' } });
    expect(rendered.body).not.toHaveProperty('details');
    expect(rendered).not.toHaveProperty('headers');
  });

  it('renders a non-Error throwable as a generic 500', () => {
    expect(renderError('a string')).toEqual({ status: 500, body: { statusCode: 500, message: 'Internal Server Error' } });
  });

  it('never leaks internalDetails', () => {
    const error = httpError(400).withInternalDetails({ secret: 'shh' });

    expect(JSON.stringify(renderError(error))).not.toContain('shh');
  });
});

describe('notFoundBody', () => {
  it('builds the 404 body with the url under details', () => {
    expect(notFoundBody('https://example.com/missing')).toEqual({
      statusCode: 404,
      message: 'Not Found',
      details: { url: 'https://example.com/missing' },
    });
  });
});
