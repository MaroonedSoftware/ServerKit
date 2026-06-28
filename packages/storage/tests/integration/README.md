# Storage integration tests

These suites exercise the real `S3StorageProvider` and `GcsStorageProvider`
against emulated backends, covering the parts the unit tests can't: real
multipart uploads, actual `Range` reads, the true `HeadObject` / `getMetadata`
response shapes, pagination tokens, and (for S3) a presigned URL that is
actually fetched.

They are **opt-in** — gated on `STORAGE_INTEGRATION=1` and run from their own
config (`vitest.integration.config.ts`), so the default `pnpm test` never runs
them and the unit-test SDK mocks can't leak in. Without the env var (and the
backends), `pnpm test:integration` simply skips every case.

## 1. Start the emulators

```bash
# S3 (LocalStack) on :4566
docker run --rm -d -p 4566:4566 localstack/localstack

# GCS (fake-gcs-server) on :4443
docker run --rm -d -p 4443:4443 fsouza/fake-gcs-server -scheme http -public-host 127.0.0.1:4443
```

## 2. Run

```bash
STORAGE_INTEGRATION=1 pnpm test:integration
```

## Configuration

Defaults target the docker commands above; override via env vars if needed:

| Variable               | Default                  | Used by |
| ---------------------- | ------------------------ | ------- |
| `STORAGE_INTEGRATION`  | _(unset → all skipped)_  | both    |
| `S3_ENDPOINT`          | `http://127.0.0.1:4566`  | S3      |
| `S3_BUCKET`            | `serverkit-storage-test` | S3      |
| `AWS_REGION`           | `us-east-1`              | S3      |
| `GCS_ENDPOINT`         | `http://127.0.0.1:4443`  | GCS     |
| `GCS_BUCKET`           | `serverkit-storage-test` | GCS     |
| `GCS_PROJECT_ID`       | `test`                   | GCS     |

Each run namespaces its objects under a unique `it/<uuid>/` prefix, so the suites
are safe to run repeatedly against a persistent bucket.

> Signed URLs are verified end-to-end for S3 only. fake-gcs-server has no
> service-account key, so GCS v4 signing has nothing to sign with — that path is
> covered by the GCS unit tests against the mocked SDK.
