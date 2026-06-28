---
'@maroonedsoftware/storage': patch
---

Value-import the injected SDK clients (`S3Client`, `Storage`) in the S3 and GCS providers so InjectKit's `design:paramtypes` metadata records the real token. Previously they were type-only imports, leaving the metadata as `Object`, so `container.bind(StorageProvider).to(S3StorageProvider)` could not resolve the client.
