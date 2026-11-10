import type { FastifyRequest } from 'fastify';
import { resolveTeacher } from '../central-session';
import type { AppConfig } from '../config';
import type { PresentationService } from '../service';

/** Account ownership is checked server-side; only unclaimed presentations accept a legacy key. */
export async function requireAdmin(
  request: FastifyRequest,
  service: PresentationService,
  presentationId: string,
  config: AppConfig,
) {
  const header = request.headers.authorization;
  const match = header ? /^Bearer ([A-Za-z0-9_-]{1,100})$/.exec(header) : null;
  const identity = await resolveTeacher(config, request.headers.cookie);
  return service.authorize(presentationId, match?.[1] ?? '', identity?.id);
}
