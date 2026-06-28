---
'@maroonedsoftware/storage': minor
---

Move the S3 and GCS backends behind subpath exports so the core entry no longer statically imports the optional cloud SDKs. Previously importing anything from `@maroonedsoftware/storage` eagerly loaded `@aws-sdk/*`, breaking disk-only consumers that hadn't installed it.

Breaking: import the cloud providers from their subpaths — `@maroonedsoftware/storage/s3` (`S3StorageProvider`, `S3StorageProviderOptions`) and `@maroonedsoftware/storage/gcs` (`GcsStorageProvider`, `GcsStorageProviderOptions`). The core entry (`StorageProvider`, the error types, `DiskStorageProvider`) is unchanged and pulls in no SDK.
