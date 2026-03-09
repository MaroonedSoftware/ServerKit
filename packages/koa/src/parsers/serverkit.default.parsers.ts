import { Identifier } from 'injectkit';
import { FormParser } from './form.parser.js';
import { JsonParser } from './json.parser.js';
import { MultipartParser } from './multipart.parser.js';
import { ServerKitParser } from './serverkit.parser.js';
import { TextParser } from './text.parser.js';

/**
 * Built-in MIME-subtype-to-parser mappings used by {@link bodyParserMiddleware}.
 *
 * Each key is a MIME subtype (matched against `Content-Type` via Koa's `ctx.request.is()`)
 * and the value is the InjectKit {@link Identifier} for the corresponding {@link ServerKitParser}.
 *
 * | MIME subtype          | Parser            |
 * | --------------------- | ----------------- |
 * | `json`                | {@link JsonParser}      |
 * | `application/*+json`  | {@link JsonParser}      |
 * | `urlencoded`          | {@link FormParser}      |
 * | `text`                | {@link TextParser}      |
 * | `multipart`           | {@link MultipartParser} |
 *
 * Extend by spreading into a new object and registering the result in the DI container:
 * ```typescript
 * const myMappings = { ...defaultParserMappings, pdf: BinaryParser };
 * ```
 */
export const defaultParserMappings: Record<string, Identifier<ServerKitParser>> = {
  json: JsonParser,
  'application/*+json': JsonParser,
  urlencoded: FormParser,
  text: TextParser,
  multipart: MultipartParser,
} as const;
