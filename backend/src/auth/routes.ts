import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import type { AuthService } from './service.js';
import { requireAuth, requireCsrf, sessionCookieName } from './middleware.js';
import { requestAudit } from '../http/helpers.js';

const loginSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(1).max(256) });
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
    .regex(/[a-z]/, 'Password harus mengandung huruf kecil.')
    .regex(/[A-Z]/, 'Password harus mengandung huruf besar.')
    .regex(/[0-9]/, 'Password harus mengandung angka.'),
});

export function authRoutes(db: Database, auth: AuthService, config: AppConfig): Router {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' } },
  });
  const cookieOptions = (expires?: Date) => ({
    httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const,
    path: '/', ...(expires ? { expires } : {}),
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await auth.login(input.username, input.password, { ipAddress: req.ip, userAgent: req.get('user-agent') });
      res.cookie(sessionCookieName(config), result.sessionToken, cookieOptions(result.expiresAt));
      await requestAudit(db, req, {
        action: 'auth.login', resourceType: 'user', resourceId: result.auth.user.id,
        outcome: 'success', details: { username: result.auth.user.username }, userId: result.auth.user.id,
      });
      res.json({ data: { user: result.auth.user, csrfToken: result.auth.csrfToken, expiresAt: result.expiresAt } });
    } catch (error) {
      if (req.body?.username) {
        await requestAudit(db, req, {
          action: 'auth.login', resourceType: 'session', outcome: 'failure',
          details: { username: String(req.body.username).slice(0, 64) },
        }).catch(() => undefined);
      }
      next(error);
    }
  });

  router.get('/me', requireAuth(auth, config), (req, res) => {
    res.json({ data: { user: req.auth!.user, csrfToken: req.auth!.csrfToken, expiresAt: req.auth!.expiresAt } });
  });

  router.post('/logout', requireAuth(auth, config), requireCsrf, async (req, res, next) => {
    try {
      const userId = req.auth!.user.id;
      await auth.logout(req.auth!.sessionId);
      await requestAudit(db, req, { action: 'auth.logout', resourceType: 'user', resourceId: userId, outcome: 'success' });
      res.clearCookie(sessionCookieName(config), cookieOptions());
      res.json({ data: { loggedOut: true } });
    } catch (error) { next(error); }
  });

  router.patch('/password', requireAuth(auth, config), requireCsrf, async (req, res, next) => {
    try {
      const input = passwordSchema.parse(req.body);
      const userId = req.auth!.user.id;
      await auth.changePassword(userId, input.currentPassword, input.newPassword);
      await requestAudit(db, req, { action: 'auth.password_change', resourceType: 'user', resourceId: userId, outcome: 'success' });
      res.clearCookie(sessionCookieName(config), cookieOptions());
      res.json({ data: { passwordChanged: true, loginRequired: true } });
    } catch (error) { next(error); }
  });
  return router;
}
