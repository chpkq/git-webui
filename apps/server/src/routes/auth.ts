import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth.js';

const loginInputSchema = z.object({ password: z.string().min(1).max(4096) });

export const registerAuthRoutes = async (
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> => {
  app.post('/api/auth/login', async (request, reply) => {
    if (!auth.enabled) return { enabled: false, authenticated: true, role: auth.role };
    const input = loginInputSchema.parse(request.body);
    const user = auth.authenticate(input.password, request.ip);
    reply.header('Set-Cookie', auth.sessionCookies(user));
    reply.header('X-CSRF-Token', user.csrfToken);
    return { enabled: true, authenticated: true, role: user.role, expiresAt: user.expiresAt };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!auth.enabled) return { enabled: false, authenticated: true, role: auth.role };
    const user = request.authUser ?? auth.getSession(request.headers.cookie);
    if (user === null) return { enabled: true, authenticated: false };
    reply.header('X-CSRF-Token', user.csrfToken);
    return { enabled: true, authenticated: true, role: user.role, expiresAt: user.expiresAt };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    auth.revoke(request.authUser);
    reply.header('Set-Cookie', auth.clearCookies());
    return { ok: true };
  });
};
