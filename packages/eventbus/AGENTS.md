# AGENTS.md — @maroonedsoftware/eventbus

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Synchronous, in-process fan-out. `EventBus.publish(event)` resolves every subscriber registered for
`event.type` from a DI container and awaits each one in registration order. Dispatch is sequential
and fail-fast, so a publisher and its subscribers stay inside the same transaction: a subscriber
that throws rolls the whole request back.

Reach for this to decouple modules within one process. Do **not** reach for it when you want work
to happen _after_ the response, when a subscriber failure should not fail the publisher, or when
delivery must survive a crash — that is `@maroonedsoftware/jobbroker`. There is no broker, no
retry, no persistence, and no cross-process delivery here.

## Install

```bash
pnpm add @maroonedsoftware/eventbus
```

Runtime dependency: `injectkit`. No internal dependencies.

## Position in the graph

- **Depends on:** nothing internal.
- **Depended on by:** nothing internal. It is a leaf that applications wire up directly.
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

| Export                       | Kind           | Shape                                                                                    | Notes                                                                                         |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `BusEvent<EventType>`        | type           | `{ type: EventType }`, `EventType extends string = string`                               | Named `BusEvent`, not `Event`, to avoid colliding with the DOM global.                        |
| `EventBus`                   | class          | `@Injectable() new EventBus(registry: EventSubscriberRegistryMap, container: Container)` | Binds listeners in the constructor from the registry it is handed.                            |
| `EventBus#publish`           | method         | `<E extends BusEvent>(event: E) => Promise<void>`                                        | Sequential, awaited, fail-fast. **Throws when no subscriber is registered for `event.type`.** |
| `EventSubscriber<E>`         | abstract class | `@Injectable() abstract handle(event: E): Promise<void>`                                 | `E extends BusEvent = BusEvent`. Extend it, implement `handle`.                               |
| `EventSubscriberRegistryMap` | class          | `@Injectable() class ... extends Map<string, Identifier<EventSubscriber>[]>`             | A real `Map` subclass so injectkit can bind it by class identity.                             |

## Canonical usage

```typescript
import { Injectable } from 'injectkit';
import { EventBus, EventSubscriber, EventSubscriberRegistryMap, type BusEvent } from '@maroonedsoftware/eventbus';

type InvoiceIssuedEvent = BusEvent<'invoice.issued'> & { invoiceId: string };

@Injectable()
class RecordInvoiceAuditSubscriber extends EventSubscriber<InvoiceIssuedEvent> {
  constructor(private readonly audits: AuditService) {
    super();
  }

  async handle(event: InvoiceIssuedEvent): Promise<void> {
    await this.audits.record('invoice.issued', { id: event.invoiceId });
  }
}

// Composition root — inside a module's setup hook
const subscribers = new EventSubscriberRegistryMap();
subscribers.set('invoice.issued', [RecordInvoiceAuditSubscriber, NotifyBillingSubscriber]);

registry.register(EventSubscriberRegistryMap).useValue(subscribers);
registry.register(RecordInvoiceAuditSubscriber).useClass(RecordInvoiceAuditSubscriber);
registry.register(NotifyBillingSubscriber).useClass(NotifyBillingSubscriber);

// Publishing
await container.get(EventBus).publish({ type: 'invoice.issued', invoiceId });
```

## Rules for generated code

- Event `type` strings are catalog keys: dot notation, no hyphens (`invoice.issued`,
  `user.signed.up`). See the root AGENTS.md.
- Define each event as `BusEvent<'literal'> & { …payload }` so the discriminator stays a literal
  type and the subscriber's `handle` is typed against the real payload.
- Every subscriber class in a registry entry must also be registered with the DI container. The
  bus resolves by identifier at publish time, so a missing registration is a runtime failure, not
  a compile error.
- Resolve `EventBus` from the **request-scoped** container inside a request so subscribers get
  request-scoped collaborators (a transaction handle, `ctx.logger`).
- Do not publish for side effects you are willing to lose. If a failure should not fail the
  publisher, enqueue a job instead.
- Do not catch and swallow inside `handle` to "protect" the publisher. Fail-fast is the design;
  swallowing turns a rolled-back transaction into silent data loss.

## Gotchas

- **Publishing an event with no subscribers throws.** `publish` raises
  `No subscribers registered for event type <type>` rather than no-opping. Removing the last
  subscriber for an event type breaks its publisher. If an event is genuinely optional, register a
  no-op subscriber rather than special-casing the publisher.
- **The registry is read once, in the constructor.** `EventBus` walks the map and binds listeners
  when it is constructed. Mutating the `EventSubscriberRegistryMap` afterwards has no effect on an
  already-built bus. Register everything during `setup`, before the container is built.
- **Subscribers are resolved per publish, not per bus.** The listener closure calls
  `container.get(identifier)` on every invocation, so scoping follows the container the bus was
  constructed with. A bus built from the root container gets root-scoped subscribers even inside a
  request.
- **`EventEmitter` is bookkeeping only.** The bus never calls `emitter.emit()`; it reads
  `emitter.listeners(type)` and awaits each one itself. That is what makes dispatch ordered and
  awaited. Do not "simplify" it to `emit()` — that would make every subscriber fire-and-forget.
- **Registration order is dispatch order**, and the first throw aborts the rest. A subscriber
  later in the array cannot assume it ran.
- **Sequential, not parallel.** Ten slow subscribers add up on the request's critical path.

## Working inside this package

```
src/
  bus.event.ts                    BusEvent
  event.bus.ts                    EventBus
  event.subscriber.ts             EventSubscriber
  event.subscriber.registration.ts  EventSubscriberRegistryMap
  index.ts                        Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No internal dependencies.** This is an L0 package.
- Sequential, awaited, fail-fast dispatch is the contract that lets publishers rely on transaction
  semantics. Making dispatch parallel or error-tolerant is a breaking behavioural change even if
  the types do not move.
- `EventSubscriberRegistryMap` must remain a class extending `Map`, not a type alias, or injectkit
  cannot bind it.

User-visible changes need a changeset in `.changeset/`.
