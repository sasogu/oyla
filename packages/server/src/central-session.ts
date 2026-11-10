import { AppError } from './app-error';
import type { AppConfig } from './config';

export interface TeacherIdentity {
  id: string;
  displayName: string;
}

/** Only the identity service can validate these signed, HttpOnly cookies. */
export async function resolveTeacher(
  config: AppConfig,
  cookie?: string,
): Promise<TeacherIdentity | null> {
  if (!config.central || !cookie) return null;
  const cookies = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^(edutictac_oidc|edutictac_id)=[^\r\n;]+$/.test(part));
  if (!cookies.length) return null;
  try {
    const response = await fetch(`${config.central.url}/api/internal/session/resolve`, {
      headers: { authorization: `Bearer ${config.central.token}`, cookie: cookies.join('; ') },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Identity unavailable');
    const data = (await response.json()) as Record<string, unknown>;
    if (
      data.kind !== 'oidc' ||
      typeof data.sub !== 'string' ||
      !data.sub ||
      !['profesor', 'professorat', 'administrador'].includes(String(data.role))
    )
      return null;
    return {
      id: `oidc:${data.sub}`,
      displayName: typeof data.display_name === 'string' ? data.display_name : '',
    };
  } catch {
    // Never include the upstream request, cookies or application token in logs/errors.
    throw new AppError('INTERNAL', 503, 'Identity service unavailable');
  }
}

export function requireSameOrigin(
  config: AppConfig,
  headers: { origin?: string; 'sec-fetch-site'?: string },
) {
  if (!config.central) return;
  if (headers.origin !== config.central.origin || headers['sec-fetch-site'] === 'cross-site') {
    throw new AppError('UNAUTHORIZED', 403, 'Origin not allowed');
  }
}
