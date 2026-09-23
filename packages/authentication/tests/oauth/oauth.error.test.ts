import { describe, expect, it } from 'vitest';
import { IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';
import { IsOAuthError, OAuthError } from '../../src/oauth/oauth.error.js';

describe('OAuthError', () => {
  it('is a 400 HttpError whose details are the RFC fields', () => {
    const error = new OAuthError('invalid_grant', 'the code has been used');

    expect(IsHttpError(error)).toBe(true);
    expect(IsServerkitError(error)).toBe(true);
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ error: 'invalid_grant', error_description: 'the code has been used' });
    expect(error.toBody()).toEqual({ error: 'invalid_grant', error_description: 'the code has been used' });
  });

  it('can be a 401', () => {
    expect(new OAuthError('invalid_client', 'client authentication failed', 401).statusCode).toBe(401);
  });

  it('keeps chainable setters and its type', () => {
    const error = new OAuthError('invalid_grant', 'no').withInternalDetails({ code: 'replayed' });

    expect(IsOAuthError(error)).toBe(true);
    expect(error.internalDetails).toEqual({ code: 'replayed' });
  });

  it('is told apart from other errors', () => {
    expect(IsOAuthError(new Error('x'))).toBe(false);
    expect(IsOAuthError(undefined)).toBe(false);
  });
});
