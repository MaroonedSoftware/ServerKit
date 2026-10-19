---
'@maroonedsoftware/telemetry': minor
---

Add `@maroonedsoftware/telemetry/google`, for exporting OTLP straight to Google Cloud's Telemetry API (Cloud Trace and Cloud Monitoring) with no collector. `googleOtlpHeaders()` gives an exporter Application Default Credentials headers, fresh for every export. `googleCloudResource()` describes the process the way Google needs: `gcp.project_id`, `cloud.region` and a `service.instance.id` unique to the process, read from the environment and the metadata server as asynchronous attributes. Also exports the endpoint URLs and `isGoogleTelemetryUrl`. `google-auth-library` is an optional peer. `OtlpMetricsBridge` and `OtlpSpanBridge` now wait for a resource's asynchronous attributes before exporting.
