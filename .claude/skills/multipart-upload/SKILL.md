---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a route handler for multipart/form-data file uploads with proper typing
argument-hint: <path> [file]
---

# /multipart-upload - Generate Multipart Upload Route

Generate a route handler for multipart/form-data file uploads with proper typing and validation.

## Arguments

1. `path` (required): Route path (e.g., `/api/upload`, `/api/users/:id/avatar`)
2. `file` (optional): Output file path (defaults to `src/routes/upload.routes.ts`)

## What This Skill Does

1. Creates or appends to a route file with:
   - POST route with multipart body parser middleware
   - Proper MultipartBody typing
   - File and field access examples
   - File validation pattern (size, mime type)
   - Stream handling for large files
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
import { ServerKitRouter, bodyParserMiddleware, MultipartBody } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = new ServerKitRouter();

router.post('{path}', bodyParserMiddleware(['multipart/form-data']), async ctx => {
  ctx.logger.info('Handling file upload', { requestId: ctx.requestId });

  const body = ctx.body as MultipartBody;

  // Validate files
  if (body.files.length === 0) {
    throw httpError(400).withDetails({ files: 'At least one file is required' });
  }

  // Process files
  const uploadedFiles = [];

  for (const file of body.files) {
    ctx.logger.info('Processing file', {
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size
    });

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimeType)) {
      throw httpError(400).withDetails({
        [file.fieldName]: `Invalid file type: ${file.mimeType}`
      });
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw httpError(400).withDetails({
        [file.fieldName]: `File too large: ${file.size} bytes (max ${maxSize})`
      });
    }

    // TODO: Process file stream
    // const storageService = ctx.container.get(StorageService);
    // const url = await storageService.upload(file.stream, file.filename);

    uploadedFiles.push({
      fieldName: file.fieldName,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size
      // url: url
    });
  }

  // Access form fields
  const description = body.fields.get('description');

  ctx.body = {
    message: 'Files uploaded successfully',
    files: uploadedFiles,
    description
  };
});

export default router;
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract path and file (optional)
   - If no file specified, derive from path: `src/routes/upload.routes.ts`

2. **Check if file exists:**
   - If file exists, read it and append the new route
   - If file doesn't exist, create it with full boilerplate

3. **Generate route code:**
   - Use POST method (uploads are always POST)
   - Add bodyParserMiddleware with 'multipart/form-data'
   - Cast ctx.body to MultipartBody type
   - Include proper imports

4. **Add file handling code:**
   - Loop through body.files array
   - Access file properties: fieldName, filename, mimeType, size, stream
   - Add validation examples (mime type, size)
   - Add TODO for actual file storage
   - Log file processing with logger

5. **Add field handling code:**
   - Show how to access form fields with body.fields.get()
   - Include example field in response

6. **Add validation:**
   - Check if files array is empty
   - Validate mime types against allowed list
   - Validate file size against maximum
   - Throw httpError(400) with details for validation failures

7. **Include comments:**
   - Explain MultipartBody structure
   - Show that file.stream is a Readable stream
   - Explain that files must be consumed or the request will hang
   - Mention common storage patterns (local disk, S3, GCS)

8. **Handle imports:**
   - Import ServerKitRouter, bodyParserMiddleware, MultipartBody from '@maroonedsoftware/koa'
   - Import httpError from '@maroonedsoftware/errors'
   - Check for duplicate imports if file exists

9. **Write or update file:**
   - If new file, write complete file with imports, router, route, and export
   - If existing file, append route handler before export statement

10. **Confirm to user:**
    - Show the file path where route was created/updated
    - Show the upload path
    - Mention multipart parsing is enabled
    - Provide example curl command for testing
