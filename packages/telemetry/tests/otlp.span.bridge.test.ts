import { describe, it, expect } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { DateTime } from 'luxon';
import { FinishedSpan } from '../src/finished.span.js';
import { otlpSpanId, otlpTraceId } from '../src/otlp.ids.js';
import { OtlpSpanBridge } from '../src/otlp.span.bridge.js';

const start = DateTime.fromISO('2026-10-16T12:00:00.250Z', { zone: 'utc' });
const span = (overrides: Partial<FinishedSpan> = {}): FinishedSpan => ({
  traceId: 'decision-1',
  spanId: 'decision-1/job.run',
  name: 'job.run',
  start,
  end: start.plus({ milliseconds: 1500 }),
  ok: true,
  ...overrides,
});

const exportAll = async (spans: FinishedSpan[]) => {
  const exporter = new InMemorySpanExporter();
  await new OtlpSpanBridge({ exporter, scope: 'test.scope' }).export(spans);
  return exporter.getFinishedSpans();
};

describe('otlp ids', () => {
  it('keeps an id already in OTLP form and hashes anything else, stably', () => {
    expect(otlpTraceId('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
    expect(otlpTraceId('decision-1')).toMatch(/^[0-9a-f]{32}$/);
    expect(otlpTraceId('decision-1')).toBe(otlpTraceId('decision-1'));
    expect(otlpSpanId('decision-1')).toMatch(/^[0-9a-f]{16}$/);
    expect(otlpSpanId('decision-1')).not.toBe(otlpSpanId('decision-2'));
  });
});

describe('OtlpSpanBridge', () => {
  it('exports the span with the times it recorded', async () => {
    const [exported] = await exportAll([span({ attributes: { queue: 'catalog.sync' } })]);

    expect(exported?.name).toBe('job.run');
    expect(exported?.startTime).toEqual([start.toSeconds() - 0.25, 250_000_000]);
    expect(exported?.duration).toEqual([1, 500_000_000]);
    expect(exported?.attributes).toEqual({ queue: 'catalog.sync' });
    expect(exported?.instrumentationScope.name).toBe('test.scope');
    expect(exported?.status.code).toBe(SpanStatusCode.OK);
  });

  it('puts a child in its parent’s trace, pointing at the parent', async () => {
    const [parent, child] = await exportAll([span(), span({ spanId: 'decision-1/plugin.invoke', parentSpanId: 'decision-1/job.run' })]);

    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it('carries links to spans in other traces', async () => {
    const [exported] = await exportAll([span({ links: [{ traceId: 'decision-0', spanId: 'decision-0/job.run' }] })]);

    expect(exported?.links[0]?.context.traceId).toBe(otlpTraceId('decision-0'));
  });

  it('marks a failed span as an error with its message', async () => {
    const [exported] = await exportAll([span({ ok: false, error: 'timed out' })]);

    expect(exported?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'timed out' });
  });

  it('serialises through the OTLP JSON encoding an OTLP/HTTP exporter sends', async () => {
    const spans = await exportAll([span({ parentSpanId: 'decision-1/root', attributes: { queue: 'a' } })]);

    const body = JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest(spans)));
    const sent = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(sent.traceId).toBe(otlpTraceId('decision-1'));
    expect(sent.parentSpanId).toBe(otlpSpanId('decision-1/root'));
    expect(sent.startTimeUnixNano).toBe(`${start.toMillis()}000000`);
    expect(sent.attributes).toEqual([{ key: 'queue', value: { stringValue: 'a' } }]);
  });

  it('exports nothing for no spans', async () => {
    expect(await exportAll([])).toEqual([]);
  });
});
