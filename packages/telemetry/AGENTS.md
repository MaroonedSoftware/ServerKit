# AGENTS.md — @maroonedsoftware/telemetry

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Collects application metrics into one-minute buckets in memory (`MetricsRecorder`), so an app can keep
its own numbers over time and chart them. Not an OpenTelemetry SDK replacement: it holds aggregates, not
raw observations, and has no percentiles. Reach for the OTel SDK directly when you only need to ship
metrics to a collector and never read them back.

## Install

```bash
pnpm add @maroonedsoftware/telemetry injectkit reflect-metadata
```

Required peers: none beyond `injectkit`'s own `reflect-metadata`.

## Position in the graph

- **Depends on:** nothing internal
- **Depended on by:** nothing internal
- **Subpath exports:** none

## API surface

| Export              | Kind      | Shape                                                                                                                            | Notes                                    |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `MetricsRecorder`   | class     | `observe(name, value, labels?, at?)`, `gauge(name, read, options?)`, `sampleGauges(now?)`, `drain()`, `pending`, `onGaugeError?` | `@Injectable()`; register as a singleton |
| `GaugeReader`       | type      | `() => number \| undefined \| Promise<number \| undefined>`                                                                      | `undefined` records nothing              |
| `GaugeOptions`      | interface | `{ labels?: MetricLabels; every?: Duration }`                                                                                    | `every` defaults to zero (every pass)    |
| `GaugeErrorHandler` | type      | `(name: string, error: unknown) => void`                                                                                         |                                          |
| `MetricAggregate`   | interface | `{ count, sum, min, max, last }`                                                                                                 |                                          |
| `aggregateOf`       | function  | `(value: number) => MetricAggregate`                                                                                             |                                          |
| `mergeAggregates`   | function  | `(previous, next) => MetricAggregate`                                                                                            | associative; `last` is taken from `next` |
| `MetricBucket`      | interface | `{ name, labels, labelsKey, start: DateTime, aggregate }`                                                                        | `start` is the UTC minute                |
| `minuteOf`          | function  | `(at: DateTime) => DateTime`                                                                                                     | UTC start of minute                      |
| `MetricLabels`      | type      | `Readonly<Record<string, string>>`                                                                                               | string values only                       |
| `labelsKey`         | function  | `(labels: MetricLabels) => string`                                                                                               | sorted JSON; `'{}'` for none             |

## Canonical usage

```typescript
import { MetricsRecorder } from '@maroonedsoftware/telemetry';

registry.register(MetricsRecorder).useClass(MetricsRecorder).asSingleton();

const recorder = container.get(MetricsRecorder);
recorder.observe('work.job.ms', 412, { queue: 'catalog.sync' });
recorder.gauge('station.listeners', () => audience.count());

// your loop, once a minute
await recorder.sampleGauges();
await write(recorder.drain());
```

## Rules for generated code

- Register `MetricsRecorder` as a singleton. A scoped or transient recorder splits observations across
  instances and the loop drains only one of them.
- Name metrics in dot notation (`work.job.ms`), with the unit as the last segment when there is one.
- Keep label values from a small, known set (a queue name, a plugin id). Never put an id, a user, or
  free text in a label: every distinct label set is a row per minute.
- Drain on shutdown too, after producers have stopped, or the last partial minute is lost.

## Gotchas

- `drain()` includes the still-open minute. A store must merge (upsert) rather than insert, or a
  minute flushed twice is double-counted or rejected.
- `observe()` silently drops `NaN` and `Infinity`.
- A gauge whose reader throws is marked sampled anyway, so it is retried at its `every` cadence, not on
  the next pass.

## Working inside this package

`src/` holds one concern per file (`metric.aggregate.ts`, `metric.labels.ts`, `metric.bucket.ts`,
`metrics.recorder.ts`) behind the `src/index.ts` barrel; tests mirror them in `tests/`. Keep the root
entry free of I/O and of external SDKs. A new subpath needs an `exports` entry, a tsup entry in
`build`, and its SDK as an optional peer. Every user-visible change needs a changeset.
