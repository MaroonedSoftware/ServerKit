import { Constructor, Registry } from 'injectkit';
import { ServerKitBodyParser, ServerKitParserMappings } from './serverkit.bodyparser.js';
import { ServerKitParser } from './parsers/serverkit.parser.js';
import { JsonParser } from './parsers/json.parser.js';
import { TextParser } from './parsers/text.parser.js';
import { FormParser } from './parsers/form.parser.js';
import { MultipartParser } from './parsers/multipart.parser.js';
import { BinaryParser } from './parsers/binary.parser.js';

export type ParserMappingOverrides = Record<string, Constructor<ServerKitParser>>;

const defaultParserMappings: ParserMappingOverrides = {
  'json': JsonParser,
  'application/*+json': JsonParser,
  'urlencoded': FormParser,
  'text': TextParser,
  'multipart': MultipartParser,
};

const defaultParserClasses: Constructor<ServerKitParser>[] = [
  JsonParser,
  FormParser,
  TextParser,
  MultipartParser,
  BinaryParser,
];

export const setupParsers = (registry: Registry, overrides: ParserMappingOverrides = {}) => {
  const merged = { ...defaultParserMappings, ...overrides };

  const mapRegistration = registry
    .register(ServerKitParserMappings)
    .useMap(ServerKitParserMappings);

  for (const [key, parser] of Object.entries(merged)) {
    mapRegistration.set(key, parser);
  }

  const parserClasses = new Set<Constructor<ServerKitParser>>([
    ...defaultParserClasses,
    ...Object.values(overrides),
  ]);

  for (const parserClass of parserClasses) {
    registry.register(parserClass).useClass(parserClass).asSingleton();
  }

  registry.register(ServerKitBodyParser).useClass(ServerKitBodyParser).asSingleton();
};
