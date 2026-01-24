import { describe, it, expect, vi } from 'vitest';
import { ServerKitRouter } from '../src/serverkit.router.js';
import Router from '@koa/router';
import type { ServerKitContext } from '../src/serverkit.context.js';

describe('ServerKitRouter', () => {
  describe('factory function', () => {
    it('should return a Router instance', () => {
      const router = ServerKitRouter();

      expect(router).toBeInstanceOf(Router);
    });

    it('should return a new Router instance on each call', () => {
      const router1 = ServerKitRouter();
      const router2 = ServerKitRouter();

      expect(router1).not.toBe(router2);
      expect(router1).toBeInstanceOf(Router);
      expect(router2).toBeInstanceOf(Router);
    });

    it('should use default ServerKitContext type', () => {
      const router = ServerKitRouter();

      // Type check: router should accept ServerKitContext
      expect(router).toBeInstanceOf(Router);
      // The router should be usable with ServerKitContext
      const ctx = {} as ServerKitContext;
      expect(ctx).toBeDefined();
    });
  });

  describe('with custom state type', () => {
    interface CustomState {
      user: { id: number; name: string };
    }

    it('should accept custom state type', () => {
      const router = ServerKitRouter<CustomState>();

      expect(router).toBeInstanceOf(Router);
    });

    it('should work with custom state and default context', () => {
      const router = ServerKitRouter<CustomState>();

      expect(router).toBeInstanceOf(Router);
    });
  });

  describe('with custom context type', () => {
    interface CustomContext extends ServerKitContext {
      customProperty: string;
    }

    it('should accept custom context type', () => {
      const router = ServerKitRouter<unknown, CustomContext>();

      expect(router).toBeInstanceOf(Router);
    });

    it('should work with default state and custom context', () => {
      const router = ServerKitRouter<unknown, CustomContext>();

      expect(router).toBeInstanceOf(Router);
    });
  });

  describe('with both custom state and context', () => {
    interface CustomState {
      session: { token: string };
    }

    interface CustomContext extends ServerKitContext {
      requestId: string;
    }

    it('should accept both custom state and context types', () => {
      const router = ServerKitRouter<CustomState, CustomContext>();

      expect(router).toBeInstanceOf(Router);
    });
  });

  describe('router functionality', () => {
    it('should create a router that can register routes', () => {
      const router = ServerKitRouter();
      const handler = vi.fn();

      router.get('/test', handler);

      expect(router).toBeInstanceOf(Router);
    });

    it('should support all HTTP methods', () => {
      const router = ServerKitRouter();
      const handler = vi.fn();

      router.get('/get', handler);
      router.post('/post', handler);
      router.put('/put', handler);
      router.patch('/patch', handler);
      router.delete('/delete', handler);
      router.head('/head', handler);
      router.options('/options', handler);

      expect(router).toBeInstanceOf(Router);
    });
  });
});
