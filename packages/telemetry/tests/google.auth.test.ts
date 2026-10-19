import { describe, it, expect, vi } from 'vitest';
import type { GoogleAuth } from 'google-auth-library';
import { googleOtlpHeaders, googleMetricsUrl, googleTracesUrl, isGoogleTelemetryUrl } from '../src/google.auth.js';

describe('googleOtlpHeaders', () => {
  it('asks the auth client for fresh headers on every export', async () => {
    let token = 0;
    const getRequestHeaders = vi.fn(async () => new Headers({ authorization: `Bearer t${++token}`, 'x-goog-user-project': 'p' }));
    const auth = { getClient: async () => ({ getRequestHeaders }) } as unknown as GoogleAuth;
    const headers = googleOtlpHeaders(auth);

    expect(getRequestHeaders).not.toHaveBeenCalled();
    expect(await headers()).toEqual({ authorization: 'Bearer t1', 'x-goog-user-project': 'p' });
    expect(await headers()).toEqual({ authorization: 'Bearer t2', 'x-goog-user-project': 'p' });
  });
});

describe('isGoogleTelemetryUrl', () => {
  it('recognises the Telemetry API at any path, and nothing else', () => {
    expect(isGoogleTelemetryUrl('https://telemetry.googleapis.com')).toBe(true);
    expect(isGoogleTelemetryUrl(googleTracesUrl)).toBe(true);
    expect(isGoogleTelemetryUrl(googleMetricsUrl)).toBe(true);
    expect(isGoogleTelemetryUrl('http://localhost:4318')).toBe(false);
    expect(isGoogleTelemetryUrl('https://telemetry.googleapis.com.evil.example')).toBe(false);
    expect(isGoogleTelemetryUrl('not a url')).toBe(false);
    expect(isGoogleTelemetryUrl(undefined)).toBe(false);
  });
});
