import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleLogger } from '../src/console.logger.js';

describe('ConsoleLogger', () => {
  let mockConsole: Console;
  let logger: ConsoleLogger;

  beforeEach(() => {
    mockConsole = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    } as unknown as Console;
    logger = new ConsoleLogger(mockConsole);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a ConsoleLogger with default console', () => {
      const defaultLogger = new ConsoleLogger();
      expect(defaultLogger).toBeInstanceOf(ConsoleLogger);
    });

    it('should create a ConsoleLogger with custom console', () => {
      const customConsole = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      } as unknown as Console;

      const customLogger = new ConsoleLogger(customConsole);
      expect(customLogger).toBeInstanceOf(ConsoleLogger);
    });
  });

  describe('error', () => {
    it('should log error message without optional params', () => {
      const message = 'Error message';
      logger.error(message);

      expect(mockConsole.error).toHaveBeenCalledOnce();
      expect(mockConsole.error).toHaveBeenCalledWith(message);
    });

    it('should log error message with optional params', () => {
      const message = 'Error message';
      const param1 = { key: 'value' };
      const param2 = 123;
      logger.error(message, param1, param2);

      expect(mockConsole.error).toHaveBeenCalledOnce();
      expect(mockConsole.error).toHaveBeenCalledWith(message, [param1, param2]);
    });

    it('should handle various message types', () => {
      const messages = ['string message', 123, { key: 'value' }, ['array', 'message'], null, undefined, true];

      messages.forEach(message => {
        logger.error(message);
      });

      expect(mockConsole.error).toHaveBeenCalledTimes(messages.length);
      messages.forEach(message => {
        expect(mockConsole.error).toHaveBeenCalledWith(message);
      });
    });
  });

  describe('warn', () => {
    it('should log warn message without optional params', () => {
      const message = 'Warning message';
      logger.warn(message);

      expect(mockConsole.warn).toHaveBeenCalledOnce();
      expect(mockConsole.warn).toHaveBeenCalledWith(message);
    });

    it('should log warn message with optional params', () => {
      const message = 'Warning message';
      const param1 = { key: 'value' };
      const param2 = 'additional info';
      logger.warn(message, param1, param2);

      expect(mockConsole.warn).toHaveBeenCalledOnce();
      expect(mockConsole.warn).toHaveBeenCalledWith(message, [param1, param2]);
    });

    it('should handle various message types', () => {
      const messages = ['string', 456, { warn: true }, null, undefined];

      messages.forEach(message => {
        logger.warn(message);
      });

      expect(mockConsole.warn).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('info', () => {
    it('should log info message without optional params', () => {
      const message = 'Info message';
      logger.info(message);

      expect(mockConsole.info).toHaveBeenCalledOnce();
      expect(mockConsole.info).toHaveBeenCalledWith(message);
    });

    it('should log info message with optional params', () => {
      const message = 'Info message';
      const param1 = { userId: 123 };
      const param2 = 'request-id';
      logger.info(message, param1, param2);

      expect(mockConsole.info).toHaveBeenCalledOnce();
      expect(mockConsole.info).toHaveBeenCalledWith(message, [param1, param2]);
    });

    it('should handle various message types', () => {
      const messages = ['info', 789, { info: 'data' }, [], false];

      messages.forEach(message => {
        logger.info(message);
      });

      expect(mockConsole.info).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('debug', () => {
    it('should log debug message without optional params', () => {
      const message = 'Debug message';
      logger.debug(message);

      expect(mockConsole.debug).toHaveBeenCalledOnce();
      expect(mockConsole.debug).toHaveBeenCalledWith(message);
    });

    it('should log debug message with optional params', () => {
      const message = 'Debug message';
      const param1 = { step: 1 };
      const param2 = { step: 2 };
      logger.debug(message, param1, param2);

      expect(mockConsole.debug).toHaveBeenCalledOnce();
      expect(mockConsole.debug).toHaveBeenCalledWith(message, [param1, param2]);
    });

    it('should handle various message types', () => {
      const messages = ['debug', { debug: true }, 999, null];

      messages.forEach(message => {
        logger.debug(message);
      });

      expect(mockConsole.debug).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('trace', () => {
    it('should log trace message without optional params', () => {
      const message = 'Trace message';
      logger.trace(message);

      expect(mockConsole.trace).toHaveBeenCalledOnce();
      expect(mockConsole.trace).toHaveBeenCalledWith(message);
    });

    it('should log trace message with optional params', () => {
      const message = 'Trace message';
      const param1 = { function: 'test' };
      logger.trace(message, param1);

      expect(mockConsole.trace).toHaveBeenCalledOnce();
      expect(mockConsole.trace).toHaveBeenCalledWith(message, [param1]);
    });

    it('should handle various message types', () => {
      const messages = ['trace', { trace: 'data' }, 111];

      messages.forEach(message => {
        logger.trace(message);
      });

      expect(mockConsole.trace).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('all log levels', () => {
    it('should call correct console method for each log level', () => {
      const message = 'Test message';

      logger.error(message);
      logger.warn(message);
      logger.info(message);
      logger.debug(message);
      logger.trace(message);

      expect(mockConsole.error).toHaveBeenCalledOnce();
      expect(mockConsole.warn).toHaveBeenCalledOnce();
      expect(mockConsole.info).toHaveBeenCalledOnce();
      expect(mockConsole.debug).toHaveBeenCalledOnce();
      expect(mockConsole.trace).toHaveBeenCalledOnce();
    });

    it('should handle empty optional params array', () => {
      const message = 'Message';

      logger.error(message);
      logger.warn(message);
      logger.info(message);
      logger.debug(message);
      logger.trace(message);

      expect(mockConsole.error).toHaveBeenCalledWith(message);
      expect(mockConsole.warn).toHaveBeenCalledWith(message);
      expect(mockConsole.info).toHaveBeenCalledWith(message);
      expect(mockConsole.debug).toHaveBeenCalledWith(message);
      expect(mockConsole.trace).toHaveBeenCalledWith(message);
    });

    it('should handle single optional param', () => {
      const message = 'Message';
      const param = { key: 'value' };

      logger.error(message, param);
      logger.warn(message, param);
      logger.info(message, param);
      logger.debug(message, param);
      logger.trace(message, param);

      expect(mockConsole.error).toHaveBeenCalledWith(message, [param]);
      expect(mockConsole.warn).toHaveBeenCalledWith(message, [param]);
      expect(mockConsole.info).toHaveBeenCalledWith(message, [param]);
      expect(mockConsole.debug).toHaveBeenCalledWith(message, [param]);
      expect(mockConsole.trace).toHaveBeenCalledWith(message, [param]);
    });

    it('should handle multiple optional params', () => {
      const message = 'Message';
      const param1 = { key1: 'value1' };
      const param2 = { key2: 'value2' };
      const param3 = 'string param';

      logger.error(message, param1, param2, param3);
      logger.warn(message, param1, param2, param3);
      logger.info(message, param1, param2, param3);
      logger.debug(message, param1, param2, param3);
      logger.trace(message, param1, param2, param3);

      expect(mockConsole.error).toHaveBeenCalledWith(message, [param1, param2, param3]);
      expect(mockConsole.warn).toHaveBeenCalledWith(message, [param1, param2, param3]);
      expect(mockConsole.info).toHaveBeenCalledWith(message, [param1, param2, param3]);
      expect(mockConsole.debug).toHaveBeenCalledWith(message, [param1, param2, param3]);
      expect(mockConsole.trace).toHaveBeenCalledWith(message, [param1, param2, param3]);
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined messages', () => {
      logger.error(null);
      logger.warn(undefined);
      logger.info(null);
      logger.debug(undefined);
      logger.trace(null);

      expect(mockConsole.error).toHaveBeenCalledWith(null);
      expect(mockConsole.warn).toHaveBeenCalledWith(undefined);
      expect(mockConsole.info).toHaveBeenCalledWith(null);
      expect(mockConsole.debug).toHaveBeenCalledWith(undefined);
      expect(mockConsole.trace).toHaveBeenCalledWith(null);
    });

    it('should handle empty string messages', () => {
      logger.error('');
      logger.warn('');
      logger.info('');
      logger.debug('');
      logger.trace('');

      expect(mockConsole.error).toHaveBeenCalledWith('');
      expect(mockConsole.warn).toHaveBeenCalledWith('');
      expect(mockConsole.info).toHaveBeenCalledWith('');
      expect(mockConsole.debug).toHaveBeenCalledWith('');
      expect(mockConsole.trace).toHaveBeenCalledWith('');
    });

    it('should handle complex objects as messages', () => {
      const complexObject = {
        nested: {
          deep: {
            value: 'test',
            array: [1, 2, 3],
          },
        },
        date: new Date(),
        func: () => {},
      };

      logger.error(complexObject);
      expect(mockConsole.error).toHaveBeenCalledWith(complexObject);
    });

    it('should handle Error objects as messages', () => {
      const error = new Error('Test error');
      logger.error(error);
      expect(mockConsole.error).toHaveBeenCalledWith(error);
    });
  });
});
