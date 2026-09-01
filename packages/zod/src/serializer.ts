import fastJsonStringify from 'fast-json-stringify';
import { z, type ZodType } from 'zod';

/**
 * Options for {@link compileSerializer}.
 */
export interface CompileSerializerOptions {
  /**
   * How schema nodes with no JSON Schema equivalent (transforms, `z.custom`, `z.date`,
   * `z.bigint`) are handled at compile time. Default `'throw'` — fail at startup, not per
   * request. `'any'` emits an empty schema for the node; what fast-json-stringify then does
   * with the value is the caller's risk.
   */
  unrepresentable?: 'throw' | 'any';
  /**
   * Escape-hatch rewriting of the generated JSON Schema per node, forwarded to
   * `z.toJSONSchema`. Use it to hand-map a custom scalar the automatic conversion rejects.
   */
  override?: z.core.ToJSONSchemaParams['override'];
}

/**
 * Compiles a Zod schema into a `fast-json-stringify` serializer for the schema's **output**
 * type. The compiled function is straight-line string building specialized to the schema's
 * exact shape — typically 2-3× faster than `JSON.stringify`'s generic object-graph walk, which
 * is the same technique Fastify uses for its response serialization.
 *
 * Compile once at startup (module scope or a module's `setup` hook) and reuse the returned
 * function; compilation itself is expensive. Pair with `@maroonedsoftware/koa`'s `sendJson` to
 * write the result with the correct content type.
 *
 * **The returned function performs no validation.** A value that does not conform to the
 * schema is silently coerced or has unknown properties dropped by fast-json-stringify — only
 * serialize values that came out of the schema (or are otherwise known-conforming).
 *
 * Schema nodes that cannot be expressed in JSON Schema — transforms, `z.custom` (including
 * Luxon `DateTime` customs), `z.date`, `z.bigint` — throw here, at compile time, rather than
 * serializing wrongly at request time. Model output datetimes as `z.iso.datetime()` strings,
 * or map the node yourself via {@link CompileSerializerOptions.override}.
 *
 * Requires the optional peer dependency `fast-json-stringify`.
 *
 * @param schema - The Zod schema describing the value's output shape.
 * @param options - Optional {@link CompileSerializerOptions}.
 * @returns A function serializing a schema-conforming value to a JSON string.
 *
 * @example
 * ```typescript
 * const serializeUser = compileSerializer(User);
 * // in the handler:
 * sendJson(ctx, serializeUser(user));
 * ```
 */
export const compileSerializer = <T extends ZodType>(schema: T, options?: CompileSerializerOptions): ((value: z.infer<T>) => string) => {
  // draft-07 is the dialect fast-json-stringify understands: shared defs land in
  // `definitions` (not `$defs`) with matching `$ref`s. The payload also carries a
  // non-JSON `~standard` property (Standard Schema interop functions); it is
  // non-enumerable today, but strip defensively rather than rely on that.
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, {
    target: 'draft-07',
    io: 'output',
    unrepresentable: options?.unrepresentable ?? 'throw',
    override: options?.override,
  }) };
  delete jsonSchema['~standard'];

  // fast-json-stringify types its input as a closed Schema union; the generated document is a
  // JSON Schema by construction, so bridge through unknown rather than re-modelling zod's output.
  return fastJsonStringify(jsonSchema as unknown as Parameters<typeof fastJsonStringify>[0]) as (value: z.infer<T>) => string;
};
