---
'@maroonedsoftware/zod': minor
---

Export `zodErrorDetails`, the `ZodError` to field-map formatting `parseAndValidate` already applied
internally. A caller that has run a schema itself can now produce the identical `details` body,
which is what a synchronous validator needs: `@maroonedsoftware/fastify/zod` builds Fastify's
validator compiler on it, so a schema failure there renders exactly as one from `parseAndValidate`.
