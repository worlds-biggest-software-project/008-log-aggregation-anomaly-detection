import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@logwatch/shared';

export function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  const allowed = new Set<UserRole>(roles);
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!allowed.has(request.userRole)) {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient role' });
    }
  };
}

export const requireViewer: preHandlerHookHandler = requireRole('viewer', 'editor', 'admin');
export const requireEditor: preHandlerHookHandler = requireRole('editor', 'admin');
export const requireAdmin: preHandlerHookHandler = requireRole('admin');
