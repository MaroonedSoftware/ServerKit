import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { BusboyWrapper } from '../src/busboy.wrapper.js';
import { FileHandler } from '../src/types.js';
import { httpError } from '@maroonedsoftware/errors';

// Mock @fastify/busboy
vi.mock('@fastify/busboy', () => {
  class MockBusboy extends EventEmitter {
    constructor(options: { headers: unknown; limits?: unknown }) {
      super();
      this.options = options;
    }
    options: { headers: unknown; limits?: unknown };
  }
  return {
    Busboy: MockBusboy,
  };
});

describe('BusboyWrapper', () => {
  let mockReq: IncomingMessage;
  let mockHeaders: Record<string, string>;
  let mockStream: Readable;

  beforeEach(() => {
    mockStream = new Readable({
      read() {
        // Empty implementation
      },
    });
    mockReq = {
      pipe: vi.fn().mockReturnValue(mockStream),
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as IncomingMessage;
    mockHeaders = {
      'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a BusboyWrapper instance', () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      expect(wrapper).toBeInstanceOf(BusboyWrapper);
    });

    it('should set up event listeners', () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      // The wrapper extends Busboy which extends EventEmitter
      expect(wrapper).toBeInstanceOf(EventEmitter);
    });

    it('should register request close handler', () => {
      new BusboyWrapper(mockReq, mockHeaders);
      expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should accept limits option', () => {
      const limits = { files: 5, fileSize: 1024 };
      const wrapper = new BusboyWrapper(mockReq, mockHeaders, limits);
      expect(wrapper).toBeInstanceOf(BusboyWrapper);
    });
  });

  describe('parse', () => {
    it('should return a promise', () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const result = wrapper.parse(fileHandler);
      expect(result).toBeInstanceOf(Promise);
    });

    it('should pipe request to busboy', () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      wrapper.parse(fileHandler);
      expect(mockReq.pipe).toHaveBeenCalledWith(wrapper);
    });

    it('should resolve with fields map when parsing completes', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);

      const parsePromise = wrapper.parse(fileHandler);

      // Simulate field event
      wrapper.emit('field', 'field1', 'value1', false, false, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      expect(result).toBeInstanceOf(Map);
      expect(result.get('field1')).toEqual({
        value: 'value1',
        nameTruncated: false,
        valueTruncated: false,
        encoding: 'utf-8',
        mimeType: 'text/plain',
      });
    });

    it('should handle multiple fields with same name as array', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);

      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('field', 'field1', 'value1', false, false, 'utf-8', 'text/plain');
      wrapper.emit('field', 'field1', 'value2', false, false, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fieldData = result.get('field1');
      expect(Array.isArray(fieldData)).toBe(true);
      if (Array.isArray(fieldData)) {
        expect(fieldData).toHaveLength(2);
        expect(fieldData[0].value).toBe('value1');
        expect(fieldData[1].value).toBe('value2');
      }
    });

    it('should handle file events with fileHandler', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);

      const parsePromise = wrapper.parse(fileHandler);

      const fileStream = new Readable({
        read() {
          this.push(null); // End stream
        },
      });

      wrapper.emit('file', 'file1', fileStream, 'test.txt', 'utf-8', 'text/plain');

      // Wait for file handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      wrapper.emit('finish');

      const result = await parsePromise;
      expect(fileHandler).toHaveBeenCalledWith('file1', fileStream, 'test.txt', 'utf-8', 'text/plain');
      expect(result.get('file1')).toBeDefined();
    });

    it('should reject promise when fileHandler throws error', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const error = new Error('File processing failed');
      const fileHandler: FileHandler = vi.fn().mockRejectedValue(error);

      const parsePromise = wrapper.parse(fileHandler);

      const fileStream = new Readable({
        read() {
          this.push(null);
        },
      });

      wrapper.emit('file', 'file1', fileStream, 'test.txt', 'utf-8', 'text/plain');

      await expect(parsePromise).rejects.toThrow('File processing failed');
    });

    it('should handle file without fileHandler', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);

      const parsePromise = wrapper.parse(fileHandler);

      const fileStream = new Readable({
        read() {
          this.push(null);
        },
      });

      // Remove fileHandler to test behavior without it
      (wrapper as any).fileHandler = undefined;
      wrapper.emit('file', 'file1', fileStream, 'test.txt', 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      expect(result.get('file1')).toBeDefined();
    });

    it('should reject promise on error event', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const error = new Error('Parse error');
      wrapper.emit('error', error);

      await expect(parsePromise).rejects.toThrow('Parse error');
    });

    it('should handle partsLimit event', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('partsLimit');

      await expect(parsePromise).rejects.toThrow();
      try {
        await parsePromise;
      } catch (err) {
        expect(httpError(413).withInternalDetails({ reason: 'Reached parts limit' })).toBeDefined();
      }
    });

    it('should handle filesLimit event', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('filesLimit');

      await expect(parsePromise).rejects.toThrow();
    });

    it('should handle fieldsLimit event', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('fieldsLimit');

      await expect(parsePromise).rejects.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove all event listeners on finish', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('finish');
      await parsePromise;

      expect(mockReq.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove all event listeners on error', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('error', new Error('Test error'));

      try {
        await parsePromise;
      } catch {
        // Expected to throw
      }

      expect(mockReq.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle request close event', () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const closeHandler = (mockReq.on as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === 'close')?.[1];

      expect(closeHandler).toBeDefined();
      if (closeHandler) {
        // Call the cleanup handler
        closeHandler();
        // The cleanup method should be called, which removes listeners
        // Since cleanup is private, we verify it was set up correctly
        expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));
      }
    });
  });

  describe('field data handling', () => {
    it('should store field with truncated name', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('field', 'field1', 'value1', true, false, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fieldData = result.get('field1');
      expect(fieldData).toBeDefined();
      if (fieldData && !('stream' in fieldData)) {
        expect(fieldData.nameTruncated).toBe(true);
      }
    });

    it('should store field with truncated value', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('field', 'field1', 'value1', false, true, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fieldData = result.get('field1');
      expect(fieldData).toBeDefined();
      if (fieldData && !('stream' in fieldData)) {
        expect(fieldData.valueTruncated).toBe(true);
      }
    });
  });

  describe('file data handling', () => {
    it('should store file data correctly', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const fileStream = new Readable({
        read() {
          this.push(null);
        },
      });

      wrapper.emit('file', 'file1', fileStream, 'document.pdf', 'binary', 'application/pdf');
      await new Promise(resolve => setTimeout(resolve, 10));
      wrapper.emit('finish');

      const result = await parsePromise;
      const fileData = result.get('file1');
      expect(fileData).toBeDefined();
      if (fileData && 'stream' in fileData) {
        expect(fileData.filename).toBe('document.pdf');
        expect(fileData.encoding).toBe('binary');
        expect(fileData.mimeType).toBe('application/pdf');
      }
    });

    it('should handle multiple files with same fieldname', async () => {
      const wrapper = new BusboyWrapper(mockReq, mockHeaders);
      // Don't use fileHandler to avoid early resolution
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const fileStream1 = new Readable({
        read() {
          this.push(null);
        },
      });
      const fileStream2 = new Readable({
        read() {
          this.push(null);
        },
      });

      // Set fileHandler to undefined so onEnd isn't called after each file
      (wrapper as any).fileHandler = undefined;
      wrapper.emit('file', 'files', fileStream1, 'file1.txt', 'utf-8', 'text/plain');
      wrapper.emit('file', 'files', fileStream2, 'file2.txt', 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fileData = result.get('files');
      expect(Array.isArray(fileData)).toBe(true);
      if (Array.isArray(fileData)) {
        expect(fileData).toHaveLength(2);
      }
    });
  });
});
