import multer, { MulterError } from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { InvalidImageFileError } from '../../core/errors/domain-errors';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches the incident-images bucket's own limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new InvalidImageFileError('Only image files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Wraps multer's single-file parse so both its own errors (oversized/wrong-type file)
 * and our fileFilter's InvalidImageFileError land in error.middleware.ts as a normal
 * 422 AppError envelope, instead of multer's default next(err) shape.
 */
export function incidentImageUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof InvalidImageFileError) {
      next(err);
      return;
    }
    if (err instanceof MulterError) {
      next(new InvalidImageFileError(err.code === 'LIMIT_FILE_SIZE' ? 'The image must be 10MB or smaller.' : err.message));
      return;
    }
    next(err);
  });
}
