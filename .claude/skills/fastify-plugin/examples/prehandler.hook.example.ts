import type { preHandlerAsyncHookHandler } from 'fastify';
import { httpError } from '@maroonedsoftware/errors';

/**
 * A route guard: applies only to the routes that list it. Guards are ordinary Fastify hook
 * handlers, so they go in a route's `preHandler` array and run in the order given:
 *
 * ```typescript
 * app.get('/reports', { preHandler: [requirePolicy(), requireTenant()] }, handler);
 * ```
 *
 * Use `onRequest` instead of `preHandler` when the request must be rejected before its body is
 * read; the signatures are the same.
 */
export const requireTenant = (): preHandlerAsyncHookHandler => {
  return async request => {
    const tenantId = request.headers['x-tenant-id'];

    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw httpError(400).withDetails({ 'x-tenant-id': 'Header is required' });
    }

    // Resolve request-scoped services from the request container, never the root one.
    // const tenants = request.container.get(TenantService);
    // if (!(await tenants.memberOf(request.authenticationSession, tenantId))) {
    //   throw httpError(403).withDetails({ tenant: 'Not a member' }).withInternalDetails({ tenantId });
    // }

    request.logger.debug('Tenant resolved', { requestId: request.requestId, tenantId });
  };
};
