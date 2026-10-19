import { describe, it, expect } from 'vitest';
import { HttpError } from '@maroonedsoftware/errors';
import { SamlProviderRegistry, SamlProviderRegistryConfig, SamlProviderSource, type SamlProviderConfig } from '../src/saml.provider.js';

const provider = (name: string, certificate = 'cert-a'): SamlProviderConfig => ({
  name,
  spEntityId: 'https://sp.example.test/saml',
  acsUrl: new URL('https://sp.example.test/saml/acs'),
  idpEntityId: `https://idp.example.test/${name}`,
  idpSsoUrl: new URL(`https://idp.example.test/${name}/sso`),
  idpSigningCertificates: [certificate],
});

class MutableSource extends SamlProviderSource {
  providers: SamlProviderConfig[] = [];
  calls = 0;

  async list(): Promise<readonly SamlProviderConfig[]> {
    this.calls++;
    return this.providers;
  }
}

describe('SamlProviderRegistry', () => {
  it('looks a provider up by name from the static config', async () => {
    const registry = new SamlProviderRegistry(new SamlProviderRegistryConfig([provider('acme'), provider('globex')]));
    expect((await registry.getConfig('globex')).idpEntityId).toBe('https://idp.example.test/globex');
  });

  it('answers 404 for an unknown provider', async () => {
    const registry = new SamlProviderRegistry(new SamlProviderRegistryConfig([provider('acme')]));
    const error = await registry.getConfig('initech').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(404);
  });

  it('re-reads the source on every lookup, so added, changed and removed providers take effect at once', async () => {
    const source = new MutableSource();
    const registry = new SamlProviderRegistry(source);

    await expect(registry.getConfig('acme')).rejects.toBeInstanceOf(HttpError);

    source.providers = [provider('acme', 'cert-a')];
    expect((await registry.getConfig('acme')).idpSigningCertificates).toEqual(['cert-a']);

    source.providers = [provider('acme', 'cert-b')];
    expect((await registry.getConfig('acme')).idpSigningCertificates).toEqual(['cert-b']);

    source.providers = [];
    await expect(registry.getConfig('acme')).rejects.toBeInstanceOf(HttpError);
    expect(source.calls).toBe(4);
  });

  it('takes the first entry on a duplicate name and lists names once', async () => {
    const registry = new SamlProviderRegistry(
      new SamlProviderRegistryConfig([provider('acme', 'first'), provider('acme', 'second'), provider('globex')]),
    );
    expect((await registry.getConfig('acme')).idpSigningCertificates).toEqual(['first']);
    expect(await registry.listProviders()).toEqual(['acme', 'globex']);
  });

  it('defaults the static config to no providers', async () => {
    expect(await new SamlProviderRegistry(new SamlProviderRegistryConfig()).listProviders()).toEqual([]);
  });
});
