import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.', requestId: String(req.id) } });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (error instanceof ZodError) {
    res.status(400).json({ error: {
      code: 'BAD_REQUEST', message: 'Input tidak valid. Periksa field yang ditandai.', requestId: String(req.id),
      fields: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    } });
    return;
  }
  if (error instanceof AppError) {
    const status = error.code === 'UPCLOUD_AUTH_FAILED' ? 422 : error.status;
    res.status(status).json({ error: {
      code: error.code, message: error.message, requestId: String(req.id),
      ...(error.details ? { details: error.details } : {}),
      ...(error instanceof Object && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
        ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    } });
    return;
  }
  const candidate = error as any;
  if (candidate?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Ukuran request melebihi batas.', requestId: String(req.id) } });
    return;
  }
  if (error instanceof SyntaxError && (error as any).status === 400) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Body JSON tidak valid.', requestId: String(req.id) } });
    return;
  }
  if (candidate?.code === '23505') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource sudah ada atau sedang memiliki job aktif.', requestId: String(req.id) } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal. Coba lagi atau periksa health panel.', requestId: String(req.id) } });
}
