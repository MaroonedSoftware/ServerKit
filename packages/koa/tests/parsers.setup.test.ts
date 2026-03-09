import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Registry } from 'injectkit';
import { setupParsers } from '../src/parsers.setup.js';
import { ServerKitBodyParser, ServerKitParserMappings } from '../src/serverkit.bodyparser.js';
import { JsonParser } from '../src/parsers/json.parser.js';
import { FormParser } from '../src/parsers/form.parser.js';
import { TextParser } from '../src/parsers/text.parser.js';
import { MultipartParser } from '../src/parsers/multipart.parser.js';
import { BinaryParser } from '../src/parsers/binary.parser.js';
import { ServerKitParser } from '../src/parsers/serverkit.parser.js';

describe('setupParsers', () => {
  let mockMapRegistration: { set: Mock };
  let mockClassRegistration: { asSingleton: Mock };
  let mockRegistrationType: { useMap: Mock; useClass: Mock };
  let mockRegistry: { register: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMapRegistration = { set: vi.fn().mockReturnThis() };
    mockClassRegistration = { asSingleton: vi.fn() };
    mockRegistrationType = {
      useMap: vi.fn().mockReturnValue(mockMapRegistration),
      useClass: vi.fn().mockReturnValue(mockClassRegistration),
    };
    mockRegistry = { register: vi.fn().mockReturnValue(mockRegistrationType) };
  });

  it('registers ServerKitParserMappings', () => {
    setupParsers(mockRegistry as unknown as Registry);

    expect(mockRegistry.register).toHaveBeenCalledWith(ServerKitParserMappings);
    expect(mockRegistrationType.useMap).toHaveBeenCalledWith(ServerKitParserMappings);
  });

  it('registers all 5 default content-type mappings', () => {
    setupParsers(mockRegistry as unknown as Registry);

    expect(mockMapRegistration.set).toHaveBeenCalledTimes(5);
    expect(mockMapRegistration.set).toHaveBeenCalledWith('json', JsonParser);
    expect(mockMapRegistration.set).toHaveBeenCalledWith('application/*+json', JsonParser);
    expect(mockMapRegistration.set).toHaveBeenCalledWith('urlencoded', FormParser);
    expect(mockMapRegistration.set).toHaveBeenCalledWith('text', TextParser);
    expect(mockMapRegistration.set).toHaveBeenCalledWith('multipart', MultipartParser);
  });

  it('registers all 5 default parser classes as singletons', () => {
    setupParsers(mockRegistry as unknown as Registry);

    for (const cls of [JsonParser, FormParser, TextParser, MultipartParser, BinaryParser]) {
      expect(mockRegistry.register).toHaveBeenCalledWith(cls);
    }
  });

  it('registers ServerKitBodyParser as a singleton', () => {
    setupParsers(mockRegistry as unknown as Registry);

    expect(mockRegistry.register).toHaveBeenCalledWith(ServerKitBodyParser);
  });

  it('registers exactly 6 classes as singletons by default (5 parsers + body parser)', () => {
    setupParsers(mockRegistry as unknown as Registry);

    // useClass is called once per parser class + ServerKitBodyParser
    expect(mockRegistrationType.useClass).toHaveBeenCalledTimes(6);
    expect(mockClassRegistration.asSingleton).toHaveBeenCalledTimes(6);
  });

  it('merges override mappings with defaults', () => {
    class CustomParser extends ServerKitParser {
      async parse() { return { parsed: null, raw: null }; }
    }

    setupParsers(mockRegistry as unknown as Registry, { 'application/custom': CustomParser });

    expect(mockMapRegistration.set).toHaveBeenCalledWith('application/custom', CustomParser);
    expect(mockMapRegistration.set).toHaveBeenCalledTimes(6); // 5 defaults + 1 override
  });

  it('override mapping replaces the default for the same key', () => {
    class MyJsonParser extends ServerKitParser {
      async parse() { return { parsed: null, raw: null }; }
    }

    setupParsers(mockRegistry as unknown as Registry, { json: MyJsonParser });

    expect(mockMapRegistration.set).toHaveBeenCalledWith('json', MyJsonParser);
    expect(mockMapRegistration.set).not.toHaveBeenCalledWith('json', JsonParser);
  });

  it('registers override parser classes', () => {
    class CustomParser extends ServerKitParser {
      async parse() { return { parsed: null, raw: null }; }
    }

    setupParsers(mockRegistry as unknown as Registry, { 'application/custom': CustomParser });

    expect(mockRegistry.register).toHaveBeenCalledWith(CustomParser);
  });

  it('does not register duplicate parser classes when the same class is used in multiple mappings', () => {
    // JsonParser is already mapped to both 'json' and 'application/*+json' by default;
    // ensure it is only registered once via the Set dedup
    setupParsers(mockRegistry as unknown as Registry);

    const calls = vi.mocked(mockRegistrationType.useClass).mock.calls.flat();
    const jsonParserCount = calls.filter(c => c === JsonParser).length;
    expect(jsonParserCount).toBe(1);
  });
});
