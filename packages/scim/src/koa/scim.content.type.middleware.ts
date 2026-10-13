import type { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { scimError } from '../errors/scim.error.js';
import { SCIM_MEDIA_TYPE } from '../scim.media.type.js';

/**
 * Enforce that mutating SCIM requests carry `Content-Type: application/scim+json`
 * (or `application/json`, which the spec accepts for backward compatibility),
 * and tag the response so it serialises with the SCIM media type.
 */
export const scimContentTypeMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    const method = ctx.method.toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const contentType = (ctx.request.headers['content-type'] ?? '').toLowerCase();
      if (contentType && !contentType.includes(SCIM_MEDIA_TYPE) && !contentType.includes('application/json')) {
        throw scimError(415, undefined, 'Unsupported Media Type').withDetails({
          message: `Content-Type must be ${SCIM_MEDIA_TYPE}`,
        });
      }
    }
    await next();
    if (ctx.body !== undefined && ctx.body !== null) {
      ctx.type = SCIM_MEDIA_TYPE;
    }
  };
};
