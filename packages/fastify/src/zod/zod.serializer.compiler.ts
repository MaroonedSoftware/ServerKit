import type { FastifySerializerCompiler } from 'fastify';
import { compileSerializer, type CompileSerializerOptions } from '@maroonedsoftware/zod/serializer';
import type { ZodType } from 'zod';

/**
 * Builds Fastify's serializer compiler for Zod schemas: each `schema.response[status]` is compiled
 * once, at route registration, into a `fast-json-stringify` serializer specialised to that shape.
 *
 * Compilation is the same `compileSerializer` from `@maroonedsoftware/zod/serializer`, so a schema
 * node with no JSON Schema equivalent (a transform, `z.custom`, `z.date`, `z.bigint`) fails when
 * the route is registered rather than serializing wrongly per request. Model datetimes as
 * `z.iso.datetime()` strings, or map the node through `options.override`.
 *
 * The compiled function does not validate. A handler returning something the schema does not
 * describe has unknown properties dropped or values coerced, silently.
 *
 * Requires `fast-json-stringify`, an optional peer of `@maroonedsoftware/zod`.
 *
 * @param options - Forwarded to `compileSerializer`; see `CompileSerializerOptions`.
 * @returns The compiler to pass to `setSerializerCompiler`; see {@link zodPlugin}.
 */
export const zodSerializerCompiler = (options?: CompileSerializerOptions): FastifySerializerCompiler<ZodType> => {
  return ({ schema }) => compileSerializer(schema, options);
};
