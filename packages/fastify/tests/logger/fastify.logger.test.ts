import { describe, it, expect, vi } from 'vitest';
import { createFastifyLogger } from '../../src/logger/fastify.logger.js';
import { createLogger } from '../test.app.js';

describe('createFastifyLogger', () => {
  it('forwards every level to the matching Logger method', () => {
    const logger = createLogger();
    const bridged = createFastifyLogger(logger);

    bridged.info('up');
    bridged.warn('careful');
    bridged.error('broke');
    bridged.debug('detail');
    bridged.trace('noise');

    expect(logger.info).toHaveBeenCalledWith('up');
    expect(logger.warn).toHaveBeenCalledWith('careful');
    expect(logger.error).toHaveBeenCalledWith('broke');
    expect(logger.debug).toHaveBeenCalledWith('detail');
    expect(logger.trace).toHaveBeenCalledWith('noise');
  });

  it('maps fatal onto error, since Logger has no fatal level', () => {
    const logger = createLogger();

    createFastifyLogger(logger).fatal('the end');

    expect(logger.error).toHaveBeenCalledWith('the end');
  });

  it('moves a pino merge object behind the message', () => {
    const logger = createLogger();

    createFastifyLogger(logger).info({ res: { statusCode: 200 } }, 'request completed');

    expect(logger.info).toHaveBeenCalledWith('request completed', { res: { statusCode: 200 } });
  });

  it('passes a merge object through alone when there is no message', () => {
    const logger = createLogger();

    createFastifyLogger(logger).info({ err: 'boom' });

    expect(logger.info).toHaveBeenCalledWith({ err: 'boom' });
  });

  it('keeps interpolation parameters after the merged object', () => {
    const logger = createLogger();

    createFastifyLogger(logger).info({ a: 1 }, 'hello %s', 'world');

    expect(logger.info).toHaveBeenCalledWith('hello %s', { a: 1 }, 'world');
  });

  it('attaches child bindings to a message-only call', () => {
    const logger = createLogger();

    createFastifyLogger(logger).child({ reqId: 'r1' }).info('incoming request');

    expect(logger.info).toHaveBeenCalledWith('incoming request', { reqId: 'r1' });
  });

  it('merges nested child bindings, with the innermost winning', () => {
    const logger = createLogger();

    createFastifyLogger(logger, { service: 'api' }).child({ reqId: 'r1' }).child({ reqId: 'r2' }).info({ extra: true }, 'nested');

    expect(logger.info).toHaveBeenCalledWith('nested', { service: 'api', reqId: 'r2', extra: true });
  });

  it('keeps an Error logged alone on a child logger, with the bindings after it', () => {
    const logger = createLogger();
    const err = new Error('database unreachable');

    createFastifyLogger(logger).child({ reqId: 'r1' }).error(err);

    expect(logger.error).toHaveBeenCalledWith(err, { reqId: 'r1' });
    const [logged] = vi.mocked(logger.error).mock.calls[0] ?? [];
    expect((logged as Error).message).toBe('database unreachable');
  });

  it('keeps an Error logged with a message on a child logger, behind the message', () => {
    const logger = createLogger();
    const err = new Error('database unreachable');

    createFastifyLogger(logger).child({ reqId: 'r1' }).error(err, 'request failed');

    expect(logger.error).toHaveBeenCalledWith('request failed', err, { reqId: 'r1' });
    const [, logged] = vi.mocked(logger.error).mock.calls[0] ?? [];
    expect((logged as Error).message).toBe('database unreachable');
  });

  it('passes an Error through alone when there are no bindings', () => {
    const logger = createLogger();
    const err = new Error('boom');

    createFastifyLogger(logger).error(err);

    expect(logger.error).toHaveBeenCalledWith(err);
  });

  it('leaves the arguments untouched when there are no bindings', () => {
    const logger = createLogger();

    createFastifyLogger(logger).info('plain %d', 42);

    expect(logger.info).toHaveBeenCalledWith('plain %d', 42);
  });
});
