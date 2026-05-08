import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobRunner } from '../src/job.runner.js';

class TestJobRunner extends JobRunner {
  start = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

class FailingJobRunner extends JobRunner {
  async start(): Promise<void> {
    throw new Error('Failed to connect to queue');
  }

  async stop(): Promise<void> {
    throw new Error('Failed to stop gracefully');
  }
}

class StatefulJobRunner extends JobRunner {
  running = false;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}

describe('JobRunner', () => {
  let runner: TestJobRunner;

  beforeEach(() => {
    runner = new TestJobRunner();
  });

  describe('abstract class behaviour', () => {
    it('should be extendable', () => {
      expect(runner).toBeInstanceOf(JobRunner);
    });

    it('should expose start and stop methods', () => {
      expect(typeof runner.start).toBe('function');
      expect(typeof runner.stop).toBe('function');
    });
  });

  describe('start', () => {
    it('should return a Promise that resolves to void', async () => {
      const result = await runner.start();
      expect(result).toBeUndefined();
    });

    it('should be callable', async () => {
      await runner.start();
      expect(runner.start).toHaveBeenCalledOnce();
    });

    it('should propagate errors from the implementation', async () => {
      const failingRunner = new FailingJobRunner();
      await expect(failingRunner.start()).rejects.toThrow('Failed to connect to queue');
    });

    it('should transition the runner to a running state', async () => {
      const statefulRunner = new StatefulJobRunner();
      expect(statefulRunner.running).toBe(false);

      await statefulRunner.start();

      expect(statefulRunner.running).toBe(true);
    });
  });

  describe('stop', () => {
    it('should return a Promise that resolves to void', async () => {
      const result = await runner.stop();
      expect(result).toBeUndefined();
    });

    it('should be callable', async () => {
      await runner.stop();
      expect(runner.stop).toHaveBeenCalledOnce();
    });

    it('should propagate errors from the implementation', async () => {
      const failingRunner = new FailingJobRunner();
      await expect(failingRunner.stop()).rejects.toThrow('Failed to stop gracefully');
    });

    it('should transition the runner out of a running state', async () => {
      const statefulRunner = new StatefulJobRunner();
      await statefulRunner.start();
      expect(statefulRunner.running).toBe(true);

      await statefulRunner.stop();

      expect(statefulRunner.running).toBe(false);
    });
  });

  describe('start and stop lifecycle', () => {
    it('should support a full start → stop cycle', async () => {
      const statefulRunner = new StatefulJobRunner();

      await statefulRunner.start();
      expect(statefulRunner.running).toBe(true);

      await statefulRunner.stop();
      expect(statefulRunner.running).toBe(false);
    });

    it('start and stop should be independent calls', async () => {
      await runner.start();
      await runner.stop();

      expect(runner.start).toHaveBeenCalledOnce();
      expect(runner.stop).toHaveBeenCalledOnce();
    });
  });
});
