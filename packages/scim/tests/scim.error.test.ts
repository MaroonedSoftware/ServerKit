import { describe, expect, it } from 'vitest';
import { HttpError, IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';
import { IsScimError, ScimError, ScimErrorSchema, scimError } from '../src/errors/scim.error.js';

describe('scimError', () => {
  it('builds a ScimError with status, scimType, and detail', () => {
    const err = scimError(400, 'invalidFilter', 'Bad Request');
    expect(IsScimError(err)).toBe(true);
    expect(IsHttpError(err)).toBe(true);
    expect(IsServerkitError(err)).toBe(true);
    expect(err.statusCode).toBe(400);
    expect(err.scimType).toBe('invalidFilter');
    expect(err.message).toBe('Bad Request');
  });

  it('renders the SCIM error envelope', () => {
    const err = scimError(404, undefined, 'Not Found');
    expect(err.toScimBody()).toEqual({
      schemas: [ScimErrorSchema],
      status: '404',
      detail: 'Not Found',
    });
  });

  it('includes scimType in the envelope when set', () => {
    expect(scimError(409, 'uniqueness', 'Conflict').toScimBody()).toEqual({
      schemas: [ScimErrorSchema],
      status: '409',
      scimType: 'uniqueness',
      detail: 'Conflict',
    });
  });

  it('supports the chainable HttpError setters', () => {
    const cause = new Error('boom');
    const err = scimError(500, undefined, 'Internal Server Error')
      .withCause(cause)
      .withDetails({ field: 'x' })
      .addHeader('X-Test', 'yes');
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ field: 'x' });
    expect(err.headers).toEqual({ 'X-Test': 'yes' });
  });

  it('survives instanceof across factory and constructor', () => {
    expect(scimError(400)).toBeInstanceOf(ScimError);
    expect(new ScimError(403, 'insufficientScope')).toBeInstanceOf(ScimError);
    expect(new ScimError(403)).toBeInstanceOf(HttpError);
  });
});
