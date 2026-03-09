import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ServerKitBodyParser, ServerKitParserMappings } from '../src/serverkit.bodyparser.js';
import type { ServerKitParser } from '../src/parsers/serverkit.parser.js';
import type { ServerKitContext } from '../src/serverkit.context.js';

describe('ServerKitBodyParser', () => {
  let mockParser: { parse: Mock };
  let mappings: ServerKitParserMappings;
  let mockCtx: ServerKitContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParser = { parse: vi.fn() };
    mappings = new ServerKitParserMappings();
    mockCtx = {
      request: { is: vi.fn() },
      req: {},
    } as unknown as ServerKitContext;
  });

  describe('parse()', () => {
    it('calls ctx.request.is with all registered mime types', async () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      mappings.set('text/plain', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue(false);

      try { await bodyParser.parse(mockCtx); } catch { /* expected */ }

      expect(mockCtx.request.is).toHaveBeenCalledWith(
        expect.arrayContaining(['application/json', 'text/plain']),
      );
    });

    it('deduplicates mime types passed to ctx.request.is', async () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      mappings.set('application/json', mockParser as unknown as ServerKitParser); // duplicate key in Map doesn't add, but test unique()
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue(false);

      try { await bodyParser.parse(mockCtx); } catch { /* expected */ }

      const [calledWith] = vi.mocked(mockCtx.request.is).mock.calls[0] as [string[]];
      const count = calledWith.filter(t => t === 'application/json').length;
      expect(count).toBe(1);
    });

    it('throws 415 with details when no mime type matches', async () => {
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue(false);

      await expect(bodyParser.parse(mockCtx)).rejects.toMatchObject({
        statusCode: 415,
        details: { body: 'Unsupported media type' },
      });
    });

    it('throws 415 when matched mime type has no registered parser', async () => {
      // request.is() returns a type not in the map — edge case with inconsistent state
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue('application/xml');

      await expect(bodyParser.parse(mockCtx)).rejects.toMatchObject({ statusCode: 415 });
    });

    it('calls the matched parser with ctx.req', async () => {
      const parseResult = { parsed: { key: 'value' }, raw: '{"key":"value"}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue('application/json');

      await bodyParser.parse(mockCtx);

      expect(mockParser.parse).toHaveBeenCalledWith(mockCtx.req);
    });

    it('returns the result from the matched parser', async () => {
      const parseResult = { parsed: { key: 'value' }, raw: '{"key":"value"}' };
      mockParser.parse.mockResolvedValue(parseResult);
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue('application/json');

      const result = await bodyParser.parse(mockCtx);

      expect(result).toBe(parseResult);
    });

    it('propagates errors thrown by the parser', async () => {
      mockParser.parse.mockRejectedValue(new Error('parse failed'));
      mappings.set('application/json', mockParser as unknown as ServerKitParser);
      const bodyParser = new ServerKitBodyParser(mappings);
      vi.mocked(mockCtx.request.is).mockReturnValue('application/json');

      await expect(bodyParser.parse(mockCtx)).rejects.toThrow('parse failed');
    });
  });
});
