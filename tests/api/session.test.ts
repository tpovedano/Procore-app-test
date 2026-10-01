import { describe, expect, it } from 'vitest';
import { seal, unseal } from '../../api/_lib/session';
import { getConfig } from '../../api/_lib/env';

const SECRET = 'x'.repeat(40);

describe('sesión cifrada', () => {
  const data = { at: 'access', rt: 'refresh', atExp: 1, exp: Date.now() + 60_000 };

  it('cifra y descifra', () => {
    const blob = seal(data, SECRET);
    expect(blob).not.toContain('access');
    expect(unseal(blob, SECRET)).toEqual(data);
  });

  it('rechaza manipulación, otra clave o sesión caducada', () => {
    const blob = seal(data, SECRET);
    const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'BB' : 'AA');
    expect(unseal(tampered, SECRET)).toBeNull();
    expect(unseal(blob, 'y'.repeat(40))).toBeNull();
    expect(unseal(seal({ ...data, exp: Date.now() - 1 }, SECRET), SECRET)).toBeNull();
    expect(unseal('basura', SECRET)).toBeNull();
  });
});

describe('configuración', () => {
  it('deduce URLs de sandbox y producción', () => {
    const base = { PROCORE_CLIENT_ID: 'a', PROCORE_CLIENT_SECRET: 'b', PROCORE_REDIRECT_URI: 'https://x/cb', SESSION_SECRET: SECRET };
    const sb = getConfig({ ...base, PROCORE_BASE_URL: 'https://sandbox.procore.com' });
    expect(sb).toMatchObject({ loginUrl: 'https://login-sandbox.procore.com', webBaseUrl: 'https://sandbox.procore.com', environment: 'sandbox' });
    const prod = getConfig({ ...base, PROCORE_BASE_URL: 'https://api.procore.com' });
    expect(prod).toMatchObject({ loginUrl: 'https://login.procore.com', webBaseUrl: 'https://app.procore.com', environment: 'production' });
    expect(() => getConfig({ ...base, PROCORE_BASE_URL: 'http://api.procore.com' })).toThrow(/https/);
    expect(() => getConfig({ PROCORE_BASE_URL: 'https://api.procore.com' })).toThrow(/Faltan/);
  });
});
