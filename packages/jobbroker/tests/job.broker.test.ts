import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobBroker } from '../src/job.broker.js';

class TestJobBroker extends JobBroker {
  send = vi.fn<[string, object], Promise<void>>().mockResolvedValue(undefined);
  schedule = vi.fn<[string, string, object?], Promise<void>>().mockResolvedValue(undefined);
  unschedule = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
}

class FailingJobBroker extends JobBroker {
  async send(_name: string, _payload: object): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async schedule(_name: string, _cron: string, _payload?: object): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async unschedule(_name: string): Promise<void> {
    throw new Error('Queue unavailable');
  }
}

describe('JobBroker', () => {
  let broker: TestJobBroker;

  beforeEach(() => {
    broker = new TestJobBroker();
  });

  describe('abstract class behaviour', () => {
    it('should be extendable', () => {
      expect(broker).toBeInstanceOf(JobBroker);
    });

    it('should expose send, schedule, and unschedule methods', () => {
      expect(typeof broker.send).toBe('function');
      expect(typeof broker.schedule).toBe('function');
      expect(typeof broker.unschedule).toBe('function');
    });
  });

  describe('send', () => {
    it('should accept a job name and payload', async () => {
      await broker.send('send-email', { to: 'user@example.com' });
      expect(broker.send).toHaveBeenCalledWith('send-email', { to: 'user@example.com' });
    });

    it('should return a Promise that resolves to void', async () => {
      const result = await broker.send('test-job', { value: 1 });
      expect(result).toBeUndefined();
    });

    it('should be called once per invocation', async () => {
      await broker.send('job-a', { x: 1 });
      await broker.send('job-b', { x: 2 });
      expect(broker.send).toHaveBeenCalledTimes(2);
    });

    it('should propagate errors from the implementation', async () => {
      const failingBroker = new FailingJobBroker();
      await expect(failingBroker.send('test-job', {})).rejects.toThrow('Queue unavailable');
    });

    it('should work with any object payload shape', async () => {
      const payload = { nested: { value: 42 }, tags: ['a', 'b'] };
      await broker.send('complex-job', payload);
      expect(broker.send).toHaveBeenCalledWith('complex-job', payload);
    });
  });

  describe('schedule', () => {
    it('should accept a job name, cron expression, and optional payload', async () => {
      await broker.schedule('daily-report', '0 9 * * *', { reportType: 'sales' });
      expect(broker.schedule).toHaveBeenCalledWith('daily-report', '0 9 * * *', { reportType: 'sales' });
    });

    it('should accept a job name and cron expression without a payload', async () => {
      await broker.schedule('heartbeat', '* * * * *');
      expect(broker.schedule).toHaveBeenCalledWith('heartbeat', '* * * * *');
    });

    it('should return a Promise that resolves to void', async () => {
      const result = await broker.schedule('daily-report', '0 9 * * *');
      expect(result).toBeUndefined();
    });

    it('should propagate errors from the implementation', async () => {
      const failingBroker = new FailingJobBroker();
      await expect(failingBroker.schedule('daily-report', '0 9 * * *')).rejects.toThrow('Queue unavailable');
    });

    it('should support various cron expressions', async () => {
      const cases: Array<[string, string]> = [
        ['daily', '0 9 * * *'],
        ['weekly', '0 9 * * 1'],
        ['monthly', '0 0 1 * *'],
        ['every-minute', '* * * * *'],
      ];

      for (const [name, cron] of cases) {
        await broker.schedule(name, cron);
      }

      expect(broker.schedule).toHaveBeenCalledTimes(cases.length);
    });
  });

  describe('unschedule', () => {
    it('should accept a job name', async () => {
      await broker.unschedule('daily-report');
      expect(broker.unschedule).toHaveBeenCalledWith('daily-report');
    });

    it('should return a Promise that resolves to void', async () => {
      const result = await broker.unschedule('daily-report');
      expect(result).toBeUndefined();
    });

    it('should propagate errors from the implementation', async () => {
      const failingBroker = new FailingJobBroker();
      await expect(failingBroker.unschedule('daily-report')).rejects.toThrow('Queue unavailable');
    });
  });
});
