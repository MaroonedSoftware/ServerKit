---
'@maroonedsoftware/telemetry': patch
---

`googleCloudResource()` takes the region from a `region` option or `GOOGLE_CLOUD_REGION` before asking the metadata server. Google refuses metrics without a real `cloud.region` (and refuses `global`), and off Google Cloud there is no metadata server to ask, so a process exporting from a laptop or another cloud had every metric refused as an unrecognized location.
