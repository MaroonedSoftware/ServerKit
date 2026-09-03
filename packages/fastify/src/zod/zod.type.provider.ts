import type { FastifyTypeProvider } from 'fastify';
import type { ZodType, z } from 'zod';

/**
 * Fastify type provider that infers a route's request and response types from the Zod schemas in
 * its `schema` option, so `request.body`, `request.params`, and `request.query` are typed without
 * a cast.
 *
 * Validation uses a schema's **output** type (what the schema produces, after any transform) and
 * serialization its **input** type (what a handler may return for the schema to accept).
 *
 * Apply it per instance with `withTypeProvider`, and install the compilers with {@link zodPlugin}.
 *
 * @example
 * ```typescript
 * const routes: FastifyPluginAsync = async instance => {
 *   const app = instance.withTypeProvider<ZodTypeProvider>();
 *   app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser } }, async request => {
 *     return request.body.email; // typed as string
 *   });
 * };
 * ```
 */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends ZodType ? z.input<this['schema']> : unknown;
}
