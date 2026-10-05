import { expect, it } from 'vitest';
import { isAllowedRequest as a } from '../src/lib/procoreSpec';
it('allow', () => {
  const ok: [string,string][] = [
    ['GET','/rest/v1.0/companies/1/checklist/list_templates/2/sections'],
    ['GET','/rest/v1.0/projects/1/checklist/list_templates/2'],
    ['GET','/rest/v1.0/checklist/lists/5/items'],
    ['POST','/rest/v1.0/companies/1/checklist/list_templates/2/sections'],
    ['POST','/rest/v1.0/checklist/list_templates/2/sections/3/items'],
    ['POST','/rest/v1.0/projects/1/checklist/lists'],
    ['POST','/rest/v1.0/checklist/items/3/item_responses'],
    ['DELETE','/rest/v1.0/projects/1/checklist/list_templates/2'],
    ['POST','/rest/v1.0/companies/1/checklist/list_templates'],
  ];
  const bad: [string,string][] = [
    ['GET','/rest/v1.0/companies/1/users'],
    ['GET','/rest/v1.0/checklist/../companies'],
    ['DELETE','/rest/v1.0/projects/1/checklist/lists/2'],
    ['GET','/rest/v1.0/checklist/lists/5/Items'],
  ];
  for (const [m,p] of ok) expect([m,p,a(m,p)]).toEqual([m,p,true]);
  for (const [m,p] of bad) expect([m,p,a(m,p)]).toEqual([m,p,false]);
});
