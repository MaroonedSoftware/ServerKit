import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The packaging invariant no unit test can reach.
 *
 * `authenticationMiddleware` resolves the scheme handler with
 * `ctx.container.get(AuthenticationSchemeHandler)`, so the class object it passes has to be the
 * SAME object the consuming app registered. A direct dependency cannot promise that: `workspace:*`
 * publishes as an exact pin, so an app on any other version of `@maroonedsoftware/authentication`
 * gets a second copy installed under this package, resolves a different class of the same name,
 * and every request fails with `Registration for AuthenticationSchemeHandler not found` — at
 * runtime, on every route, with nothing wrong at the type level.
 *
 * That is not hypothetical: it is what koa@3.2.4 (pinning authentication@4.32.0) did to an app on
 * ^5.0.0. A peer range is the only declaration that makes the copy shared, so it is asserted here
 * rather than left to whoever next edits the manifest.
 */
describe('@maroonedsoftware/koa packaging', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };

  it('takes authentication as a peer rather than a dependency', () => {
    expect(manifest.dependencies?.['@maroonedsoftware/authentication']).toBeUndefined();
    expect(manifest.peerDependencies?.['@maroonedsoftware/authentication']).toBeDefined();
  });

  it('asks for a RANGE of authentication, not one exact version', () => {
    // `workspace:*` publishes as an exact pin, which for a peer means every patch release of
    // authentication is a peer conflict and an invitation to install a second copy — the bug this
    // is meant to close, reopened. `workspace:^` publishes as `^<version>`.
    expect(manifest.peerDependencies?.['@maroonedsoftware/authentication']).toBe('workspace:^');
  });

  it('keeps authentication a REQUIRED peer', () => {
    // Unlike `serverfeed`, whose adapter is behind the `./serverfeed` subpath, authentication is
    // imported from the root barrel — `serverkit.context.ts`, `authentication.middleware.ts` and
    // `require.policy.middleware.ts` — so it loads on every import of this package. Marking it
    // optional would only move the failure from install time to first request.
    expect(manifest.peerDependenciesMeta?.['@maroonedsoftware/authentication']?.optional).not.toBe(true);
  });
});
