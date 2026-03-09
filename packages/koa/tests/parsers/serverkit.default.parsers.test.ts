import { describe, it, expect } from 'vitest';
import { defaultParserMappings } from '../../src/parsers/serverkit.default.parsers.js';
import { JsonParser } from '../../src/parsers/json.parser.js';
import { FormParser } from '../../src/parsers/form.parser.js';
import { TextParser } from '../../src/parsers/text.parser.js';
import { MultipartParser } from '../../src/parsers/multipart.parser.js';

describe('defaultParserMappings', () => {
  it('maps json to JsonParser', () => {
    expect(defaultParserMappings['json']).toBe(JsonParser);
  });

  it('maps application/*+json to JsonParser', () => {
    expect(defaultParserMappings['application/*+json']).toBe(JsonParser);
  });

  it('maps urlencoded to FormParser', () => {
    expect(defaultParserMappings['urlencoded']).toBe(FormParser);
  });

  it('maps text to TextParser', () => {
    expect(defaultParserMappings['text']).toBe(TextParser);
  });

  it('maps multipart to MultipartParser', () => {
    expect(defaultParserMappings['multipart']).toBe(MultipartParser);
  });

  it('contains exactly 5 entries', () => {
    expect(Object.keys(defaultParserMappings)).toHaveLength(5);
  });
});
