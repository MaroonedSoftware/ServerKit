# @maroonedsoftware/eventbus

Synchronous, in-process fan-out event dispatch for ServerKit. A thin wrapper over Node's `EventEmitter` that resolves subscribers from a DI container on every publish — so request-scoped subscribers pick up the per-request transaction and authorization context, and the publisher waits for them to finish.

## When to use this vs `@maroonedsoftware/jobbroker`

| You want… | Use |
| --- | --- |
| Fan-out to multiple handlers, all in the same request / transaction | `@maroonedsoftware/eventbus` |
| One handler, runs later in a separate process/transaction, retries, scheduling | `@maroonedsoftware/jobbroker` |

`EventBus.publish()` is **synchronous to the caller** — it awaits every subscriber and propagates the first error. `JobBroker.send()` is **fire-and-forget** to a queue.

## Features

- **Fan-out** — multiple subscribers per event type
- **Sequential, fail-fast** — registration order, first throw aborts the rest
- **Same transaction as the publisher** — subscribers resolved from the request-scoped DI container
- **Typed events** — `E extends { type: string }` discriminates dispatch
- **Zero runtime deps** beyond [injectkit](https://www.npmjs.com/package/injectkit)

## Installation

```bash
pnpm add @maroonedsoftware/eventbus injectkit reflect-metadata
```

> InjectKit requires `reflect-metadata` imported at your application entry point and TypeScript configured with `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

## Quick start

### 1. Define an event and a subscriber

```typescript
import { Injectable } from 'injectkit';
import { BusEvent, EventSubscriber } from '@maroonedsoftware/eventbus';

type RequirementCompletedEvent = BusEvent<'requirement.completed'> & {
  requirementId: string;
};

@Injectable()
export class AuditRequirementCompletedSubscriber extends EventSubscriber<RequirementCompletedEvent> {
  constructor(private readonly audits: AuditService) {
    super();
  }

  async handle(event: RequirementCompletedEvent): Promise<void> {
    await this.audits.record('requirement.completed', { id: event.requirementId });
  }
}
```

### 2. Register subscribers

```typescript
import { EventSubscriberRegistryMap } from '@maroonedsoftware/eventbus';

const registry = new EventSubscriberRegistryMap();

// Single subscriber
registry.set('requirement.completed', [AuditRequirementCompletedSubscriber]);

// Fan-out: multiple subscribers, dispatched in this order
registry.set('user.signed.up', [
  SendWelcomeEmailSubscriber,
  ProvisionDefaultWorkspaceSubscriber,
  TrackSignupAnalyticsSubscriber,
]);
```

### 3. Wire DI

```typescript
import 'reflect-metadata';
import { InjectKitRegistry } from 'injectkit';
import { EventBus, EventSubscriberRegistryMap } from '@maroonedsoftware/eventbus';

const diRegistry = new InjectKitRegistry();
diRegistry.register(EventSubscriberRegistryMap).useInstance(registry);
diRegistry.register(EventBus).asScoped();
diRegistry.register(AuditRequirementCompletedSubscriber).asScoped();

const container = diRegistry.build();
```

`EventBus` is typically registered **scoped**, not singleton: it captures the container at construction so subscribers inherit the request's scope (e.g. the request's Kysely transaction handle).

### 4. Publish

```typescript
const bus = scopedContainer.get(EventBus);

await bus.publish({
  type: 'requirement.completed',
  requirementId: 'req_123',
});
```

## Semantics

- **Sequential.** Subscribers run one at a time, in the order they appear in the registry entry for that event type. The publisher awaits each.
- **Fail-fast.** If a subscriber throws, remaining subscribers are not invoked and the error propagates to the publisher. The caller's transaction can roll back.
- **Loud on missing subscribers.** Publishing an event whose `type` has no registered subscribers throws `Error: No subscribers registered for event type <type>`. If you want pub/sub-style "no listeners is fine" semantics, check `registry.has(event.type)` before publishing.
- **DI-resolved per publish.** Subscribers are looked up from the container on every dispatch, so transient bindings give you a fresh instance each time.

## API

### `BusEvent<EventType extends string>`

Minimum shape an event must satisfy: `{ type: EventType }`. Intersect with your payload (`BusEvent<'foo.happened'> & { /* payload */ }`). Named `BusEvent` rather than `Event` to avoid colliding with the DOM's global `Event`.

### `EventBus`

| Method | Description |
| --- | --- |
| `publish<E extends BusEvent>(event: E): Promise<void>` | Fan out to every registered subscriber for `event.type`. Throws if none registered. |

Constructor: `new EventBus(registry: EventSubscriberRegistryMap, container: Container)`. Typically resolved via DI.

### `EventSubscriber<E extends BusEvent>`

Abstract base for subscribers.

| Method | Description |
| --- | --- |
| `handle(event: E): Promise<void>` | Process the event. Throwing aborts remaining subscribers and propagates to the publisher. |

### `EventSubscriberRegistryMap`

`Map<string, Identifier<EventSubscriber>[]>` — registered as an `@Injectable()` class so DI can resolve it by class identity. The value is an **array** of identifiers per key; entries dispatch in array order.

## License

MIT
