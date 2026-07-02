import { Constructor, Identifier, Instance } from 'injectkit';
import { FormParser, FormParserOptions } from './form.parser.js';
import { JsonParser, JsonParserOptions } from './json.parser.js';
import { MultipartParser } from './multipart.parser.js';
import { ServerKitParser } from './serverkit.parser.js';
import { TextParser, TextParserOptions } from './text.parser.js';
import { bigIntReviver } from '@maroonedsoftware/utilities';
import { BinaryParser } from './binary.parser.js';

/**
 * A single entry in {@link defaultParserMappings}: the parser class to instantiate for a MIME
 * subtype, plus an optional options object to register alongside it.
 *
 * @property parser  - The {@link ServerKitParser} {@link Constructor} the DI container instantiates for this MIME subtype.
 * @property options - Optional configuration to register for the parser: `id` is the InjectKit
 *                     {@link Identifier} the parser depends on (e.g. `JsonParserOptions`) and `instance` is the
 *                     pre-built options object bound to it.
 */
export type ServerKitParserMapping = {
  parser: Constructor<ServerKitParser>;
  options?: {
    id: Identifier<unknown>;
    instance: Instance<unknown>;
  };
};

/** Builds the default {@link JsonParserOptions} with the {@link bigIntReviver} wired in so numeric-string bigints round-trip. */
const jsonParserOptions = (): JsonParserOptions => Object.assign(new JsonParserOptions(), { reviver: bigIntReviver });

/**
 * Built-in MIME-subtype-to-parser mappings used by {@link bodyParserMiddleware}.
 *
 * Each key is a MIME subtype (matched against `Content-Type` via Koa's `ctx.request.is()`)
 * and the value is a {@link ServerKitParserMapping} pairing the {@link ServerKitParser} class
 * with any options object to register for it.
 *
 * | MIME subtype                | Parser            | Options              |
 * | --------------------------- | ----------------- | -------------------- |
 * | `json`                      | {@link JsonParser}      | {@link JsonParserOptions} (bigint reviver) |
 * | `application/*+json`        | {@link JsonParser}      | {@link JsonParserOptions} (bigint reviver) |
 * | `urlencoded`                | {@link FormParser}      | {@link FormParserOptions} |
 * | `text`                      | {@link TextParser}      | {@link TextParserOptions} |
 * | `multipart`                 | {@link MultipartParser} | —                    |
 * | `application/octet-stream`  | {@link BinaryParser}    | —                    |
 * | `application/pdf`           | {@link BinaryParser}    | —                    |
 * | `application/zip`           | {@link BinaryParser}    | —                    |
 * | `application/gzip`          | {@link BinaryParser}    | —                    |
 *
 * Extend by spreading into a new object and registering the result in the DI container:
 * ```typescript
 * const myMappings = { ...defaultParserMappings, csv: { parser: BinaryParser } };
 * ```
 */
export const defaultParserMappings: Record<string, ServerKitParserMapping> = {
  json: { parser: JsonParser, options: { id: JsonParserOptions, instance: jsonParserOptions() } },
  'application/*+json': { parser: JsonParser, options: { id: JsonParserOptions, instance: jsonParserOptions() } },
  urlencoded: { parser: FormParser, options: { id: FormParserOptions, instance: new FormParserOptions() } },
  text: { parser: TextParser, options: { id: TextParserOptions, instance: new TextParserOptions() } },
  multipart: { parser: MultipartParser },
  'application/octet-stream': { parser: BinaryParser },
  'application/pdf': { parser: BinaryParser },
  'application/zip': { parser: BinaryParser },
  'application/gzip': { parser: BinaryParser },
} as const;
