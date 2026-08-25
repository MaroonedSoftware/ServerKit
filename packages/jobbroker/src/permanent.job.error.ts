import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Thrown by a {@link Job} to declare that its failure is **permanent** — the
 * input will never succeed, so retrying it is wasted work.
 *
 * An ordinary error thrown from a handler is treated as transient: the job goes
 * back on the queue and burns its full retry budget before it is finally failed
 * (and dead-lettered, if the queue has a dead-letter queue). That is right for a
 * network blip or a rate limit, and wrong for a malformed payload or a `422`
 * from an upstream API — nothing about waiting makes those succeed.
 *
 * Throwing this instead skips the remaining retries and routes the job straight
 * to the queue's dead-letter queue, where it is preserved for inspection or
 * replay. A queue with no dead-letter queue simply fails the job terminally.
 *
 * Extends {@link ServerkitError}, so `errorMiddleware` renders it (as a 500) and
 * the `withDetails` / `withCause` / `withInternalDetails` setters apply. Attach
 * the offending field or upstream status with `withDetails` — it is persisted as
 * the job's output, which is what an operator reads when draining the queue.
 *
 * The runner matches this type with a direct `instanceof` and does **not** walk
 * the `cause` chain: the meaning is "this handler declared the failure
 * permanent", not "something permanent happened somewhere underneath". Wrapping
 * a transient error in one of these makes it permanent, deliberately.
 *
 * @example
 * ```typescript
 * async run(payload: DeliverWebhookPayload): Promise<void> {
 *   const parsed = schema.safeParse(payload);
 *   if (!parsed.success) {
 *     throw new PermanentJobError('Malformed webhook payload').withDetails({ issues: parsed.error.issues });
 *   }
 *
 *   const response = await fetch(parsed.data.url, { method: 'POST' });
 *   if (response.status === 422) {
 *     // The receiver will reject this body every time; retrying cannot help.
 *     throw new PermanentJobError(`Webhook rejected with ${response.status}`);
 *   }
 *   if (!response.ok) {
 *     // Transient — let it retry with the queue's backoff.
 *     throw new Error(`Webhook failed with ${response.status}`);
 *   }
 * }
 * ```
 */
export class PermanentJobError extends ServerkitError {
  /**
   * Creates a new PermanentJobError.
   *
   * @param message - Why the job can never succeed.
   * @param options - Standard error options. To chain an underlying error, prefer
   *                  the inherited `withCause` setter.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}
