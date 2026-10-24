export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPCLOUD_ERROR'
  | 'UPCLOUD_AUTH_FAILED'
  | 'UPCLOUD_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function assertFound<T>(value: T | null | undefined, message = 'Resource tidak ditemukan.'): T {
  if (value === null || value === undefined) throw new AppError(404, 'NOT_FOUND', message);
  return value;
}

export function sanitizeUpstreamMessage(value: unknown, secrets: Array<string | undefined> = []): string {
  let message = typeof value === 'string' ? value : 'UpCloud tidak dapat memproses permintaan.';
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  message = message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  message = message.replace(/ucat_[A-Za-z0-9_-]+/g, '[redacted]');
  return message.slice(0, 500);
}
