import { describe, it, expect } from 'vitest';
import { isEmail, isEmailDomain } from '../../src/checks/email.js';

describe('isEmail', () => {
  describe('valid emails', () => {
    it('should return true for simple email', () => {
      expect(isEmail('user@example.com')).toBe(true);
    });

    it('should return true for email with subdomain', () => {
      expect(isEmail('user@mail.example.com')).toBe(true);
    });

    it('should return true for email with multiple subdomains', () => {
      expect(isEmail('user@a.b.c.example.com')).toBe(true);
    });

    it('should return true for email with plus sign', () => {
      expect(isEmail('user+tag@example.com')).toBe(true);
    });

    it('should return true for email with dots in local part', () => {
      expect(isEmail('first.last@example.com')).toBe(true);
    });

    it('should return true for email with numbers', () => {
      expect(isEmail('user123@example123.com')).toBe(true);
    });

    it('should return true for email with hyphen in domain', () => {
      expect(isEmail('user@my-domain.com')).toBe(true);
    });

    it('should return true for email with special characters in local part', () => {
      expect(isEmail("user!#$%&'*+/=?^_`{|}~-@example.com")).toBe(true);
    });

    it('should return true for single character local part', () => {
      expect(isEmail('a@example.com')).toBe(true);
    });

    it('should return true for single character domain', () => {
      expect(isEmail('user@a.com')).toBe(true);
    });

    it('should return true for numeric domain', () => {
      expect(isEmail('user@123.com')).toBe(true);
    });
  });

  describe('invalid emails', () => {
    it('should return false for empty string', () => {
      expect(isEmail('')).toBe(false);
    });

    it('should return false for string without @', () => {
      expect(isEmail('userexample.com')).toBe(false);
    });

    it('should return false for string with multiple @', () => {
      expect(isEmail('user@@example.com')).toBe(false);
    });

    it('should return false for @ only', () => {
      expect(isEmail('@')).toBe(false);
    });

    it('should return false for missing local part', () => {
      expect(isEmail('@example.com')).toBe(false);
    });

    it('should return false for missing domain', () => {
      expect(isEmail('user@')).toBe(false);
    });

    it('should return false for domain starting with hyphen', () => {
      expect(isEmail('user@-example.com')).toBe(false);
    });

    it('should return false for domain ending with hyphen', () => {
      expect(isEmail('user@example-.com')).toBe(false);
    });

    it('should return false for spaces', () => {
      expect(isEmail('user @example.com')).toBe(false);
      expect(isEmail('user@ example.com')).toBe(false);
      expect(isEmail(' user@example.com')).toBe(false);
    });

    it('should return false for domain with only dots', () => {
      expect(isEmail('user@...')).toBe(false);
    });

    it('should return false for consecutive dots in domain', () => {
      expect(isEmail('user@example..com')).toBe(false);
    });
  });
});

describe('isEmailDomain', () => {
  describe('valid email domains', () => {
    it('should return true for simple domain with @', () => {
      expect(isEmailDomain('@example.com')).toBe(true);
    });

    it('should return true for domain with subdomain', () => {
      expect(isEmailDomain('@mail.example.com')).toBe(true);
    });

    it('should return true for domain with multiple subdomains', () => {
      expect(isEmailDomain('@a.b.c.example.com')).toBe(true);
    });

    it('should return true for domain with hyphen', () => {
      expect(isEmailDomain('@my-domain.com')).toBe(true);
    });

    it('should return true for single character domain', () => {
      expect(isEmailDomain('@a.com')).toBe(true);
    });

    it('should return true for numeric domain', () => {
      expect(isEmailDomain('@123.com')).toBe(true);
    });

    it('should return true for domain without TLD', () => {
      expect(isEmailDomain('@localhost')).toBe(true);
    });
  });

  describe('invalid email domains', () => {
    it('should return false for empty string', () => {
      expect(isEmailDomain('')).toBe(false);
    });

    it('should return false for @ only', () => {
      expect(isEmailDomain('@')).toBe(false);
    });

    it('should return false for domain without @', () => {
      expect(isEmailDomain('example.com')).toBe(false);
    });

    it('should return false for domain starting with hyphen', () => {
      expect(isEmailDomain('@-example.com')).toBe(false);
    });

    it('should return false for domain ending with hyphen', () => {
      expect(isEmailDomain('@example-.com')).toBe(false);
    });

    it('should return false for domain with spaces', () => {
      expect(isEmailDomain('@ example.com')).toBe(false);
      expect(isEmailDomain('@example .com')).toBe(false);
    });

    it('should return false for domain with consecutive dots', () => {
      expect(isEmailDomain('@example..com')).toBe(false);
    });

    it('should return false for domain starting with dot', () => {
      expect(isEmailDomain('@.example.com')).toBe(false);
    });

    it('should return false when including local part', () => {
      expect(isEmailDomain('user@example.com')).toBe(false);
    });
  });
});
