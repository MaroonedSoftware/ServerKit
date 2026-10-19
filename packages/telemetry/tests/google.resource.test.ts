import { describe, it, expect, vi } from 'vitest';
import { googleCloudResource } from '../src/google.resource.js';

const metadataServer = (values: Record<string, string>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Metadata-Flavor')).toBe('Google');
    const path = String(url).replace('http://metadata.google.internal/computeMetadata/v1/', '');
    return path in values ? new Response(values[path]) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;

const settled = async (options: Parameters<typeof googleCloudResource>[0]) => {
  const resource = googleCloudResource(options);
  await resource.waitForAsyncAttributes?.();
  return resource.attributes;
};

describe('googleCloudResource', () => {
  it('describes a Cloud Run instance from its environment and the metadata server', async () => {
    const attributes = await settled({
      env: { K_SERVICE: 'ats-api', GOOGLE_CLOUD_PROJECT: 'toku-ats' },
      fetch: metadataServer({ 'instance/region': 'projects/123/regions/us-central1', 'instance/id': '00abc', 'project/project-id': 'ignored' }),
    });

    expect(attributes).toEqual({
      'cloud.provider': 'gcp',
      'cloud.platform': 'gcp_cloud_run',
      'service.name': 'ats-api',
      'gcp.project_id': 'toku-ats',
      'cloud.region': 'us-central1',
      'service.instance.id': '00abc',
    });
  });

  it('prefers options, then OTEL_SERVICE_NAME, and reads the project from the metadata server when env has none', async () => {
    const fromOptions = await settled({ projectId: 'opt', serviceName: 'svc', env: { OTEL_SERVICE_NAME: 'env', K_SERVICE: 'run' }, metadata: false });
    expect(fromOptions).toMatchObject({ 'gcp.project_id': 'opt', 'service.name': 'svc' });

    const fromEnv = await settled({
      env: { OTEL_SERVICE_NAME: 'env', K_SERVICE: 'run' },
      fetch: metadataServer({ 'project/project-id': 'from-metadata' }),
    });
    expect(fromEnv).toMatchObject({ 'gcp.project_id': 'from-metadata', 'service.name': 'env' });
  });

  it('takes the region from the option or GOOGLE_CLOUD_REGION before the metadata server', async () => {
    const metadata = metadataServer({ 'instance/region': 'projects/1/regions/europe-west1' });
    expect((await settled({ region: 'us-east1', env: { GOOGLE_CLOUD_REGION: 'us-west1' }, fetch: metadata }))['cloud.region']).toBe('us-east1');
    expect((await settled({ env: { GOOGLE_CLOUD_REGION: 'us-west1' }, fetch: metadata }))['cloud.region']).toBe('us-west1');
    expect((await settled({ env: {}, fetch: metadata }))['cloud.region']).toBe('europe-west1');
  });

  it('off Google Cloud, keeps what env says and gives the process a random instance id', async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const first = await settled({ env: {}, fetch: unreachable });
    const second = await settled({ env: {}, fetch: unreachable });

    expect(first['gcp.project_id']).toBeUndefined();
    expect(first['cloud.region']).toBeUndefined();
    expect(first['service.instance.id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(second['service.instance.id']).not.toBe(first['service.instance.id']);
  });
});
