import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

export const injectkitMiddleware = (container: Container): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.container = container.createScopedContainer();
    ctx.logger = container.get(Logger);
    await next();
  };
};
