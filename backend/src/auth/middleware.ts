/* eslint-disable @typescript-eslint/no-namespace */
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { hashOpaqueToken, safeHexEqual } from '../lib/crypto.js';
import type { AuthContext, AuthService } from './service.js';
import type { PanelApiKeyService } from '../api-keys/service.js';

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export const sessionCookieName = (config: AppConfig) => config.cookieSecure ? '__Host-cerdasnet_session' : 'cerdasnet_session';

export function requireAuth(authService: AuthService, config: AppConfig, apiKeys?: PanelApiKeyService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const bearer = req.get('authorization')?.startsWith('Bearer ') ? req.get('authorization')!.slice(7) : null;
    const token = req.cookies?.[sessionCookieName(config)] as string | undefined;
    if ((!token || token.length > 200) && (!bearer || !apiKeys)) return next(new AppError(401, 'UNAUTHENTICATED', 'Sesi login atau API key diperlukan.'));
    try {
      const auth = bearer && apiKeys ? await apiKeys.authenticate(bearer) : await authService.authenticate(token!);
      if (!auth) return next(new AppError(401, 'UNAUTHENTICATED', 'Sesi atau API key tidak valid/kedaluwarsa.'));
      if (auth.apiKey && !apiKeyAllowed(auth.apiKey.scopes, req.method, req.originalUrl)) return next(new AppError(403, 'SCOPE_REQUIRED', 'API key tidak memiliki scope untuk operasi ini.'));
      req.auth = auth;
      return next();
    } catch (error) { return next(error); }
  };
}

function apiKeyAllowed(scopes: string[], method: string, url: string): boolean {
  if (scopes.includes('admin')) return true;
  const path = url.split('?')[0]!;
  const required = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read'
    : path.includes('/api/deployments') ? 'servers:deploy'
      : path.includes('/api/servers') || path.includes('/api/sync/jobs') ? 'servers:write' : 'admin';
  return scopes.includes(required);
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.auth?.apiKey) return next();
  const supplied = req.get('x-csrf-token');
  const expected = req.auth?.csrfToken;
  if (!supplied || !expected || !safeHexEqual(hashOpaqueToken(supplied), hashOpaqueToken(expected))) {
    return next(new AppError(403, 'CSRF_INVALID', 'Token CSRF tidak valid. Muat ulang sesi panel.'));
  }
  return next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.user.role !== 'admin') return next(new AppError(403, 'FORBIDDEN', 'Hanya admin yang dapat mengakses resource ini.'));
  return next();
}

export function originGuard(config: AppConfig) {
  const expectedOrigin = new URL(config.appOrigin).origin;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.auth?.apiKey) return next();
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite === 'cross-site') return next(new AppError(403, 'CSRF_INVALID', 'Request lintas situs ditolak.'));
    const origin = req.get('origin');
    if (origin) {
      try {
        const actualOrigin = new URL(origin).origin;
        const host = req.get('host');
        // Also accept the public same-origin Host/proto seen through a trusted reverse proxy.
        const sameRequestOrigin = host ? new URL(`${req.protocol}://${host}`).origin : null;
        if (actualOrigin !== expectedOrigin && actualOrigin !== sameRequestOrigin) throw new Error('origin mismatch');
      } catch {
        return next(new AppError(403, 'CSRF_INVALID', 'Origin request tidak diizinkan.'));
      }
    }
    return next();
  };
}
