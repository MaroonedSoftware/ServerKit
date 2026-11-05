import { type ServerKitMiddleware, type ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';

/**
 * A server middleware: runs for every request. It belongs after serverKitContextMiddleware, which is
 * what puts logger and container on ctx:
 *
 * builder.setupMiddleware(container => [...serverKitDefaultMiddleware(container), requestTimingMiddleware()]);
 */
export const requestTimingMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    // Code before next() runs before the rest of the stack and the route handler.
    const startedAt = DateTime.now();

    // No try/catch: errorMiddleware sits at the top of the stack and renders whatever is thrown.
    await next();

    // Code after next() runs on the way back out. It is skipped if something downstream threw.
    const elapsed = DateTime.now().diff(startedAt);
    ctx.set('x-response-time-ms', elapsed.as('milliseconds').toFixed(0));
    ctx.logger.debug('Request finished', { requestId: ctx.requestId, status: ctx.status, elapsed: elapsed.toISO() });
  };
};

/**
 * A router middleware: runs only for the routes that list it.
 *
 * router.get('/reports', requirePolicy(), requireTenantMiddleware(), handler);
 */
export const requireTenantMiddleware = (): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const tenantId = ctx.get('x-tenant-id');

    if (tenantId === '') {
      throw httpError(400).withDetails({ 'x-tenant-id': 'Header is required' });
    }

    // Resolve request-scoped services from ctx.container, never the root container.
    // const tenants = ctx.container.get(TenantService);
    // if (!(await tenants.memberOf(ctx.authenticationSession, tenantId))) {
    //   throw httpError(403).withDetails({ tenant: 'Not a member' }).withInternalDetails({ tenantId });
    // }

    await next();
  };
};
