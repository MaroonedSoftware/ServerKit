// For real-HTTP behavior (close-race, abort handling) see multipart.body.http.integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { BusboyWrapper } from '../src/busboy.wrapper.js';
import { FileHandler, isMultipartFieldData } from '../src/types.js';
import { httpError, IsServerkitError } from '@maroonedsoftware/errors';

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
    mockHeaders = {
      'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
    };
    mockReq = {
      pipe: vi.fn().mockReturnValue(mockStream),
      unpipe: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      headers: mockHeaders,
    } as unknown as IncomingMessage;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a BusboyWrapper instance', () => {
      const wrapper = new BusboyWrapper(mockReq);
      expect(wrapper).toBeInstanceOf(BusboyWrapper);
    });

    it('should be an EventEmitter (via Busboy)', () => {
      const wrapper = new BusboyWrapper(mockReq);
      expect(wrapper).toBeInstanceOf(EventEmitter);
    });

    it('should not register any req listeners until parse() is called', () => {
      new BusboyWrapper(mockReq);
      expect(mockReq.on).not.toHaveBeenCalled();
    });

    it('should accept limits option', () => {
      const limits = { files: 5, fileSize: 1024 };
      const wrapper = new BusboyWrapper(mockReq, limits);
      expect(wrapper).toBeInstanceOf(BusboyWrapper);
    });
  });

  describe('parse', () => {
    it('should return a promise', () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const result = wrapper.parse(fileHandler);
      expect(result).toBeInstanceOf(Promise);
    });

    it('should pipe request to busboy', () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      wrapper.parse(fileHandler);
      expect(mockReq.pipe).toHaveBeenCalledWith(wrapper);
    });

    it('should register the request close handler when parse() runs', () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      wrapper.parse(fileHandler);
      expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should throw a ServerkitError synchronously if called more than once', () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      wrapper.parse(fileHandler);
      let caught: unknown;
      try {
        wrapper.parse(fileHandler);
      } catch (err) {
        caught = err;
      }
      expect(IsServerkitError(caught)).toBe(true);
      expect((caught as Error).message).toMatch(/may only be called once/);
    });

    it('should resolve with fields map when parsing completes', async () => {
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
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
        const first = fieldData[0]!;
        const second = fieldData[1]!;
        if (isMultipartFieldData(first)) expect(first.value).toBe('value1');
        if (isMultipartFieldData(second)) expect(second.value).toBe('value2');
      }
    });

    it('should handle file events with fileHandler', async () => {
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const error = new Error('Parse error');
      wrapper.emit('error', error);

      await expect(parsePromise).rejects.toThrow('Parse error');
    });

    it('should reject with 413 when a file stream emits "limit"', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const fileStream = new Readable({ read() {} });
      wrapper.emit('file', 'big', fileStream, 'big.bin', '7bit', 'application/octet-stream');
      fileStream.emit('limit');

      await expect(parsePromise).rejects.toMatchObject({
        statusCode: 413,
        internalDetails: { reason: 'Reached file size limit', filename: 'big.bin', fieldname: 'big' },
      });
    });

    it('should handle partsLimit event', async () => {
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('filesLimit');

      await expect(parsePromise).rejects.toThrow();
    });

    it('should handle fieldsLimit event', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('fieldsLimit');

      await expect(parsePromise).rejects.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove all event listeners on finish', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('finish');
      await parsePromise;

      expect(mockReq.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove all event listeners on error', async () => {
      const wrapper = new BusboyWrapper(mockReq);
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

    it('should unpipe req from busboy on error so the body is not silently drained', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('error', new Error('boom'));

      await expect(parsePromise).rejects.toThrow('boom');
      expect(mockReq.unpipe).toHaveBeenCalledWith(wrapper);
    });

    it('should not unpipe on the happy path', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('finish');
      await parsePromise;

      expect(mockReq.unpipe).not.toHaveBeenCalled();
    });

    it('should treat req close as an abort when req.complete is false', async () => {
      Object.defineProperty(mockReq, 'complete', { value: false, configurable: true });
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const closeHandler = (mockReq.on as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === 'close')?.[1];
      expect(closeHandler).toBeDefined();
      closeHandler!();

      await expect(parsePromise).rejects.toMatchObject({
        statusCode: 400,
        internalDetails: { reason: 'client aborted upload before body completed' },
      });
    });

    it('should ignore req close when req.complete is true (let finalize handle teardown)', async () => {
      Object.defineProperty(mockReq, 'complete', { value: true, configurable: true });
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      const closeHandler = (mockReq.on as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === 'close')?.[1];
      closeHandler!();
      wrapper.emit('finish');

      const result = await parsePromise;
      expect(result).toBeInstanceOf(Map);
    });
  });

  describe('field data handling', () => {
    it('should store field with truncated name', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('field', 'field1', 'value1', true, false, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fieldData = result.get('field1');
      expect(fieldData).toBeDefined();
      if (fieldData && !Array.isArray(fieldData) && isMultipartFieldData(fieldData)) {
        expect(fieldData.nameTruncated).toBe(true);
      }
    });

    it('should store field with truncated value', async () => {
      const wrapper = new BusboyWrapper(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const parsePromise = wrapper.parse(fileHandler);

      wrapper.emit('field', 'field1', 'value1', false, true, 'utf-8', 'text/plain');
      wrapper.emit('finish');

      const result = await parsePromise;
      const fieldData = result.get('field1');
      expect(fieldData).toBeDefined();
      if (fieldData && !Array.isArray(fieldData) && isMultipartFieldData(fieldData)) {
        expect(fieldData.valueTruncated).toBe(true);
      }
    });
  });

  describe('file data handling', () => {
    it('should store file data correctly', async () => {
      const wrapper = new BusboyWrapper(mockReq);
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
      const wrapper = new BusboyWrapper(mockReq);
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
