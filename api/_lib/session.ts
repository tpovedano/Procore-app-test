/**
 * Sesión cifrada (AES-256-GCM). Contiene los tokens de Procore; el navegador
 * solo guarda el blob opaco en memoria y lo envía al proxy. No hay base de datos.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionData {
  /** access token */
  at: string;
  /** refresh token */
  rt: string;
  /** expiración del access token (epoch ms) */
  atExp: number;
  /** expiración absoluta de la sesión (epoch ms) */
  exp: number;
}

/** Vida máxima de la sesión: corta, obliga a reconectar cada jornada. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'procore-objetivos', 'session-v1', 32));
}

export function seal(data: SessionData, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function unseal(blob: string, secret: string, now = Date.now()): SessionData | null {
  try {
    if (blob.length > 8192) return null;
    const raw = Buffer.from(blob, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const data = JSON.parse(json) as SessionData;
    if (typeof data.at !== 'string' || typeof data.rt !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp <= now) return null;
    return data;
  } catch {
    return null;
  }
}

export function randomState(): string {
  return randomBytes(24).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
