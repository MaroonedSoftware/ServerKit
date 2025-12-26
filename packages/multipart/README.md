# @maroonedsoftware/multipart

A robust multipart form-data and multipart/related parser for Node.js HTTP servers. Built on top of [@fastify/busboy](https://github.com/fastify/busboy) with a promise-based API and sensible defaults.

## Installation

```bash
pnpm add @maroonedsoftware/multipart
```

## Features

- **Promise-based API** – Clean async/await interface for parsing multipart requests
- **Configurable limits** – Protect against resource exhaustion with file size, count, and field limits
- **Stream-based file handling** – Process files efficiently without loading entire files into memory
- **Type-safe** – Full TypeScript support with comprehensive type definitions
- **Automatic cleanup** – Properly removes event listeners to prevent memory leaks

## Quick Start

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { MultipartBody, isMultipartFieldData } from '@maroonedsoftware/multipart';

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
    const multipart = new MultipartBody(req);

    const fields = await multipart.parse(async (fieldname, stream, filename) => {
      // Save uploaded file to disk
      await pipeline(stream, createWriteStream(`./uploads/${filename}`));
    });

    // Access form fields
    const description = fields.get('description');
    if (description && isMultipartFieldData(description)) {
      console.log('Description:', description.value);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }
});

server.listen(3000);
```

## API Reference

### `MultipartBody`

The main class for parsing multipart/form-data requests.

#### Constructor

```typescript
new MultipartBody(req: IncomingMessage, limits?: MultipartLimits)
```

| Parameter | Type              | Description                         |
| --------- | ----------------- | ----------------------------------- |
| `req`     | `IncomingMessage` | The incoming HTTP request           |
| `limits`  | `MultipartLimits` | Optional default limits for parsing |

**Default limits:**

- `files`: 1
- `fileSize`: 20 MB

#### `parse(fileHandler, limits?)`

Parses the multipart request body.

```typescript
parse(
  fileHandler: FileHandler,
  limits?: MultipartLimits
): Promise<Map<string, MultipartData | MultipartData[]>>
```

| Parameter     | Type              | Description                           |
| ------------- | ----------------- | ------------------------------------- |
| `fileHandler` | `FileHandler`     | Callback invoked for each file upload |
| `limits`      | `MultipartLimits` | Optional per-request limit overrides  |

**Returns:** A `Map` where keys are field names and values are either a single `MultipartData` object or an array if multiple values were submitted.

### `FileHandler`

Callback type for handling file uploads:

```typescript
type FileHandler = (fieldname: string, stream: Readable, filename: string, encoding: string, mimeType: string) => Promise<void>;
```

### `MultipartLimits`

Configuration options for limiting request sizes:

| Option          | Type     | Default  | Description                      |
| --------------- | -------- | -------- | -------------------------------- |
| `fieldNameSize` | `number` | 100      | Max field name size in bytes     |
| `fieldSize`     | `number` | 1 MB     | Max field value size in bytes    |
| `fields`        | `number` | Infinity | Max number of non-file fields    |
| `fileSize`      | `number` | Infinity | Max file size in bytes           |
| `files`         | `number` | Infinity | Max number of file fields        |
| `parts`         | `number` | Infinity | Max total parts (fields + files) |
| `headerPairs`   | `number` | 2000     | Max header key-value pairs       |
| `headerSize`    | `number` | 81920    | Max header part size in bytes    |

### Type Guards

#### `isMultipartFieldData(data)`

Type guard to check if parsed data is a form field.

```typescript
if (isMultipartFieldData(data)) {
  console.log(data.value); // TypeScript knows this is FieldData
}
```

#### `isMultipartFileData(data)`

Type guard to check if parsed data is a file.

```typescript
if (isMultipartFileData(data)) {
  data.stream.pipe(destination); // TypeScript knows this is FileData
}
```

### Data Types

#### `FieldData`

```typescript
type FieldData = {
  value: string;
  nameTruncated: boolean;
  valueTruncated: boolean;
  encoding: string;
  mimeType: string;
};
```

#### `FileData`

```typescript
type FileData = {
  stream: Readable;
  filename: string;
  encoding: string;
  mimeType: string;
};
```

## Advanced Usage

### Custom File Size Limits

```typescript
// Set default limits in constructor
const multipart = new MultipartBody(req, {
  files: 5,
  fileSize: 50 * 1024 * 1024, // 50 MB
});

// Override per-request
const fields = await multipart.parse(fileHandler, {
  fileSize: 100 * 1024 * 1024, // 100 MB for this request only
});
```

### Handling Multiple Files

```typescript
const multipart = new MultipartBody(req, { files: 10 });

const uploadedFiles: string[] = [];

const fields = await multipart.parse(async (fieldname, stream, filename) => {
  const path = `./uploads/${Date.now()}-${filename}`;
  await pipeline(stream, createWriteStream(path));
  uploadedFiles.push(path);
});

console.log('Uploaded files:', uploadedFiles);
```

### Error Handling

The parser throws HTTP 413 errors when limits are exceeded:

```typescript
import { MultipartBody } from '@maroonedsoftware/multipart';

try {
  const fields = await multipart.parse(fileHandler);
} catch (error) {
  if (error.statusCode === 413) {
    // Handle limit exceeded
    console.error('Upload too large:', error.internalDetails?.reason);
  }
  throw error;
}
```

## Example

```typescript
type ParsedMultipartBody = {
  fields: Map<string, MultipartData>;
  file: {
    filename: string;
    stream: Readable;
    encoding: string;
    mimeType: string;
  };
};

export class Service {
  private async parseMultipartBody(multipartReq: MultipartBody) {
    let file: ParsedMultipartBody['file'] | undefined;
    const fields = await multipartReq.parse(async (fieldname, stream, fileFieldName, encoding, mimeType) => {
      if (fieldname === 'file') {
        file = { stream, filename: fileFieldName, encoding, mimeType };
      }
    });
    return { fields, file } as ParsedMultipartBody;
  }

  async handle(body: MultipartBody): Promise<void> {
    const parsedBody = await this.parseMultipartBody(body);
    filename = parsedBody.file?.filename ?? 'missing name';
    content = parsedBody.file?.stream;

    // use content
  }
}
```

## License

MIT
