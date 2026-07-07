import { describe, it, expect } from 'vitest';
import { isUuid } from '../../src/checks/uuid.js';

describe('isUuid', () => {
  describe('valid UUIDs', () => {
    it('should return true for valid UUID v1', () => {
      expect(isUuid('550e8400-e29b-11d4-a716-446655440000')).toBe(true);
    });

    it('should return true for valid UUID v4', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return true for valid UUID v5', () => {
      expect(isUuid('550e8400-e29b-51d4-a716-446655440000')).toBe(true);
    });

    it('should return true for nil UUID', () => {
      expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('should return true for uppercase UUID', () => {
      expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('should return true for mixed case UUID', () => {
      expect(isUuid('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
    });

    it('should return true for UUID with all valid hex characters', () => {
      expect(isUuid('abcdef00-1234-4567-89ab-cdef01234567')).toBe(true);
    });

    it('should return true for valid UUID v0', () => {
      expect(isUuid('550e8400-e29b-01d4-a716-446655440000')).toBe(true);
    });

    it('should return true for valid UUID v6', () => {
      expect(isUuid('1ec9414c-232a-6b00-b3c8-9e6bdeced846')).toBe(true);
    });

    it('should return true for valid UUID v7', () => {
      expect(isUuid('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe(true);
    });

    it('should return true for valid UUID v8', () => {
      expect(isUuid('550e8400-e29b-81d4-a716-446655440000')).toBe(true);
    });

    it('should return true for various valid variant bits (8, 9, a, b)', () => {
      expect(isUuid('550e8400-e29b-41d4-8716-446655440000')).toBe(true);
      expect(isUuid('550e8400-e29b-41d4-9716-446655440000')).toBe(true);
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUuid('550e8400-e29b-41d4-b716-446655440000')).toBe(true);
    });
  });

  describe('invalid UUIDs', () => {
    it('should return false for empty string', () => {
      expect(isUuid('')).toBe(false);
    });

    it('should return false for random string', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
    });

    it('should return false for UUID without hyphens', () => {
      expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false);
    });

    it('should return false for UUID with wrong hyphen positions', () => {
      expect(isUuid('550e84-00e29b-41d4a-716446-655440000')).toBe(false);
    });

    it('should return false for too short UUID', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
    });

    it('should return false for too long UUID', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-4466554400000')).toBe(false);
    });

    it('should return false for UUID with invalid characters', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-a716-44665544000!')).toBe(false);
    });

    it('should return false for UUID with spaces', () => {
      expect(isUuid(' 550e8400-e29b-41d4-a716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000 ')).toBe(false);
      expect(isUuid('550e8400 -e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should return false for UUID with braces', () => {
      expect(isUuid('{550e8400-e29b-41d4-a716-446655440000}')).toBe(false);
    });

    it('should return false for UUID with urn prefix', () => {
      expect(isUuid('urn:uuid:550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should return false for invalid version (9, a-f)', () => {
      expect(isUuid('550e8400-e29b-91d4-a716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-a1d4-a716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-f1d4-a716-446655440000')).toBe(false);
    });

    it('should return false for invalid variant bits (c-f)', () => {
      // The regex allows variant bits 0, 8, 9, a, b but not c-f
      expect(isUuid('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-d716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-e716-446655440000')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-f716-446655440000')).toBe(false);
    });

    it('should return false for UUID with missing sections', () => {
      expect(isUuid('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4')).toBe(false);
    });
  });
});
