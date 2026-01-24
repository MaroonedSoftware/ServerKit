import { Context } from 'koa';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

export interface ServerKitContext extends Context {
  container: Container;
  logger: Logger;
}
