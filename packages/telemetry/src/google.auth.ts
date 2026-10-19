import { GoogleAuth } from 'google-auth-library';

/** Google Cloud's Telemetry API, which takes OTLP over HTTP for Cloud Trace and Cloud Monitoring. */
export const GOOGLE_TELEMETRY_URL = 'https://telemetry.googleapis.com';

/** Where an OTLP trace exporter sends to Google. */
export const googleTracesUrl = `${GOOGLE_TELEMETRY_URL}/v1/traces`;

/** Where an OTLP metric exporter sends to Google. */
export const googleMetricsUrl = `${GOOGLE_TELEMETRY_URL}/v1/metrics`;

/**
 * Whether `url` is Google's Telemetry API, so an app configured by the standard
 * `OTEL_EXPORTER_OTLP_ENDPOINT` can tell when to add Google's auth headers.
 *
 * @param url - An OTLP endpoint, or undefined.
 */
export const isGoogleTelemetryUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  try {
    return new URL(url).hostname === new URL(GOOGLE_TELEMETRY_URL).hostname;
  } catch {
    return false;
  }
};

/** Headers an OTLP exporter asks for before each export. */
export type OtlpHeadersFactory = () => Promise<Record<string, string>>;

/**
 * Auth headers for exporting to Google's Telemetry API as the identity the process runs as
 * (Application Default Credentials: a Cloud Run service account, or `gcloud auth
 * application-default login` on a laptop).
 *
 * Pass the result as an OTLP exporter's `headers`. Tokens last an hour, so the headers are a
 * function the exporter calls for every export and the auth library caches. Nothing is fetched
 * until the first export, so a process without credentials still starts, and its exports fail.
 *
 * The identity needs `roles/telemetry.writer` on the project, and
 * `roles/serviceusage.serviceUsageConsumer` on the quota project.
 *
 * @param auth - The auth client. Defaults to ADC with the `cloud-platform` scope.
 */
export const googleOtlpHeaders = (
  auth: GoogleAuth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' }),
): OtlpHeadersFactory => {
  return async () => Object.fromEntries((await (await auth.getClient()).getRequestHeaders()).entries());
};
