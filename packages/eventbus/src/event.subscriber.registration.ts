import { Identifier, Injectable } from 'injectkit';
import { EventSubscriber } from './event.subscriber.js';

/**
 * Registry map for event subscribers.
 *
 * Maps an event type (the `type` discriminator on the event object) to an
 * ordered list of subscriber identifiers. Multiple subscribers may register
 * for the same event type — {@link EventBus} will fan out to all of them in
 * the order they appear in the array.
 *
 * The map is registered as an `@Injectable()` class (rather than a `Map`
 * type alias) so injectkit can bind and resolve it by class identity.
 *
 * @example
 * ```typescript
 * const registry = new EventSubscriberRegistryMap();
 *
 * // Single subscriber for an event type
 * registry.set('requirement.completed', [AuditRequirementCompletedSubscriber]);
 *
 * // Fan-out: multiple subscribers for the same event type
 * registry.set('user.signed.up', [
 *   SendWelcomeEmailSubscriber,
 *   ProvisionDefaultWorkspaceSubscriber,
 *   TrackSignupAnalyticsSubscriber,
 * ]);
 *
 * container.bind(EventSubscriberRegistryMap).toValue(registry);
 * ```
 */
@Injectable()
export class EventSubscriberRegistryMap extends Map<string, Identifier<EventSubscriber>[]> {}
