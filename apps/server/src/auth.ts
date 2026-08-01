import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { GitWebUiError } from '@git-webui/shared';
import type { UserRole } from '@git-webui/shared';

const SESSION_COOKIE = 'git_webui_session';
const CSRF_COOKIE = 'git_webui_csrf';
const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 60_000;

interface StoredSession {
  id: string;
  role: UserRole;
  csrfToken: string;
  expiresAt: number;
}

export interface AuthenticatedUser {
  role: UserRole;
  csrfToken: string;
  expiresAt: number;
}

interface LoginFailures {
  count: number;
  firstFailureAt: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
  }
}

export class AuthService {
  private readonly sessions = new Map<string, StoredSession>();

  private readonly loginFailures = new Map<string, LoginFailures>();

  private readonly passwordHash: Buffer | null;

  private readonly sessionSecret: string | null;

  public constructor(
    private readonly options: {
      enabled: boolean;
      password: string | null;
      sessionSecret: string | null;
      role: UserRole;
      sessionTtlMs: number;
      cookieSecure: boolean;
    },
  ) {
    this.passwordHash = options.password === null ? null : hashSecret(options.password);
    this.sessionSecret = options.sessionSecret;
  }

  public get enabled(): boolean {
    return this.options.enabled;
  }

  public get role(): UserRole {
    return this.options.role;
  }

  public authenticate(password: string, address: string): AuthenticatedUser {
    if (!this.enabled || this.passwordHash === null || this.sessionSecret === null) {
      throw new GitWebUiError('AUTH_REQUIRED', '当前服务未启用可用的登录配置。');
    }
    const now = Date.now();
    const failures = this.loginFailures.get(address);
    if (failures !== undefined && now - failures.firstFailureAt < LOGIN_WINDOW_MS) {
      if (failures.count >= MAX_LOGIN_FAILURES) {
        throw new GitWebUiError('RATE_LIMITED', '登录失败次数过多，请稍后重试。', {
          retryAfterSeconds: Math.ceil((LOGIN_WINDOW_MS - (now - failures.firstFailureAt)) / 1000),
        });
      }
    } else if (failures !== undefined) {
      this.loginFailures.delete(address);
    }

    if (!safeEqual(this.passwordHash, hashSecret(password))) {
      const current = this.loginFailures.get(address);
      this.loginFailures.set(
        address,
        current === undefined || now - current.firstFailureAt >= LOGIN_WINDOW_MS
          ? { count: 1, firstFailureAt: now }
          : { count: current.count + 1, firstFailureAt: current.firstFailureAt },
      );
      throw new GitWebUiError('AUTH_REQUIRED', '密码不正确。');
    }

    this.loginFailures.delete(address);
    return this.createSession();
  }

  public getSession(cookieHeader: string | undefined): AuthenticatedUser | null {
    if (!this.enabled || this.sessionSecret === null) return null;
    const signedId = readCookie(cookieHeader, SESSION_COOKIE);
    if (signedId === null) return null;
    const separator = signedId.lastIndexOf('.');
    if (separator <= 0) return null;
    const id = signedId.slice(0, separator);
    const signature = signedId.slice(separator + 1);
    if (!safeEqual(Buffer.from(signature), Buffer.from(this.sign(id)))) return null;
    const session = this.sessions.get(id);
    if (session === undefined) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return toPublicSession(session);
  }

  public hasValidCsrf(user: AuthenticatedUser, request: FastifyRequest): boolean {
    const header = request.headers['x-csrf-token'];
    const headerValue = Array.isArray(header) ? header[0] : header;
    const cookieValue = readCookie(request.headers.cookie, CSRF_COOKIE);
    return (
      typeof headerValue === 'string' &&
      cookieValue !== null &&
      safeEqual(Buffer.from(user.csrfToken), Buffer.from(headerValue)) &&
      safeEqual(Buffer.from(user.csrfToken), Buffer.from(cookieValue))
    );
  }

  public sessionCookies(user: AuthenticatedUser): string[] {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.csrfToken === user.csrfToken,
    );
    if (session === undefined) return [];
    const attributes = [
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${Math.max(1, Math.floor(this.options.sessionTtlMs / 1000))}`,
    ];
    if (this.options.cookieSecure) attributes.push('Secure');
    return [
      `${SESSION_COOKIE}=${session.id}.${this.sign(session.id)}; HttpOnly; ${attributes.join('; ')}`,
      `${CSRF_COOKIE}=${session.csrfToken}; ${attributes.join('; ')}`,
    ];
  }

  public clearCookies(): string[] {
    const secure = this.options.cookieSecure ? '; Secure' : '';
    return [
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
      `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`,
    ];
  }

  public revoke(user: AuthenticatedUser | null): void {
    if (user === null) return;
    for (const [id, session] of this.sessions.entries()) {
      if (session.csrfToken === user.csrfToken) this.sessions.delete(id);
    }
  }

  private createSession(): AuthenticatedUser {
    const session: StoredSession = {
      id: randomBytes(32).toString('base64url'),
      role: this.role,
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + this.options.sessionTtlMs,
    };
    this.sessions.set(session.id, session);
    return toPublicSession(session);
  }

  private sign(value: string): string {
    if (this.sessionSecret === null) return '';
    return createHmac('sha256', this.sessionSecret).update(value).digest('base64url');
  }
}

const toPublicSession = (session: StoredSession): AuthenticatedUser => ({
  role: session.role,
  csrfToken: session.csrfToken,
  expiresAt: session.expiresAt,
});

const hashSecret = (value: string): Buffer => createHash('sha256').update(value).digest();

const safeEqual = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

const readCookie = (header: string | undefined, name: string): string | null => {
  if (header === undefined) return null;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};
