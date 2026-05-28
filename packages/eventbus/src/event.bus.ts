import { EventEmitter } from 'node:events';
import { Container, Injectable } from 'injectkit';
import { BusEvent } from './bus.event.js';
import { EventSubscriber } from './event.subscriber.js';
import { EventSubscriberRegistryMap } from './event.subscriber.registration.js';

/**
 * Synchronous, in-process event bus.
 *
 * Fans an event out to every subscriber registered for `event.type`. Wraps
 * Node's {@link EventEmitter} for listener bookkeeping, but dispatches via
 * `await` on each listener (rather than `emitter.emit()`) so async
 * subscribers run in registration order and the publisher waits for all of
 * them to finish.
 *
 * Dispatch is **sequential** and **fail-fast**: the first throwing
 * subscriber aborts the remaining subscribers and the error propagates to
 * the caller. That keeps the publisher and its subscribers inside the same
 * transaction — a subscriber failure rolls back the request.
 *
 * Subscribers are resolved from the supplied DI container on every publish,
 * so a request-scoped container yields request-scoped subscriber instances.
 *
 * @example
 * ```typescript
 * const registry = new EventSubscriberRegistryMap();
 * registry.set('requirement.completed', [AuditRequirementCompletedSubscriber]);
 *
 * const bus = new EventBus(registry, container);
 * await bus.publish({ type: 'requirement.completed', requirementId: 'req_123' });
 * ```
 */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Creates a new EventBus and binds each registered subscriber identifier
   * to a listener on the underlying {@link EventEmitter}. The listener
   * resolves a fresh subscriber instance from the container on every
   * invocation, so DI scoping is honored per publish.
   *
   * @param registry - The map of event type → subscriber identifiers.
   * @param container - The DI container used to resolve subscriber instances.
   */
  constructor(
    private readonly registry: EventSubscriberRegistryMap,
    private readonly container: Container,
  ) {
    for (const [type, identifiers] of registry.entries()) {
      for (const identifier of identifiers) {
        this.emitter.on(type, async (event: BusEvent) => {
          const subscriber = this.container.get<EventSubscriber>(identifier);
          await subscriber.handle(event);
        });
      }
    }
  }

  /**
   * Publishes an event to all registered subscribers for `event.type`.
   *
   * Subscribers run sequentially in registration order; the publisher
   * awaits each one. The first throwing subscriber aborts the remaining
   * subscribers and the error propagates to the caller.
   *
   * @typeParam E - The event shape. Must extend {@link BusEvent} so its
   *                `type` discriminator can match a registered subscriber key.
   * @param event - The event to dispatch.
   * @returns A promise that resolves once every subscriber has handled the event.
   * @throws If no subscribers are registered for `event.type`, or if any
   *         subscriber's `handle()` throws.
   */
  async publish<E extends BusEvent>(event: E): Promise<void> {
    const listeners = this.emitter.listeners(event.type);
    if (listeners.length === 0) {
      throw new Error(`No subscribers registered for event type ${event.type}`);
    }
    for (const listener of listeners) {
      await (listener as (e: E) => Promise<void>)(event);
    }
  }
}
