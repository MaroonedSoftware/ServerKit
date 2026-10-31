import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppConfigResolverEnv } from '../src/resolvers/app.config.resolver.env.js';

const resolved = async (reference: string): Promise<unknown> => {
  const owner: Record<string, unknown> = { key: reference };
  await new AppConfigResolverEnv().resolve(reference, { owner, propertyPath: 'key' } as never);
  return owner.key;
};

describe('AppConfigResolverEnv', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.VALUE = '';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it.each(['p$&ss', '$$', "a$'b", 'a$`b'])('splices %s in exactly', async value => {
    process.env.VALUE = value;
    expect(await resolved('${env:VALUE}')).toBe(value);
    expect(await resolved('x-${env:VALUE}-y')).toBe(`x-${value}-y`);
  });

  it.each(['1.50', '007', '12345678901234567890', '1e3'])('keeps %s as text, because a number would change it', async value => {
    process.env.VALUE = value;
    expect(await resolved('${env:VALUE}')).toBe(value);
  });

  it('still parses what round-trips', async () => {
    process.env.VALUE = '3000';
    expect(await resolved('${env:VALUE}')).toBe(3000);
    process.env.VALUE = 'true';
    expect(await resolved('${env:VALUE}')).toBe(true);
    process.env.VALUE = '{"a":1}';
    expect(await resolved('${env:VALUE}')).toEqual({ a: 1 });
  });

  it('composes references and fills an unset one with nothing', async () => {
    process.env.HOST_PART = 'db';
    process.env.PORT_PART = '5432';
    delete process.env.VALUE;
    expect(await resolved('${env:HOST_PART}:${env:PORT_PART}${env:VALUE}')).toBe('db:5432');
  });
});
