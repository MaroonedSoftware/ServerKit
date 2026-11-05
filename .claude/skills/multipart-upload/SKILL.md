---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a Koa route handler for multipart/form-data file uploads using MultipartBody from @maroonedsoftware/multipart, streaming each file through a handler with limits. On @maroonedsoftware/fastify use /fastify-route instead, since this skill emits Koa-only code.
argument-hint: <path> [file]
---

# /multipart-upload - Generate Multipart Upload Route

Generate a Koa route handler for multipart/form-data file uploads with proper typing and validation.

**Koa only.** The generated code imports `ServerKitRouter` and `bodyParserMiddleware` from
`@maroonedsoftware/koa`, neither of which exists in `@maroonedsoftware/fastify`. In a Fastify app
run `/fastify-route post <path> <file> multipart/form-data` instead: the route declares
`config: { body: ['multipart/form-data'] }` and reads the `MultipartBody` from `request.body`.
The `parse` call below is the same on both. Check which adapter the app installed before generating.

## Arguments

1. `path` (required): Route path (e.g., `/api/upload`, `/api/users/:id/avatar`)
2. `file` (optional): Output file path (defaults to `src/routes/upload.routes.ts`)

## What This Skill Does

1. Creates or appends to a route file with:
   - POST route with multipart body parser middleware
   - `MultipartBody` typing, imported from `@maroonedsoftware/multipart`
   - A file handler that streams each file as it arrives
   - Limits on file count and size, and a mime type check
   - Text field access from the map `parse` resolves with
   - Error handling for invalid uploads
   - Usage comments

## Examples

Generate simple upload route:
```
/multipart-upload /api/upload
```

Generate avatar upload route:
```
/multipart-upload /api/users/:id/avatar src/routes/users.routes.ts
```

## Implementation Pattern

The generated route will follow this pattern:

```typescript
import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { isMultipartFieldData, type MultipartBody } from '@maroonedsoftware/multipart';
import { httpError } from '@maroonedsoftware/errors';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const router = ServerKitRouter();

router.post('{path}', bodyParserMiddleware(['multipart/form-data']), async ctx => {
  ctx.logger.info('Handling file upload', { requestId: ctx.requestId });

  // A lazy wrapper around the request. Nothing is read until parse() runs.
  const body = ctx.parsedBody as MultipartBody;
  const uploadedFiles: { fieldName: string; filename: string; mimeType: string }[] = [];

  const fields = await body.parse(
    async (fieldName, stream, filename, _encoding, mimeType) => {
      // Rejecting drains the rest of this file and fails parse() with this error.
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
      if (!allowedTypes.includes(mimeType)) {
        throw httpError(415).withDetails({ [fieldName]: `Invalid file type: ${mimeType}` });
      }

      // TODO: Store the file. The handler must consume the stream.
      // filename comes from the client, so do not build a path from it.
      await pipeline(stream, createWriteStream(join(tmpdir(), randomUUID())));

      uploadedFiles.push({ fieldName, filename, mimeType });
    },
    // Defaults are 1 file of up to 20 MB. Going over a limit rejects with a 413.
    { files: 5, fileSize: 10 * 1024 * 1024 },
  );

  if (uploadedFiles.length === 0) {
    throw httpError(400).withDetails({ files: 'At least one file is required' });
  }

  // Text fields are in the map. A repeated field name arrives as an array.
  const description = fields.get('description');

  ctx.body = {
    message: 'Files uploaded successfully',
    files: uploadedFiles,
    description: description && !Array.isArray(description) && isMultipartFieldData(description) ? description.value : undefined,
  };
});

export default router;
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract path and file (optional)
   - If no file specified, default to `src/routes/upload.routes.ts`

2. **Check if file exists:**
   - If file exists, read it and append the new route
   - If file doesn't exist, create it with full boilerplate

3. **Generate route code:**
   - Use POST method (uploads are always POST)
   - Create the router with `ServerKitRouter()`, never `new`
   - Add `bodyParserMiddleware` with 'multipart/form-data'
   - Cast `ctx.parsedBody` to `MultipartBody` (the parsed body, not the response `ctx.body`)
   - Include proper imports

4. **Add file handling code:**
   - There is no `body.files` or `body.fields`. Call `body.parse(fileHandler, limits?)`, once per request: a second call throws
   - The handler receives `(fieldName, stream, filename, encoding, mimeType)` and returns a promise
   - It must consume `stream` or reject. `parse` resolves only after every handler has settled
   - There is no file size property. Enforce size with the `fileSize` limit
   - Check the mime type inside the handler, and treat `filename` as untrusted

5. **Add field handling code:**
   - `parse` resolves with `Map<string, MultipartData | MultipartData[]>`, holding fields and files
   - Narrow a value with `Array.isArray`, then `isMultipartFieldData`, and read `.value`
   - A file's entry there has a consumed stream, so use what the handler recorded instead

6. **Set the limits:**
   - Defaults are `files: 1`, `fileSize: MAX_FILE_SIZE` (20 MB), `fields: MAX_FIELDS` (1000), and `parts: MAX_PARTS` (1010). A route taking several files has to pass `files`
   - Going over a limit rejects `parse` with a 413, whose reason is in the internal details
   - A client that aborts mid-upload rejects it with a 400
   - On rejection the handler may have stored part of a file. Clean it up, as `examples/upload.route.example.ts` does

7. **Include comments:**
   - Explain that `MultipartBody` is lazy and `parse` runs once
   - Show that `stream` is a Node.js `Readable`
   - Mention common storage patterns: local disk, or `StorageProvider.write(key, stream, { contentType })` from `@maroonedsoftware/storage` for disk, S3, and GCS

8. **Handle imports:**
   - Import `ServerKitRouter` and `bodyParserMiddleware` from `@maroonedsoftware/koa`
   - Import `MultipartBody` and the type guards from `@maroonedsoftware/multipart`, which the app must add as a direct dependency. The adapter does not re-export them
   - Import `httpError` from `@maroonedsoftware/errors`
   - Check for duplicate imports if file exists

9. **Write or update file:**
   - If new file, write complete file with imports, router, route, and export
   - If existing file, append route handler before export statement

10. **Confirm to user:**
    - Show the file path where route was created/updated
    - Show the upload path
    - Mention multipart parsing is enabled
    - Provide example curl command for testing
