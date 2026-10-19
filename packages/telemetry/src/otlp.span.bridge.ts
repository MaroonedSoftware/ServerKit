import { SpanKind, SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import { hrTimeDuration, millisToHrTime } from '@opentelemetry/core';
import { defaultResource, Resource } from '@opentelemetry/resources';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { FinishedSpan } from './finished.span.js';
import { otlpSpanId, otlpTraceId } from './otlp.ids.js';
import { exportAsPromise } from './otlp.export.js';

/**
 * How an {@link OtlpSpanBridge} is built.
 */
export interface OtlpSpanBridgeOptions {
  /** Where the spans go: an `OTLPTraceExporter`, or `InMemorySpanExporter` in tests. */
  exporter: SpanExporter;
  /** Says who is sending. Defaults to the SDK's default resource. */
  resource?: Resource;
  /** The instrumentation scope name. Defaults to `@maroonedsoftware/telemetry`. */
  scope?: string;
}

/**
 * Sends {@link FinishedSpan}s to an OTel span exporter.
 *
 * The spans are built as finished `ReadableSpan`s with the times the app recorded, rather than
 * started and ended on a live tracer, so work timed before this bridge existed (or in a process
 * with no tracer at all) exports with its real start and end. Ids are derived with
 * {@link otlpTraceId} and {@link otlpSpanId}, so the same app id always lands in the same trace.
 *
 * The caller batches: hand it whatever accumulated since the last call.
 */
export class OtlpSpanBridge {
  private readonly exporter: SpanExporter;
  private readonly resource: Resource;
  private readonly scope: string;

  /**
   * @param options - The exporter, resource and scope.
   */
  constructor(options: OtlpSpanBridgeOptions) {
    this.exporter = options.exporter;
    this.resource = options.resource ?? defaultResource();
    this.scope = options.scope ?? '@maroonedsoftware/telemetry';
  }

  /**
   * Exports the spans.
   *
   * @param spans - Finished work, in any order.
   * @throws Whatever the exporter reports when it fails.
   */
  async export(spans: readonly FinishedSpan[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }
    // A resource with attributes still being detected (a cloud metadata lookup) settles first, as the SDK's own processors do.
    await this.resource.waitForAsyncAttributes?.();
    await exportAsPromise(done =>
      this.exporter.export(
        spans.map(span => this.readableOf(span)),
        done,
      ),
    );
  }

  /** Flushes and closes the exporter. */
  async shutdown(): Promise<void> {
    await this.exporter.shutdown();
  }

  private readableOf(span: FinishedSpan): ReadableSpan {
    const traceId = otlpTraceId(span.traceId);
    const context = { traceId, spanId: otlpSpanId(span.spanId), traceFlags: TraceFlags.SAMPLED };
    const startTime = millisToHrTime(span.start.toMillis());
    const endTime = millisToHrTime(span.end.toMillis());
    return {
      name: span.name,
      kind: SpanKind.INTERNAL,
      spanContext: () => context,
      parentSpanContext:
        span.parentSpanId === undefined ? undefined : { traceId, spanId: otlpSpanId(span.parentSpanId), traceFlags: TraceFlags.SAMPLED },
      startTime,
      endTime,
      duration: hrTimeDuration(startTime, endTime),
      status: span.ok ? { code: SpanStatusCode.OK } : { code: SpanStatusCode.ERROR, message: span.error },
      attributes: { ...span.attributes },
      links: (span.links ?? []).map(link => ({
        context: { traceId: otlpTraceId(link.traceId), spanId: otlpSpanId(link.spanId), traceFlags: TraceFlags.SAMPLED },
      })),
      events: [],
      ended: true,
      resource: this.resource,
      instrumentationScope: { name: this.scope },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  }
}
