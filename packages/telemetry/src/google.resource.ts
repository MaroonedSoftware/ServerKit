import { randomUUID } from 'node:crypto';
import { resourceFromAttributes, Resource } from '@opentelemetry/resources';

/** The metadata server every Google Cloud runtime answers on. */
const METADATA_URL = 'http://metadata.google.internal/computeMetadata/v1';
const DEFAULT_METADATA_TIMEOUT_MS = 1_000;

/**
 * How {@link googleCloudResource} is built.
 */
export interface GoogleCloudResourceOptions {
  /** The project the telemetry belongs to. Defaults to `GOOGLE_CLOUD_PROJECT`, then the metadata server. */
  projectId?: string;
  /**
   * The region the telemetry is filed under (`cloud.region`, which Google requires and refuses as
   * `global`). Defaults to `GOOGLE_CLOUD_REGION`, then the metadata server. Off Google Cloud there is
   * no metadata server, so set one of the first two there.
   */
  region?: string;
  /** The service's name. Defaults to `OTEL_SERVICE_NAME`, then Cloud Run's `K_SERVICE`. */
  serviceName?: string;
  /** Ask the metadata server for what env does not say. Defaults to true. */
  metadata?: boolean;
  /** How long a metadata lookup may take. Defaults to one second. */
  metadataTimeoutMs?: number;
  /** The environment to read. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The `fetch` metadata lookups use. Defaults to the global one. */
  fetch?: typeof fetch;
}

/**
 * What Google's Telemetry API needs to know about the process sending: `gcp.project_id` (it refuses
 * a batch without one), a location (`cloud.region`; metrics without one are refused as an
 * unrecognized location) and an `instance` (`service.instance.id`).
 *
 * The instance is the Cloud Run or Compute instance id when the metadata server answers, else a
 * random id for this process. Either way it is unique per process, which cumulative series need:
 * two processes reporting under one instance would write into the same series.
 *
 * Built at once: what comes from the metadata server is an asynchronous attribute, settled before
 * the first export (the SDK's processors and this package's bridges wait for it). Off Google Cloud
 * the lookups fail fast and the resource keeps what the environment gave it.
 *
 * @param options - Overrides for the project, service name and metadata lookups.
 */
export const googleCloudResource = (options: GoogleCloudResourceOptions = {}): Resource => {
  const env = options.env ?? process.env;
  const lookup = metadataLookup(options);
  const projectId = options.projectId ?? env['GOOGLE_CLOUD_PROJECT']?.trim();
  const region = options.region ?? env['GOOGLE_CLOUD_REGION']?.trim();
  const serviceName = options.serviceName ?? (env['OTEL_SERVICE_NAME']?.trim() || env['K_SERVICE']?.trim() || undefined);

  return resourceFromAttributes({
    'cloud.provider': 'gcp',
    ...(env['K_SERVICE'] ? { 'cloud.platform': 'gcp_cloud_run' } : {}),
    ...(serviceName ? { 'service.name': serviceName } : {}),
    'gcp.project_id': projectId || lookup('project/project-id'),
    // `projects/<number>/regions/<region>` on Cloud Run.
    'cloud.region': region || lookup('instance/region').then(found => found?.split('/').at(-1)),
    'service.instance.id': lookup('instance/id').then(id => id ?? randomUUID()),
  });
};

/** Reads one metadata value, or undefined when the server does not answer in time. */
const metadataLookup = (options: GoogleCloudResourceOptions) => {
  const timeout = options.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
  const get = options.fetch ?? fetch;
  return async (path: string): Promise<string | undefined> => {
    if (options.metadata === false) {
      return undefined;
    }
    try {
      const response = await get(`${METADATA_URL}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) {
        return undefined;
      }
      return (await response.text()).trim() || undefined;
    } catch {
      return undefined;
    }
  };
};
