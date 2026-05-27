import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Builds a minimal HTML landing page that defers a navigation to `window.onload`,
 * paired with a freshly generated CSP nonce.
 *
 * The two intended uses are:
 *
 * 1. **Email magic link flow.** After the server verifies the link, return this
 *    HTML instead of an HTTP `Location` redirect. Mail-client URL pre-fetchers
 *    (Outlook Safe Links, Gmail/Apple Mail link scanners, corporate proxies)
 *    follow `Location` headers eagerly and would otherwise burn the one-time
 *    token before the human ever clicks. Deferring navigation to a client-side
 *    `window.onload` script defeats the pre-fetchers without blocking the real
 *    user.
 *
 * 2. **OIDC `completeAuthorization` redirect.** After token exchange the server
 *    needs to land the browser somewhere (the post-sign-in app page, the
 *    `redirectAfter` URL persisted in the authorization state, etc.). Using
 *    this provider instead of a `Location` redirect avoids leaking the
 *    destination to any link-prefetching crawler that might follow the IdP's
 *    callback URL — and ensures the browser actually runs the post-load
 *    scripts on your app page rather than just receiving a body-less 302.
 *
 * In both cases the inline script tag is gated by a per-response CSP nonce
 * returned alongside the HTML — the caller must echo that nonce in a
 * `Content-Security-Policy: script-src 'nonce-<nonce>'` header for the
 * navigation to fire.
 */
@Injectable()
export class HtmlRedirectProvider {
  /**
   * Build a minimal HTML page that redirects the browser to `redirectUrl` from a
   * client-side script tag, paired with a freshly generated CSP nonce.
   *
   * The caller is responsible for serving the returned `nonce` in a
   * `Content-Security-Policy: script-src 'nonce-<nonce>'` response header so the
   * inline script is allowed to execute.
   *
   * @param redirectUrl - The destination to navigate to. Must use the `http:` or
   *   `https:` scheme — other schemes (e.g. `javascript:`, `file:`, `data:`) are
   *   rejected to avoid script-injection / open-redirect abuse.
   * @returns `{ html, nonce }` — the HTML body to send and the base64 nonce that
   *   must be echoed in the CSP header.
   * @throws HTTP 400 (with `internalDetails.redirectUrl`) when `redirectUrl` is
   *   not an `http:` or `https:` URL.
   */
  getRedirectHtml(redirectUrl: URL) {
    if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
      throw httpError(400).withInternalDetails({ redirectUrl: 'must be a valid http or https URL' });
    }
    const nonce = crypto.randomBytes(16).toString('base64');
    // `JSON.stringify` produces a safely-escaped JS string literal (quotes,
    // backslashes, and control chars are encoded), so the URL cannot escape
    // out of the assignment regardless of what the WHATWG URL parser leaves
    // behind in the fragment/path.
    const safeUrl = JSON.stringify(redirectUrl.toString());
    const html = `<!DOCTYPE html><html><head lang="en"><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /></head><body><script nonce="${nonce}" type="text/javascript">window.onload = async function() {window.location.href = ${safeUrl};}</script></body></html>`;
    return { html, nonce };
  }
}
