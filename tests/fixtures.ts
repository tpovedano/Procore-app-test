import { parseCatalog, type Catalog } from '../src/lib/catalog';

export const catalog: Catalog = parseCatalog({
  version: 3,
  domains: [
    {
      id: 'seg',
      label: 'Seguridad',
      elements: [
        { id: 'inc', label: 'Incidentes', unit: 'uds', valueType: 'number' },
        { id: 'form', label: 'Horas de formación', unit: 'h', valueType: 'number' },
        { id: 'prot', label: 'Protocolo', unit: null, valueType: 'text' },
      ],
    },
    {
      id: 'cal',
      label: 'Calidad',
      elements: [
        { id: 'nc', label: 'No conformidades', unit: 'uds', valueType: 'number' },
        { id: 'plan', label: 'Plan de calidad', unit: null, valueType: 'text' },
      ],
    },
    {
      id: 'mam',
      label: 'Medio ambiente',
      elements: [{ id: 'agua', label: 'Consumo de agua', unit: 'm³', valueType: 'number' }],
    },
  ],
});
