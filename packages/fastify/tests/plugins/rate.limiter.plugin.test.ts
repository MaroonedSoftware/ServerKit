import { describe, it, expect } from 'vitest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { rateLimiterPlugin } from '../../src/plugins/rate.limiter.plugin.js';
import { createTestApp } from '../test.app.js';

describe('rateLimiterPlugin (fastify)', () => {
  it('lets requests through while points remain, then answers 429 with the rate-limit headers', async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 60 });
    const { app } = await createTestApp({
      plugins: container => [errorPlugin(container), serverKitContextPlugin(container), rateLimiterPlugin(limiter)],
    });
    app.get('/', async () => 'ok');

    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/' });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['x-ratelimit-limit']).toBe('2');
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({ statusCode: 429, message: 'Too Many Requests' });
  });

  it('keys the bucket by client ip', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const { app } = await createTestApp({
      plugins: container => [errorPlugin(container), serverKitContextPlugin(container), rateLimiterPlugin(limiter)],
    });
    app.get('/', async () => 'ok');

    expect((await app.inject({ method: 'GET', url: '/', remoteAddress: '10.0.0.1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/', remoteAddress: '10.0.0.1' })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/', remoteAddress: '10.0.0.2' })).statusCode).toBe(200);
  });
});
