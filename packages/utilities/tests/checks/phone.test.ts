import { describe, it, expect } from 'vitest';
import { isPhoneE164 } from '../../src/checks/phone.js';

describe('isPhoneE164', () => {
  describe('valid E.164 numbers', () => {
    it('returns true for a US number', () => {
      expect(isPhoneE164('+12025550123')).toBe(true);
    });

    it('returns true for a UK number', () => {
      expect(isPhoneE164('+447911123456')).toBe(true);
    });

    it('returns true for a single-digit country code', () => {
      expect(isPhoneE164('+12345678901')).toBe(true);
    });

    it('returns true for the minimum valid length (2 digits after +)', () => {
      expect(isPhoneE164('+11')).toBe(true);
    });

    it('returns true for the maximum valid length (15 digits total)', () => {
      expect(isPhoneE164('+123456789012345')).toBe(true);
    });
  });

  describe('invalid E.164 numbers', () => {
    it('returns false for an empty string', () => {
      expect(isPhoneE164('')).toBe(false);
    });

    it('returns false when the leading + is missing', () => {
      expect(isPhoneE164('12025550123')).toBe(false);
    });

    it('returns false when the number starts with +0 (invalid country code)', () => {
      expect(isPhoneE164('+012345')).toBe(false);
    });

    it('returns false for a number that is too long (16+ digits)', () => {
      expect(isPhoneE164('+1234567890123456')).toBe(false);
    });

    it('returns false for a number that is too short (only the + sign)', () => {
      expect(isPhoneE164('+')).toBe(false);
    });

    it('returns false when non-digit characters appear after the +', () => {
      expect(isPhoneE164('+1 202 555 0123')).toBe(false);
      expect(isPhoneE164('+1-202-555-0123')).toBe(false);
      expect(isPhoneE164('+1(202)5550123')).toBe(false);
    });

    it('returns false for a plain string with no digits', () => {
      expect(isPhoneE164('not-a-phone')).toBe(false);
    });

    it('returns false for a number with a trailing space', () => {
      expect(isPhoneE164('+12025550123 ')).toBe(false);
    });
  });
});
