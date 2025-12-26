import { describe, it, expect, vi } from 'vitest';
import { Job } from '../src/job.js';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }): Promise<void> {
    console.log(payload.message);
  }
}

class FailingJob extends Job<{ shouldFail: boolean }> {
  async run(payload: { shouldFail: boolean }): Promise<void> {
    if (payload.shouldFail) {
      throw new Error('Job execution failed');
    }
  }
}

class AsyncJob extends Job<{ delay: number }> {
  async run(payload: { delay: number }): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, payload.delay));
  }
}

describe('Job', () => {
  describe('abstract class behavior', () => {
    it('should be extendable', () => {
      const job = new TestJob();
      expect(job).toBeInstanceOf(Job);
    });

    it('should have abstract run method implemented by subclass', () => {
      const job = new TestJob();
      expect(typeof job.run).toBe('function');
    });
  });

  describe('run method', () => {
    it('should execute with payload', async () => {
      const job = new TestJob();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await job.run({ message: 'Hello, World!' });

      expect(consoleSpy).toHaveBeenCalledWith('Hello, World!');
      consoleSpy.mockRestore();
    });

    it('should return a Promise', () => {
      const job = new TestJob();
      const result = job.run({ message: 'test' });

      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve to void', async () => {
      const job = new TestJob();
      const result = await job.run({ message: 'test' });

      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from run method', async () => {
      const job = new FailingJob();

      await expect(job.run({ shouldFail: true })).rejects.toThrow('Job execution failed');
    });

    it('should not throw when shouldFail is false', async () => {
      const job = new FailingJob();

      await expect(job.run({ shouldFail: false })).resolves.toBeUndefined();
    });
  });

  describe('async behavior', () => {
    it('should handle async operations', async () => {
      const job = new AsyncJob();
      const startTime = Date.now();

      await job.run({ delay: 50 });

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
    });
  });

  describe('payload types', () => {
    it('should work with different payload shapes', async () => {
      class ComplexPayloadJob extends Job<{
        nested: { value: number };
        array: string[];
      }> {
        result: { nested: { value: number }; array: string[] } | null = null;
        async run(payload: { nested: { value: number }; array: string[] }): Promise<void> {
          this.result = payload;
        }
      }

      const job = new ComplexPayloadJob();
      const payload = { nested: { value: 42 }, array: ['a', 'b', 'c'] };

      await job.run(payload);

      expect(job.result).toEqual(payload);
    });

    it('should work with empty object payload', async () => {
      class EmptyPayloadJob extends Job<object> {
        called = false;
        async run(_payload: object): Promise<void> {
          this.called = true;
        }
      }

      const job = new EmptyPayloadJob();
      await job.run({});

      expect(job.called).toBe(true);
    });
  });
});
