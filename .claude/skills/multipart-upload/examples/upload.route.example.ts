import { httpError } from '@maroonedsoftware/errors';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { isMultipartFieldData, type FileHandler, type MultipartBody, type MultipartData } from '@maroonedsoftware/multipart';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const router = ServerKitRouter();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Reads a text field from the map parse() resolves with. A repeated field arrives as an array. */
const fieldValue = (fields: Map<string, MultipartData | MultipartData[]>, name: string): string | undefined => {
  const entry = fields.get(name);
  return entry && !Array.isArray(entry) && isMultipartFieldData(entry) ? entry.value : undefined;
};

/**
 * Up to five files, plus text fields.
 *
 * bodyParserMiddleware does not read a multipart body. ctx.parsedBody is a MultipartBody, and nothing
 * is consumed until parse() runs, which may happen only once per request. The file handler runs per
 * file as it arrives, and has to consume the stream or reject. parse() waits for every handler.
 */
router.post('/api/upload', requirePolicy(), bodyParserMiddleware(['multipart/form-data']), async ctx => {
  const body = ctx.parsedBody as MultipartBody;
  const saved: { fieldName: string; filename: string; mimeType: string; path: string }[] = [];

  const saveFile: FileHandler = async (fieldName, stream, filename, _encoding, mimeType) => {
    // Rejecting drains the rest of this file and fails parse() with this error.
    if (!ALLOWED_TYPES.includes(mimeType)) {
      throw httpError(415).withDetails({ [fieldName]: `Unsupported file type: ${mimeType}` });
    }

    // filename comes from the client. Never build a path from it, beyond its extension.
    const path = join(tmpdir(), `${randomUUID()}${extname(filename)}`);
    saved.push({ fieldName, filename, mimeType, path });

    await pipeline(stream, createWriteStream(path));

    // To use @maroonedsoftware/storage instead, hand the stream to the provider:
    // await ctx.container.get(StorageProvider).write(`uploads/${randomUUID()}`, stream, { contentType: mimeType });
  };

  let fields: Map<string, MultipartData | MultipartData[]>;
  try {
    // By default a body may carry 1 file of up to 20 MB. Going over a limit rejects with a 413.
    fields = await body.parse(saveFile, { files: 5, fileSize: 10 * 1024 * 1024 });
  } catch (error) {
    // A rejected parse can leave partial files behind, including one cut short by the size limit.
    await Promise.all(saved.map(file => rm(file.path, { force: true })));
    throw error;
  }

  if (saved.length === 0) {
    throw httpError(400).withDetails({ files: 'At least one file is required' });
  }

  ctx.logger.info('Upload completed', { requestId: ctx.requestId, fileCount: saved.length });

  ctx.status = 201;
  ctx.body = {
    files: saved.map(({ fieldName, filename, mimeType }) => ({ fieldName, filename, mimeType })),
    description: fieldValue(fields, 'description'),
  };
});

/**
 * A single image. The default of one file applies, so only the size limit is given here.
 */
router.post('/api/users/:id/avatar', requirePolicy(), bodyParserMiddleware(['multipart/form-data']), async ctx => {
  const userId = ctx.params.id;
  const body = ctx.parsedBody as MultipartBody;
  let received = false;

  await body.parse(
    async (fieldName, stream, _filename, _encoding, mimeType) => {
      if (fieldName !== 'avatar' || !mimeType.startsWith('image/')) {
        throw httpError(400).withDetails({ avatar: 'Expected an image in the avatar field' });
      }

      received = true;
      await pipeline(stream, createWriteStream(join(tmpdir(), `${randomUUID()}.avatar`)));
    },
    { fileSize: 2 * 1024 * 1024 },
  );

  if (!received) {
    throw httpError(400).withDetails({ avatar: 'Avatar file is required' });
  }

  ctx.body = { userId };
});

export default router;

// Testing with curl:
//
// curl -X POST http://localhost:3000/api/upload \
//   -H "Authorization: Bearer $TOKEN" \
//   -F "files=@/path/to/image1.jpg" \
//   -F "files=@/path/to/image2.jpg" \
//   -F "description=My photos"
//
// curl -X POST http://localhost:3000/api/users/123/avatar \
//   -H "Authorization: Bearer $TOKEN" \
//   -F "avatar=@/path/to/avatar.jpg"
