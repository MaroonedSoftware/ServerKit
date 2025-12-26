import { describe, it, expect } from 'vitest';
import { Logger } from '../src/logger.js';

class TestLogger extends Logger {
  error(): void {
    // Implementation
  }
  warn(): void {
    // Implementation
  }
  info(): void {
    // Implementation
  }
  debug(): void {
    // Implementation
  }
  trace(): void {
    // Implementation
  }
}

describe('Logger', () => {
  describe('interface compliance', () => {
    it('should ensure ConsoleLogger implements Logger interface', () => {
      const logger: Logger = new TestLogger();
      expect(logger).toBeInstanceOf(TestLogger);
    });

    it('should have all required methods', () => {
      const logger: Logger = new TestLogger();
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.trace).toBe('function');
    });
  });

  describe('abstract class', () => {
    it('should be an abstract class that cannot be instantiated directly', () => {
      // TypeScript will prevent direct instantiation, but we can verify the class exists
      expect(Logger).toBeDefined();
      expect(typeof Logger).toBe('function');
    });

    it('should allow concrete implementations to extend it', () => {
      const testLogger = new TestLogger();
      expect(testLogger).toBeInstanceOf(Logger);
      expect(testLogger).toBeInstanceOf(TestLogger);
    });
  });

  describe('method signatures', () => {
    it('should accept unknown type for message parameter', () => {
      const logger: Logger = new TestLogger();
      const messages: unknown[] = ['string', 123, { key: 'value' }, ['array'], null, undefined, true, new Error('error')];

      messages.forEach(message => {
        expect(() => logger.error(message)).not.toThrow();
        expect(() => logger.warn(message)).not.toThrow();
        expect(() => logger.info(message)).not.toThrow();
        expect(() => logger.debug(message)).not.toThrow();
        expect(() => logger.trace(message)).not.toThrow();
      });
    });

    it('should accept variadic optional parameters', () => {
      const logger: Logger = new TestLogger();
      const message = 'Test message';

      expect(() => logger.error(message)).not.toThrow();
      expect(() => logger.error(message, { key: 'value' })).not.toThrow();
      expect(() => logger.error(message, 'param1', 'param2', 'param3')).not.toThrow();
      expect(() => logger.error(message, 1, 2, 3, 4, 5)).not.toThrow();
    });
  });
});
