import { Injectable } from 'injectkit';
import { BusEvent } from './bus.event.js';

/**
 * Abstract base class for an in-process event subscriber.
 *
 * Extend this class to react to events published through an {@link EventBus}.
 * Each subscriber declares the event shape it accepts via the generic
 * parameter and implements the asynchronous handler.
 *
 * Subscribers are resolved from a DI container on every publish, so request
 * scoped containers yield fresh instances per publish call. That makes it
 * safe to inject request scoped collaborators (e.g. a Kysely transaction
 * handle) into a subscriber's constructor.
 *
 * @typeParam E - The event shape the subscriber handles. Must extend
 *                {@link BusEvent} so the bus can route on `event.type`.
 *
 * @example
 * ```typescript
 * type RequirementCompletedEvent = BusEvent<'requirement.completed'> & {
 *   requirementId: string;
 * };
 *
 * @Injectable()
 * class AuditRequirementCompletedSubscriber extends EventSubscriber<RequirementCompletedEvent> {
 *   constructor(private readonly audits: AuditService) {
 *     super();
 *   }
 *
 *   async handle(event: RequirementCompletedEvent): Promise<void> {
 *     await this.audits.record('requirement.completed', { id: event.requirementId });
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class EventSubscriber<E extends BusEvent = BusEvent> {
  /**
   * Handles a published event.
   *
   * Called by {@link EventBus.publish} for every event whose `type` matches
   * the key the subscriber was registered under. Throwing from this method
   * aborts remaining subscribers and propagates to the publisher, so the
   * caller's transaction can roll back.
   *
   * @param event - The event payload.
   * @returns A promise that resolves when handling is complete.
   */
  abstract handle(event: E): Promise<void>;
}
