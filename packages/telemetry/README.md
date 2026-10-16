# @maroonedsoftware/telemetry

Minute-bucket metrics for ServerKit. Producers observe numbers into an in-process recorder; a loop you own drains it once a minute and writes what it drained wherever you keep metrics.

## Features

- **One shape for every metric**: each series' minute is five numbers (`count`, `sum`, `min`, `max`, `last`), which read as a gauge, a counter or a duration
- **Gauge registry**: register a reader once, sample it on every pass or at its own cadence
- **Merge-friendly**: aggregates are associative, so a later flush of the same minute merges into the row already stored, and minutes fold into hours
- **No I/O in the recorder**: storage and export are separate, so a dead database or collector never blocks a producer
- **Zero internal dependencies**: [injectkit](https://www.npmjs.com/package/injectkit) and [luxon](https://moment.github.io/luxon/) only

## Installation

```bash
pnpm add @maroonedsoftware/telemetry injectkit reflect-metadata
```

## Quick start

```typescript
import { MetricsRecorder } from '@maroonedsoftware/telemetry';
import { Duration } from 'luxon';

const recorder = new MetricsRecorder(); // register as a singleton in your container

// Anywhere work happens:
recorder.observe('work.job.ms', 412, { queue: 'catalog.sync' });

// Once, where a reading lives:
recorder.gauge('disk.free.bytes', () => disk.free(), { every: Duration.fromObject({ minutes: 15 }) });

// In a loop you own, once a minute:
await recorder.sampleGauges();
const buckets = recorder.drain();
```

## Reading an aggregate

| Kind     | Read                                        |
| -------- | ------------------------------------------- |
| Gauge    | `last`, or `sum / count` for the mean       |
| Counter  | `sum`                                       |
| Duration | `sum / count` for the mean, `max` for worst |

There are no percentiles: those need a histogram or sketch per bucket.

## License

MIT
