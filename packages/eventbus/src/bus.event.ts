/**
 * The minimum shape an event must satisfy to flow through an `EventBus`.
 *
 * Events carry a discriminating `type` string that the bus uses to route to
 * subscribers. Concrete events extend or intersect this shape with the
 * payload they need.
 *
 * Named `BusEvent` (rather than `Event`) to avoid colliding with the DOM's
 * global `Event` type, which is in scope wherever TypeScript's DOM lib is
 * loaded.
 *
 * @typeParam EventType - A string literal type narrowing the discriminator.
 *
 * @example
 * ```typescript
 * type RequirementCompletedEvent = BusEvent<'requirement.completed'> & {
 *   requirementId: string;
 * };
 * ```
 */
export type BusEvent<EventType extends string = string> = {
  type: EventType;
};
