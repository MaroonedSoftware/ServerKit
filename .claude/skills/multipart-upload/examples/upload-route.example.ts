import {
  ServerKitRouter,
  bodyParserMiddleware,
  MultipartBody
} from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';

const router = new ServerKitRouter();

/**
 * Upload files
 *
 * Accepts multipart/form-data with one or more files.
 * Validates file types and sizes.
 */
router.post(
  '/api/upload',
  bodyParserMiddleware(['multipart/form-data']),
  async ctx => {
    ctx.logger.info('Handling file upload', { requestId: ctx.requestId });

    const body = ctx.body as MultipartBody;

    // Validate that at least one file was uploaded
    if (body.files.length === 0) {
      throw httpError(400).withDetails({
        files: 'At least one file is required'
      });
    }

    ctx.logger.info('Received files', {
      count: body.files.length,
      requestId: ctx.requestId
    });

    const uploadedFiles = [];

    for (const file of body.files) {
      ctx.logger.info('Processing file', {
        fieldName: file.fieldName,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size
      });

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.mimeType)) {
        throw httpError(400).withDetails({
          [file.fieldName]: `Invalid file type: ${file.mimeType}. Allowed: ${allowedTypes.join(', ')}`
        });
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        throw httpError(400).withDetails({
          [file.fieldName]: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max ${maxSize / 1024 / 1024}MB)`
        });
      }

      // Option 1: Save to local disk
      const uploadDir = '/tmp/uploads';
      const filePath = join(uploadDir, `${Date.now()}-${file.filename}`);
      const writeStream = createWriteStream(filePath);

      try {
        await pipeline(file.stream, writeStream);
        ctx.logger.info('File saved to disk', { filePath });
      } catch (error) {
        ctx.logger.error('Failed to save file', {
          filename: file.filename,
          error
        });
        throw httpError(500).withDetails({
          [file.fieldName]: 'Failed to save file'
        });
      }

      // Option 2: Upload to cloud storage (S3, GCS, etc.)
      // const storageService = ctx.container.get(StorageService);
      // const url = await storageService.upload(file.stream, file.filename, {
      //   contentType: file.mimeType,
      //   metadata: {
      //     uploadedBy: ctx.requestId
      //   }
      // });

      uploadedFiles.push({
        fieldName: file.fieldName,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        path: filePath
        // url: url
      });
    }

    // Access form fields (non-file data)
    const description = body.fields.get('description');
    const category = body.fields.get('category');

    ctx.logger.info('Upload completed', {
      fileCount: uploadedFiles.length,
      requestId: ctx.requestId
    });

    ctx.body = {
      message: 'Files uploaded successfully',
      files: uploadedFiles,
      metadata: {
        description,
        category
      }
    };
  }
);

/**
 * Upload user avatar
 *
 * Accepts a single image file for user avatar.
 */
router.post(
  '/api/users/:id/avatar',
  bodyParserMiddleware(['multipart/form-data']),
  async ctx => {
    const userId = ctx.params.id;

    ctx.logger.info('Handling avatar upload', {
      userId,
      requestId: ctx.requestId
    });

    const body = ctx.body as MultipartBody;

    // Validate single file
    if (body.files.length === 0) {
      throw httpError(400).withDetails({ avatar: 'Avatar file is required' });
    }

    if (body.files.length > 1) {
      throw httpError(400).withDetails({
        avatar: 'Only one avatar file allowed'
      });
    }

    const file = body.files[0];

    // Validate it's an image
    if (!file.mimeType.startsWith('image/')) {
      throw httpError(400).withDetails({
        avatar: `Invalid file type: ${file.mimeType}. Must be an image.`
      });
    }

    // Validate size (2MB max for avatars)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      throw httpError(400).withDetails({
        avatar: `Avatar too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max 2MB)`
      });
    }

    // TODO: Upload avatar and update user
    // const storageService = ctx.container.get(StorageService);
    // const avatarUrl = await storageService.upload(
    //   file.stream,
    //   `avatars/${userId}/${Date.now()}-${file.filename}`
    // );
    //
    // const userService = ctx.container.get(UserService);
    // await userService.updateAvatar(userId, avatarUrl);

    ctx.body = {
      message: 'Avatar uploaded successfully',
      userId,
      avatar: {
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size
        // url: avatarUrl
      }
    };
  }
);

export default router;

// Testing with curl:
//
// Upload single file:
// curl -X POST http://localhost:3000/api/upload \
//   -F "file=@/path/to/image.jpg" \
//   -F "description=My photo"
//
// Upload multiple files:
// curl -X POST http://localhost:3000/api/upload \
//   -F "files=@/path/to/image1.jpg" \
//   -F "files=@/path/to/image2.jpg" \
//   -F "category=photos"
//
// Upload avatar:
// curl -X POST http://localhost:3000/api/users/123/avatar \
//   -F "avatar=@/path/to/avatar.jpg"

// MultipartBody structure:
// {
//   files: MultipartFile[]  // Array of uploaded files
//   fields: Map<string, string>  // Form fields (non-file data)
// }
//
// MultipartFile structure:
// {
//   fieldName: string     // Form field name (e.g., "avatar", "files")
//   filename: string      // Original filename
//   mimeType: string      // MIME type (e.g., "image/jpeg")
//   size: number          // File size in bytes
//   stream: Readable      // Node.js Readable stream
// }
//
// IMPORTANT: You MUST consume the file.stream or the request will hang.
// Either pipe it to a WritableStream or read it into memory.
