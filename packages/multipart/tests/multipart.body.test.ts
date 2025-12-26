import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomingMessage } from 'node:http';
import { MultipartBody } from '../src/multipart.body.js';
import { FileHandler } from '../src/types.js';

// Track instances created
const mockInstances: Array<{
  parse: ReturnType<typeof vi.fn>;
  limits?: unknown;
}> = [];

// Mock BusboyWrapper
vi.mock('../src/busboy.wrapper.js', () => {
  class MockBusboyWrapper {
    parse: ReturnType<typeof vi.fn>;
    limits?: unknown;

    constructor(
      public req: IncomingMessage,
      limits?: unknown,
    ) {
      this.limits = limits;
      // Create a promise that can be resolved/rejected later
      let resolvePromise: (value: unknown) => void;
      let rejectPromise: (error: unknown) => void;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      this.parse = vi.fn().mockImplementation(() => {
        // Store resolve/reject functions on the instance for later use
        (this as any)._resolve = resolvePromise;
        (this as any)._reject = rejectPromise;
        return promise;
      });
      mockInstances.push(this);
    }
  }
  return {
    BusboyWrapper: MockBusboyWrapper,
  };
});

describe('MultipartBody', () => {
  let mockReq: IncomingMessage;
  let mockHeaders: Record<string, string>;
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

  beforeEach(() => {
    mockHeaders = {
      'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
    };
    mockReq = {
      pipe: vi.fn(),
      on: vi.fn(),
      headers: mockHeaders,
    } as unknown as IncomingMessage;
    mockInstances.length = 0;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a MultipartBody instance', () => {
      const body = new MultipartBody(mockReq);
      expect(body).toBeInstanceOf(MultipartBody);
    });

    it('should create instance with default limits', () => {
      const body = new MultipartBody(mockReq);
      expect(body).toBeInstanceOf(MultipartBody);
    });

    it('should create instance with custom limits', () => {
      const limits: MultipartLimits = {
        files: 5,
        fileSize: 1024 * 1024,
        fields: 10,
      };
      const body = new MultipartBody(mockReq, limits);
      expect(body).toBeInstanceOf(MultipartBody);
    });
  });

  describe('parse', () => {
    it('should create BusboyWrapper and call parse', async () => {
      const body = new MultipartBody(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map([
        [
          'field1',
          {
            value: 'value1',
            nameTruncated: false,
            valueTruncated: false,
            encoding: 'utf-8',
            mimeType: 'text/plain',
          },
        ],
      ]);

      const parsePromise = body.parse(fileHandler);
      // Instance is created when parse is called
      expect(mockInstances).toHaveLength(1);
      // Resolve the promise
      (mockInstances[0] as any)._resolve(mockFields);

      const result = await parsePromise;

      expect(mockInstances[0]!.parse).toHaveBeenCalledWith(fileHandler);
      expect(result).toEqual(mockFields);
    });

    it('should merge custom limits with default limits', async () => {
      const defaultLimits: MultipartLimits = {
        files: 1,
        fileSize: MAX_FILE_SIZE,
      };
      const body = new MultipartBody(mockReq, defaultLimits);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map();

      const customLimits: MultipartLimits = {
        files: 5,
        fields: 10,
      };

      const parsePromise = body.parse(fileHandler, customLimits);
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._resolve(mockFields);

      await parsePromise;

      expect(mockInstances[0]!.limits).toMatchObject({
        files: 5,
        fileSize: MAX_FILE_SIZE,
        fields: 10,
      });
    });

    it('should override default limits with custom limits', async () => {
      const defaultLimits: MultipartLimits = {
        files: 1,
        fileSize: MAX_FILE_SIZE,
      };
      const body = new MultipartBody(mockReq, defaultLimits);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map();

      const customLimits: MultipartLimits = {
        files: 3,
        fileSize: 1024 * 1024, // 1 MB
      };

      const parsePromise = body.parse(fileHandler, customLimits);
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._resolve(mockFields);

      await parsePromise;

      expect(mockInstances[0]!.limits).toMatchObject({
        files: 3,
        fileSize: 1024 * 1024,
      });
    });

    it('should return the result from BusboyWrapper.parse', async () => {
      const body = new MultipartBody(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map([
        [
          'field1',
          {
            value: 'value1',
            nameTruncated: false,
            valueTruncated: false,
            encoding: 'utf-8',
            mimeType: 'text/plain',
          },
        ],
        [
          'field2',
          {
            value: 'value2',
            nameTruncated: false,
            valueTruncated: false,
            encoding: 'utf-8',
            mimeType: 'text/plain',
          },
        ],
      ]);

      const parsePromise = body.parse(fileHandler);
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._resolve(mockFields);

      const result = await parsePromise;

      expect(result).toBe(mockFields);
      expect(result.size).toBe(2);
    });

    it('should propagate errors from BusboyWrapper.parse', async () => {
      const body = new MultipartBody(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const error = new Error('Parse failed');

      const parsePromise = body.parse(fileHandler);
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._reject(error);

      await expect(parsePromise).rejects.toThrow('Parse failed');
    });

    it('should use default limits when no custom limits provided', async () => {
      const body = new MultipartBody(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map();

      const parsePromise = body.parse(fileHandler);
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._resolve(mockFields);

      await parsePromise;

      expect(mockInstances[0]!.limits).toMatchObject({
        files: 1,
        fileSize: MAX_FILE_SIZE,
      });
    });

    it('should handle empty limits object', async () => {
      const body = new MultipartBody(mockReq);
      const fileHandler: FileHandler = vi.fn().mockResolvedValue(undefined);
      const mockFields = new Map();

      const parsePromise = body.parse(fileHandler, {});
      expect(mockInstances).toHaveLength(1);
      (mockInstances[0] as any)._resolve(mockFields);

      await parsePromise;

      expect(mockInstances[0]!.limits).toMatchObject({
        files: 1,
        fileSize: MAX_FILE_SIZE,
      });
    });
  });
});
