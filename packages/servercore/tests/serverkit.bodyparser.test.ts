import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { ServerKitBodyParser, ServerKitParserMappings } from '../src/serverkit.bodyparser.js';
import type { ServerKitParser } from '../src/parsers/serverkit.parser.js';

/** A request stub carrying just the headers `type-is` inspects. */
const makeReq = (contentType?: string): IncomingMessage =>
  ({
    headers: contentType === undefined ? {} : { 'content-type': contentType, 'content-length': '1' },
  }) as unknown as IncomingMessage;

describe('ServerKitBodyParser', () => {
  let mockParser: { parse: Mock };
  let mappings: ServerKitParserMappings;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParser = { parse: vi.fn() };
    mappings = new ServerKitParserMappings();
  });

  describe('mimeTypes', () => {
    it('exposes the registered mime types', () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      mappings.set('text/plain', mockParser as unknown as ServerKitParser);

      const bodyParser = new ServerKitBodyParser(mappings);

      expect(bodyParser.mimeTypes).toEqual(expect.arrayContaining(['application/json', 'text/plain']));
    });

    it('deduplicates mime types', () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      mappings.set('application/json', mockParser as unknown as ServerKitParser);

      const bodyParser = new ServerKitBodyParser(mappings);

      expect(bodyParser.mimeTypes.filter(t => t === 'application/json')).toHaveLength(1);
    });
  });

  describe('parse()', () => {
    it('throws 415 with details when no mime type matches', async () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);

      await expect(bodyParser.parse(makeReq('application/xml'))).rejects.toMatchObject({
        statusCode: 415,
        details: { body: 'Unsupported media type' },
      });
    });

    it('throws 415 when the request has no content type', async () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);

      await expect(bodyParser.parse(makeReq())).rejects.toMatchObject({ statusCode: 415 });
    });

    it('calls the matched parser with the raw request', async () => {
      const parseResult = { parsed: { key: 'value' }, raw: '{"key":"value"}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      const req = makeReq('application/json');

      await bodyParser.parse(req);

      expect(mockParser.parse).toHaveBeenCalledWith(req);
    });

    it('unwraps a context that carries the raw request as `req`', async () => {
      const parseResult = { parsed: { key: 'value' }, raw: '{"key":"value"}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      const req = makeReq('application/json');

      const result = await bodyParser.parse({ req });

      expect(result).toBe(parseResult);
      expect(mockParser.parse).toHaveBeenCalledWith(req);
    });

    it('matches a subtype shorthand key such as `json`', async () => {
      const parseResult = { parsed: {}, raw: '{}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);

      const result = await bodyParser.parse(makeReq('application/json; charset=utf-8'));

      expect(result).toBe(parseResult);
    });

    it('resolves a concrete +json type to a wildcard-registered parser (not 415)', async () => {
      // type-is returns the concrete type (application/vnd.api+json) when it matches the
      // wildcard key application/*+json, so a direct Map.get(matched) misses.
      const parseResult = { parsed: { data: true }, raw: '{"data":true}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('application/*+json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      const req = makeReq('application/vnd.api+json');

      const result = await bodyParser.parse(req);

      expect(result).toBe(parseResult);
      expect(mockParser.parse).toHaveBeenCalledWith(req);
    });

    it('propagates errors thrown by the parser', async () => {
      mockParser.parse.mockRejectedValue(new Error('parse failed'));
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);

      await expect(bodyParser.parse(makeReq('application/json'))).rejects.toThrow('parse failed');
    });
  });
});
