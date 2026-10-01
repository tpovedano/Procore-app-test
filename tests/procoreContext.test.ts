import { describe, expect, it } from 'vitest';
import { isProcoreOrigin, parentOriginFromReferrer, parseContextFromUrl, parseSetupMessage } from '../src/lib/procoreContext';

describe('contexto del iframe', () => {
  it('acepta solo orígenes https de Procore', () => {
    expect(isProcoreOrigin('https://app.procore.com')).toBe(true);
    expect(isProcoreOrigin('https://us02.procore.com')).toBe(true);
    expect(isProcoreOrigin('https://sandbox.procore.com')).toBe(true);
    expect(isProcoreOrigin('http://app.procore.com')).toBe(false);
    expect(isProcoreOrigin('https://procore.com.evil.io')).toBe(false);
    expect(isProcoreOrigin('https://evilprocore.com')).toBe(false);
  });

  it('parsea el mensaje setup y valida ids numéricos', () => {
    const msg = { type: 'setup', context: { company_id: 1, project_id: '22', id: 3, view: 'inspections.detail' } };
    expect(parseSetupMessage('https://app.procore.com', msg)).toEqual({
      companyId: '1',
      projectId: '22',
      view: 'inspections.detail',
      resourceId: '3',
      source: 'postMessage',
    });
    expect(parseSetupMessage('https://evil.com', msg)).toBeNull();
    expect(parseSetupMessage('https://app.procore.com', { type: 'setup', context: { company_id: '1; DROP', project_id: 2 } })).toBeNull();
  });

  it('URL interpolada y referrer', () => {
    expect(parseContextFromUrl('?companyId=1&projectId=2')?.projectId).toBe('2');
    expect(parseContextFromUrl('?companyId=1&projectId=x')).toBeNull();
    expect(parentOriginFromReferrer('https://app.procore.com/123/project/checklists/lists/4')).toBe('https://app.procore.com');
    expect(parentOriginFromReferrer('https://example.com/')).toBeNull();
  });
});
