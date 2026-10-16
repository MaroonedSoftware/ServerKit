import { describe, it, expect, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { MetricsRecorder } from '../src/metrics.recorder.js';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

describe('MetricsRecorder', () => {
  describe('observe', () => {
    it('folds observations of one series in one minute into a single bucket', () => {
      const recorder = new MetricsRecorder();
      recorder.observe('work.job.ms', 10, { queue: 'a' }, at('2026-10-16T12:00:05Z'));
      recorder.observe('work.job.ms', 30, { queue: 'a' }, at('2026-10-16T12:00:50Z'));
      recorder.observe('work.job.ms', 20, { queue: 'a' }, at('2026-10-16T12:00:59Z'));

      const [bucket, ...rest] = recorder.drain();

      expect(rest).toHaveLength(0);
      expect(bucket?.aggregate).toEqual({ count: 3, sum: 60, min: 10, max: 30, last: 20 });
      expect(bucket?.start.toISO()).toBe('2026-10-16T12:00:00.000Z');
      expect(bucket?.labelsKey).toBe('{"queue":"a"}');
    });

    it('keeps different minutes, names and label sets apart', () => {
      const recorder = new MetricsRecorder();
      recorder.observe('a', 1, {}, at('2026-10-16T12:00:00Z'));
      recorder.observe('a', 1, {}, at('2026-10-16T12:01:00Z'));
      recorder.observe('b', 1, {}, at('2026-10-16T12:00:00Z'));
      recorder.observe('a', 1, { x: '1' }, at('2026-10-16T12:00:00Z'));

      expect(recorder.drain()).toHaveLength(4);
    });

    it('treats label sets with the same pairs in another order as one series', () => {
      const recorder = new MetricsRecorder();
      recorder.observe('a', 1, { x: '1', y: '2' }, at('2026-10-16T12:00:00Z'));
      recorder.observe('a', 1, { y: '2', x: '1' }, at('2026-10-16T12:00:00Z'));

      expect(recorder.drain()).toHaveLength(1);
    });

    it('drops non-finite values', () => {
      const recorder = new MetricsRecorder();
      recorder.observe('a', Number.NaN);
      recorder.observe('a', Number.POSITIVE_INFINITY);

      expect(recorder.pending).toBe(0);
    });
  });

  describe('drain', () => {
    it('empties the buffer and returns buckets oldest first', () => {
      const recorder = new MetricsRecorder();
      recorder.observe('a', 1, {}, at('2026-10-16T12:05:00Z'));
      recorder.observe('a', 1, {}, at('2026-10-16T12:01:00Z'));

      const drained = recorder.drain();

      expect(drained.map(b => b.start.minute)).toEqual([1, 5]);
      expect(recorder.drain()).toEqual([]);
    });
  });

  describe('gauges', () => {
    it('samples each registered gauge at the sampling instant', async () => {
      const recorder = new MetricsRecorder();
      recorder.gauge('station.listeners', () => 7, { labels: { mount: 'main' } });

      await recorder.sampleGauges(at('2026-10-16T12:00:30Z'));

      const [bucket] = recorder.drain();
      expect(bucket?.name).toBe('station.listeners');
      expect(bucket?.labels).toEqual({ mount: 'main' });
      expect(bucket?.aggregate.last).toBe(7);
    });

    it('waits out a gauge cadence before sampling it again', async () => {
      const recorder = new MetricsRecorder();
      const read = vi.fn(() => 1);
      recorder.gauge('disk.bytes', read, { every: Duration.fromObject({ minutes: 15 }) });

      await recorder.sampleGauges(at('2026-10-16T12:00:00Z'));
      await recorder.sampleGauges(at('2026-10-16T12:14:59Z'));
      await recorder.sampleGauges(at('2026-10-16T12:15:00Z'));

      expect(read).toHaveBeenCalledTimes(2);
    });

    it('records nothing for an undefined reading', async () => {
      const recorder = new MetricsRecorder();
      recorder.gauge('a', () => undefined);

      await recorder.sampleGauges();

      expect(recorder.pending).toBe(0);
    });

    it('skips a gauge that throws, reports it, and still samples the others', async () => {
      const recorder = new MetricsRecorder();
      const onGaugeError = vi.fn();
      recorder.onGaugeError = onGaugeError;
      const failure = new Error('icecast down');
      recorder.gauge('broken', () => {
        throw failure;
      });
      recorder.gauge('fine', async () => 3);

      await recorder.sampleGauges();

      expect(onGaugeError).toHaveBeenCalledWith('broken', failure);
      expect(recorder.drain().map(b => b.name)).toEqual(['fine']);
    });

    it('replaces a gauge registered twice, and unregisters only its own registration', async () => {
      const recorder = new MetricsRecorder();
      const first = recorder.gauge('a', () => 1);
      recorder.gauge('a', () => 2);
      first();

      await recorder.sampleGauges();

      expect(recorder.drain()[0]?.aggregate.last).toBe(2);
    });
  });
});
