import { describe, it, expectTypeOf } from 'vitest';
import { AppConfig } from '../src/app.config.js';

interface TypedConfig {
  port: number;
  host?: string;
}

/**
 * Exact type equality.
 *
 * `expectTypeOf(value)` takes its subject in a value position, and inference to
 * its unconstrained type parameter widens a literal to its base primitive. It
 * therefore reports `''` as `string` and cannot pin the literal-vs-primitive
 * distinction that `get`'s default-value overload turns on. These assertions
 * read the type through `typeof` instead, which never widens.
 */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compiles only when the supplied type argument is `true`. */
const assertType = <_Pass extends true>(): void => {};

/**
 * `get`'s overloads carry most of the ergonomics of this package: a default
 * value has to collapse the `| undefined` a bare read would return, and a typed
 * config has to keep its declared value types. Neither shows up in a runtime
 * assertion, so they are pinned here.
 */
describe('AppConfig.get', () => {
  it('infers the default value type for a loosely-typed config', () => {
    const appConfig = new AppConfig({ GOOGLE_OIDC_ISSUER: undefined } as Record<string, unknown>);
    const issuer = appConfig.get('GOOGLE_OIDC_ISSUER', 'https://accounts.google.com');

    assertType<Exact<typeof issuer, string>>();
  });

  it('widens a literal default to its base primitive for a loosely-typed config', () => {
    const appConfig = new AppConfig({} as Record<string, unknown>);
    const secret = appConfig.get('AUTHENTICATION_SESSION_JWT_PRIVATE_KEY', '');
    const port = appConfig.get('PORT', 3000);
    const debug = appConfig.get('DEBUG', false);

    // The empty string is the case that motivated this: without widening the
    // result is `''`, and every later assignment of a real key fails.
    assertType<Exact<typeof secret, string>>();
    assertType<Exact<typeof port, number>>();
    assertType<Exact<typeof debug, boolean>>();
  });

  it('leaves a non-primitive default unwidened', () => {
    const appConfig = new AppConfig({} as Record<string, unknown>);
    const retries = appConfig.get('RETRY', { max: 3 });

    assertType<Exact<typeof retries, { max: number }>>();
  });

  it('preserves the declared value type for a typed config', () => {
    const appConfig = new AppConfig<TypedConfig>({ port: 3000 });

    expectTypeOf(appConfig.get('port', 8080)).toEqualTypeOf<number>();
    expectTypeOf(appConfig.get('host', 'localhost')).toEqualTypeOf<string>();
  });

  it('does not widen the declared value type of a typed config', () => {
    const appConfig = new AppConfig<{ mode: 'a' | 'b' }>({ mode: 'a' });

    // Widening applies only to the loosely-typed branch; here the declared
    // union supplies the precision and must survive.
    expectTypeOf(appConfig.get('mode', 'a')).toExtend<'a' | 'b'>();
  });

  it('admits undefined when no default is supplied', () => {
    const appConfig = new AppConfig<TypedConfig>({ port: 3000 });

    expectTypeOf(appConfig.get('host')).toExtend<string | undefined>();
  });
});
