import type { FastifySchemaCompiler } from 'fastify';
import { httpError } from '@maroonedsoftware/errors';
import { zodErrorDetails } from '@maroonedsoftware/zod';
import type { ZodType } from 'zod';

/**
 * Builds Fastify's validator compiler for Zod schemas: a route's `schema.body`, `schema.params`,
 * `schema.querystring`, or `schema.headers` is run with `safeParse`, and the parsed **output**
 * replaces the raw input, so a schema's coercions and transforms reach the handler.
 *
 * A failure is returned as an `HttpError` carrying `zodErrorDetails`, the same field map
 * `parseAndValidate` attaches, so `errorPlugin` renders a validation failure identically however
 * it was produced. Fastify tags it `FST_ERR_VALIDATION` and records which part failed on
 * `validationContext`, both of which survive to the error handler.
 *
 * Validation is synchronous, as Fastify requires: a schema with async refinements or transforms
 * cannot run here — validate those in the handler with `parseAndValidate` instead.
 *
 * @returns The compiler to pass to `setValidatorCompiler`; see {@link zodPlugin}.
 */
export const zodValidatorCompiler = (): FastifySchemaCompiler<ZodType> => {
  return ({ schema }) =>
    data => {
      const result = schema.safeParse(data);
      return result.success ? { value: result.data } : { error: httpError(400).withDetails(zodErrorDetails(result.error)) };
    };
};
