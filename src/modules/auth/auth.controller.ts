import type { Request, Response } from 'express';
import { REFRESH_TOKEN_TTL_MS } from '../../config/constants';
import { env } from '../../config/env';
import { UnauthenticatedError } from '../../core/errors/http-errors';
import type { LoginRequest, RegisterRequest } from '../../contracts/auth.contract';
import * as authService from './auth.service';

const REFRESH_COOKIE_NAME = 'refreshToken';
// Scoped to /api/v1/auth so the cookie is never attached to ordinary API calls that
// don't need it (those authenticate via the Bearer access token instead).
const REFRESH_COOKIE_PATH = '/api/v1/auth';

// In local dev, incident-web calls this endpoint cross-PORT (localhost:5173 ->
// localhost:4000): SameSite is a same-SITE concern, not same-origin — the "site"
// boundary is registrable domain + scheme, which ignores port, so both are
// "localhost" and this is same-site. Lax is sufficient there. But the deployed
// frontend and backend sit on different registrable domains (e.g. a Vercel
// project and a Render service) — genuinely cross-site — and a Lax cookie is
// never attached to a cross-site fetch/XHR (only top-level navigations), so the
// browser would silently drop it from every refresh call and the session would
// never survive a page reload. SameSite=None (requires Secure, already true in
// production) is what a real cross-origin deployment needs.
function setRefreshCookie(res: Response, token: string): void {
  const isProd = env.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

function requestMeta(req: Request) {
  return { userAgent: req.header('user-agent'), ipAddress: req.ip };
}

export async function registerHandler(req: Request, res: Response): Promise<void> {
  const body = req.validated.body as RegisterRequest;
  const { accessToken, refreshToken, user } = await authService.register(body, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ accessToken, user });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const body = req.validated.body as LoginRequest;
  const { accessToken, refreshToken, user } = await authService.login(body, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken, user });
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!presented) {
    clearRefreshCookie(res);
    throw new UnauthenticatedError();
  }
  try {
    const { accessToken, refreshToken } = await authService.refresh(presented, requestMeta(req));
    setRefreshCookie(res, refreshToken);
    res.status(200).json({ accessToken });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(presented, req.actor?.sessionId);
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.actor!.id);
  res.status(200).json(user);
}
