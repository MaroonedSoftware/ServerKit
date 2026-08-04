import { describe, it, expectTypeOf } from 'vitest';
import { AppConfig } from '../src/app.config.js';

interface TypedConfig {
  port: number;
  host?: string;
}

/**
 * `get`'s overloads carry most of the ergonomics of this package: a default
 * value has to collapse the `| undefined` a bare read would return, and a typed
 * config has to keep its declared value types. Neither shows up in a runtime
 * assertion, so they are pinned here.
 */
describe('AppConfig.get', () => {
  it('infers the default value type for a loosely-typed config', () => {
    const appConfig = new AppConfig({ GOOGLE_OIDC_ISSUER: undefined } as Record<string, unknown>);

    expectTypeOf(appConfig.get('GOOGLE_OIDC_ISSUER', 'https://accounts.google.com')).toEqualTypeOf<string>();
  });

  it('preserves the declared value type for a typed config', () => {
    const appConfig = new AppConfig<TypedConfig>({ port: 3000 });

    expectTypeOf(appConfig.get('port', 8080)).toEqualTypeOf<number>();
    expectTypeOf(appConfig.get('host', 'localhost')).toEqualTypeOf<string>();
  });

  it('admits undefined when no default is supplied', () => {
    const appConfig = new AppConfig<TypedConfig>({ port: 3000 });

    expectTypeOf(appConfig.get('host')).toExtend<string | undefined>();
  });
});
