import { describe, it, expect } from 'vitest';
import { HtmlRedirectProvider } from '../../src/providers/html.redirect.provider.js';

describe('HtmlRedirectProvider', () => {
  const provider = new HtmlRedirectProvider();

  describe('getRedirectHtml', () => {
    it('returns html and a nonce for an https URL', () => {
      const result = provider.getRedirectHtml(new URL('https://example.com/landing'));

      expect(result.nonce).toBeTruthy();
      expect(typeof result.nonce).toBe('string');
      expect(result.html).toContain('https://example.com/landing');
    });

    it('returns html and a nonce for an http URL', () => {
      const result = provider.getRedirectHtml(new URL('http://example.com/landing'));

      expect(result.nonce).toBeTruthy();
      expect(result.html).toContain('http://example.com/landing');
    });

    it('embeds the generated nonce in the inline script tag', () => {
      const result = provider.getRedirectHtml(new URL('https://example.com/'));

      expect(result.html).toContain(`nonce="${result.nonce}"`);
    });

    it('generates a fresh nonce on each call', () => {
      const a = provider.getRedirectHtml(new URL('https://example.com/'));
      const b = provider.getRedirectHtml(new URL('https://example.com/'));

      expect(a.nonce).not.toBe(b.nonce);
    });

    it('safely escapes the URL inside the inline script (no break-out via quotes)', () => {
      // WHATWG URL parser percent-encodes most dangerous characters, but JSON.stringify
      // is what actually guarantees the value can't escape the JS string literal.
      const result = provider.getRedirectHtml(new URL('https://example.com/x"</script><script>alert(1)</script>'));
      // The raw double-quote must not appear unescaped between the script tags.
      expect(result.html).not.toContain('"</script>');
    });

    it('throws 400 with internal details when the URL is not http or https', () => {
      expect(() => provider.getRedirectHtml(new URL('ftp://example.com/'))).toThrowError(
        expect.objectContaining({
          statusCode: 400,
          internalDetails: { redirectUrl: 'must be a valid http or https URL' },
        }),
      );
    });

    it('rejects javascript: URLs', () => {
      expect(() => provider.getRedirectHtml(new URL('javascript:alert(1)'))).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('rejects file: URLs', () => {
      expect(() => provider.getRedirectHtml(new URL('file:///etc/passwd'))).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
  });
});
