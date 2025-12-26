import { describe, it, expect, vi } from 'vitest';
import { OnError } from '../src/on.error.decorator.js';

describe('OnError decorator', () => {
  describe('class method error handling', () => {
    it('should call handler when method throws synchronous error', () => {
      const handler = vi.fn();
      const error = new Error('Test error');

      @OnError(handler)
      class TestClass {
        method(): void {
          throw error;
        }
      }

      const instance = new TestClass();
      expect(() => instance.method()).not.toThrow();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should call handler when async method rejects', async () => {
      const handler = vi.fn();
      const error = new Error('Async error');

      @OnError(handler)
      class TestClass {
        async method(): Promise<void> {
          throw error;
        }
      }

      const instance = new TestClass();
      await instance.method();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should not call handler when method succeeds', () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        method(): string {
          return 'success';
        }
      }

      const instance = new TestClass();
      const result = instance.method();
      expect(result).toBe('success');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not call handler when async method resolves', async () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        async method(): Promise<string> {
          return 'success';
        }
      }

      const instance = new TestClass();
      const result = await instance.method();
      expect(result).toBe('success');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should preserve method return value', () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        method(value: number): number {
          return value * 2;
        }
      }

      const instance = new TestClass();
      const result = instance.method(5);
      expect(result).toBe(10);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should preserve async method return value', async () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        async method(value: number): Promise<number> {
          return value * 2;
        }
      }

      const instance = new TestClass();
      const result = await instance.method(5);
      expect(result).toBe(10);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should preserve method arguments', () => {
      const handler = vi.fn();
      const error = new Error('Test error');

      @OnError(handler)
      class TestClass {
        method(arg1: string, arg2: number): void {
          expect(arg1).toBe('test');
          expect(arg2).toBe(42);
          throw error;
        }
      }

      const instance = new TestClass();
      instance.method('test', 42);
      expect(handler).toHaveBeenCalledWith(error);
    });
  });

  describe('getter error handling', () => {
    it('should call handler when getter throws error', () => {
      const handler = vi.fn();
      const error = new Error('Getter error');

      @OnError(handler)
      class TestClass {
        get value(): string {
          throw error;
        }
      }

      const instance = new TestClass();
      expect(() => instance.value).not.toThrow();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should not call handler when getter succeeds', () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        get value(): string {
          return 'test';
        }
      }

      const instance = new TestClass();
      expect(instance.value).toBe('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('setter error handling', () => {
    it('should call handler when setter throws error', () => {
      const handler = vi.fn();
      const error = new Error('Setter error');

      @OnError(handler)
      class TestClass {
        private _value = '';

        set value(v: string) {
          throw error;
        }
      }

      const instance = new TestClass();
      expect(() => {
        instance.value = 'test';
      }).not.toThrow();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should not call handler when setter succeeds', () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        private _value = '';

        set value(v: string) {
          this._value = v;
        }

        get value(): string {
          return this._value;
        }
      }

      const instance = new TestClass();
      instance.value = 'test';
      expect(instance.value).toBe('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('multiple methods', () => {
    it('should handle errors from multiple methods', () => {
      const handler = vi.fn();
      const error1 = new Error('Error 1');
      const error2 = new Error('Error 2');

      @OnError(handler)
      class TestClass {
        method1(): void {
          throw error1;
        }

        method2(): void {
          throw error2;
        }
      }

      const instance = new TestClass();
      instance.method1();
      instance.method2();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, error1);
      expect(handler).toHaveBeenNthCalledWith(2, error2);
    });
  });

  describe('inheritance', () => {
    it('should handle errors from inherited methods', () => {
      const handler = vi.fn();
      const error = new Error('Inherited error');

      @OnError(handler)
      class BaseClass {
        method(): void {
          throw error;
        }
      }

      class DerivedClass extends BaseClass {}

      const instance = new DerivedClass();
      instance.method();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(error);
    });
  });

  describe('constructor exclusion', () => {
    it('should not wrap constructor', () => {
      const handler = vi.fn();
      const error = new Error('Constructor error');

      @OnError(handler)
      class TestClass {
        constructor() {
          throw error;
        }
      }

      expect(() => new TestClass()).toThrow(error);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('non-method properties', () => {
    it('should not wrap non-method properties', () => {
      const handler = vi.fn();

      @OnError(handler)
      class TestClass {
        property = 'value';
      }

      const instance = new TestClass();
      expect(instance.property).toBe('value');
      // Handler should not be called for property access
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
