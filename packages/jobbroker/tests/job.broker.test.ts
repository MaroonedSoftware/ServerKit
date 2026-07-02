import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Duration } from 'luxon';
import { JobBroker } from '../src/job.broker.js';
import { JobInfo } from '../src/job.info.js';
import { JobSendOptions } from '../src/job.send.options.js';

class TestJobBroker extends JobBroker {
  send = vi.fn<(name: string, payload: object, options?: JobSendOptions) => Promise<string>>().mockResolvedValue('job-id');
  schedule = vi.fn<(name: string, cron: string, payload?: object) => Promise<void>>().mockResolvedValue(undefined);
  unschedule = vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined);
  cancel = vi.fn<(name: string, id: string | string[]) => Promise<void>>().mockResolvedValue(undefined);
  resume = vi.fn<(name: string, id: string | string[]) => Promise<void>>().mockResolvedValue(undefined);
  deleteJob = vi.fn<(name: string, id: string | string[]) => Promise<void>>().mockResolvedValue(undefined);

  async getJob<Payload extends object>(_name: string, _id: string): Promise<JobInfo<Payload> | null> {
    return null;
  }
}

class FailingJobBroker extends JobBroker {
  async send(_name: string, _payload: object, _options?: JobSendOptions): Promise<string> {
    throw new Error('Queue unavailable');
  }

  async schedule(_name: string, _cron: string, _payload?: object): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async unschedule(_name: string): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async cancel(_name: string, _id: string | string[]): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async resume(_name: string, _id: string | string[]): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async deleteJob(_name: string, _id: string | string[]): Promise<void> {
    throw new Error('Queue unavailable');
  }

  async getJob<Payload extends object>(_name: string, _id: string): Promise<JobInfo<Payload> | null> {
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

    it('should expose the full broker surface', () => {
      expect(typeof broker.send).toBe('function');
      expect(typeof broker.schedule).toBe('function');
      expect(typeof broker.unschedule).toBe('function');
      expect(typeof broker.cancel).toBe('function');
      expect(typeof broker.resume).toBe('function');
      expect(typeof broker.deleteJob).toBe('function');
      expect(typeof broker.getJob).toBe('function');
    });
  });

  describe('send', () => {
    it('should accept a job name and payload', async () => {
      await broker.send('send-email', { to: 'user@example.com' });
      expect(broker.send).toHaveBeenCalledWith('send-email', { to: 'user@example.com' });
    });

    it('should resolve with the queued job id', async () => {
      const result = await broker.send('test-job', { value: 1 });
      expect(result).toBe('job-id');
    });

    it('should accept optional send options such as startAfter', async () => {
      const options: JobSendOptions = { startAfter: Duration.fromObject({ minutes: 5 }) };

      await broker.send('deferred-job', { value: 1 }, options);

      expect(broker.send).toHaveBeenCalledWith('deferred-job', { value: 1 }, options);
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
