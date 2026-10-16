import { DateTime } from 'luxon';

/**
 * An attribute value on a {@link FinishedSpan}.
 */
export type SpanAttributeValue = string | number | boolean;

/**
 * A reference from one span to another that is not its parent: work one decision caused in another
 * trace, say.
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
}

/**
 * A unit of work that has already happened, described after the fact.
 *
 * Apps that time their own work (a job runner wrapping each run, a tool loop timing each call) can
 * describe it in this plain shape and hand it to an exporter, rather than threading a live tracer
 * through the work. The ids are the app's own strings: an exporter that needs a particular format
 * (OTLP's 16- and 8-byte hex) derives one from them.
 */
export interface FinishedSpan {
  /** Groups the spans of one piece of work. */
  traceId: string;
  /** Identifies this span within its trace. */
  spanId: string;
  /** The span this one ran inside, in the same trace. */
  parentSpanId?: string;
  /** What the work was: `job.run`, `plugin.invoke`. */
  name: string;
  /** When it began. */
  start: DateTime;
  /** When it ended. */
  end: DateTime;
  /** Whether it succeeded. */
  ok: boolean;
  /** Why it failed, when it did. Never sent as anything but a status message. */
  error?: string;
  /** Anything else worth keeping about it. */
  attributes?: Readonly<Record<string, SpanAttributeValue>>;
  /** Spans in other traces this one relates to. */
  links?: readonly SpanLink[];
}
