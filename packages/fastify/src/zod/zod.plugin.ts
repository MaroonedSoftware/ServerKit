import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';
import type { CompileSerializerOptions } from '@maroonedsoftware/zod/serializer';
import { zodValidatorCompiler } from './zod.validator.compiler.js';
import { zodSerializerCompiler } from './zod.serializer.compiler.js';

/** Options for {@link zodPlugin}. */
export interface ZodPluginOptions {
  /** Forwarded to `compileSerializer` for every response schema. */
  serializer?: CompileSerializerOptions;
}

/**
 * Installs the Zod validator and serializer compilers on the server, so routes can declare their
 * `schema` with Zod schemas instead of JSON Schema.
 *
 * Register it in the plugin stack, after `errorPlugin` so a validation failure renders through
 * ServerKit's error handling. Type the routes with {@link ZodTypeProvider} to get the inferred
 * request and response types.
 *
 * @param options - Serializer tuning; see {@link ZodPluginOptions}.
 * @returns A {@link ServerKitPlugin} installing both compilers.
 *
 * @example
 * ```typescript
 * import { zodPlugin, type ZodTypeProvider } from '@maroonedsoftware/fastify/zod';
 *
 * builder.setupPlugins(container => [...serverKitDefaultPlugins(container), zodPlugin()]);
 *
 * const routes: FastifyPluginAsync = async instance => {
 *   const app = instance.withTypeProvider<ZodTypeProvider>();
 *   app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser, response: { 200: User } } }, async request =>
 *     app.container.get(UserService).create(request.body),
 *   );
 * };
 * ```
 */
export const zodPlugin = (options: ZodPluginOptions = {}): ServerKitPlugin => {
  return serverKitPlugin('serverkit.zod', async app => {
    app.setValidatorCompiler(zodValidatorCompiler());
    app.setSerializerCompiler(zodSerializerCompiler(options.serializer));
  });
};
