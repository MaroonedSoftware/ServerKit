import { describe, it, expect } from 'vitest';
import { defaultParserMappings } from '../../src/parsers/serverkit.default.parsers.js';
import { JsonParser } from '../../src/parsers/json.parser.js';
import { FormParser } from '../../src/parsers/form.parser.js';
import { TextParser } from '../../src/parsers/text.parser.js';
import { MultipartParser } from '../../src/parsers/multipart.parser.js';
import { BinaryParser } from '../../src/parsers/binary.parser.js';
import { JsonParserOptions } from '../../src/parsers/json.parser.js';
import { bigIntReviver } from '@maroonedsoftware/utilities';

describe('defaultParserMappings', () => {
  it('maps json to JsonParser', () => {
    expect(defaultParserMappings['json']?.parser).toBe(JsonParser);
  });

  it('maps application/*+json to JsonParser', () => {
    expect(defaultParserMappings['application/*+json']?.parser).toBe(JsonParser);
  });

  it('maps urlencoded to FormParser', () => {
    expect(defaultParserMappings['urlencoded']?.parser).toBe(FormParser);
  });

  it('maps text to TextParser', () => {
    expect(defaultParserMappings['text']?.parser).toBe(TextParser);
  });

  it('maps multipart to MultipartParser', () => {
    expect(defaultParserMappings['multipart']?.parser).toBe(MultipartParser);
  });

  it('maps binary content types to BinaryParser', () => {
    expect(defaultParserMappings['application/octet-stream']?.parser).toBe(BinaryParser);
    expect(defaultParserMappings['application/pdf']?.parser).toBe(BinaryParser);
    expect(defaultParserMappings['application/zip']?.parser).toBe(BinaryParser);
    expect(defaultParserMappings['application/gzip']?.parser).toBe(BinaryParser);
  });

  it('attaches parser options where the parser requires them', () => {
    expect(defaultParserMappings['json']?.options?.id).toBeDefined();
    expect(defaultParserMappings['urlencoded']?.options?.id).toBeDefined();
    expect(defaultParserMappings['text']?.options?.id).toBeDefined();
  });

  it('leaves option-free parsers without options', () => {
    expect(defaultParserMappings['multipart']?.options).toBeUndefined();
    expect(defaultParserMappings['application/pdf']?.options).toBeUndefined();
  });

  it('binds a JsonParserOptions instance with the bigint reviver wired in', () => {
    const options = defaultParserMappings['json']?.options?.instance;

    expect(options).toBeInstanceOf(JsonParserOptions);
    expect((options as JsonParserOptions).reviver).toBe(bigIntReviver);
  });

  it('contains exactly 9 entries', () => {
    expect(Object.keys(defaultParserMappings)).toHaveLength(9);
  });
});
