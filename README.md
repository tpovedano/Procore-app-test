# Objetivos · Embedded App (Side Panel) de Procore

App de **panel lateral** de Procore que, a partir de un catálogo de elementos con **valores objetivo**, genera automáticamente:

1. una **plantilla de inspección de proyecto**, con una sección por dominio y un ítem por elemento;
2. la inspección **"Reporte de objetivos"**, creada desde esa plantilla y con el valor objetivo cargado en cada ítem;
3. una **inspección planificada trimestral** con la misma plantilla y los ítems sin valor, que termina en la **fecha fin del proyecto**.

No hay base de datos ni estado propio: todo lo que crea la app vive en Procore.

> ⚠️ **Antes de usarlo en producción, lee la sección [TODOs pendientes de verificar](#todos-pendientes-de-verificar-contra-la-api).**
> La referencia REST de Checklists (developers.procore.com/reference) no se pudo consultar mientras se escribía este código. Por eso todas las rutas y los campos que no se pudieron confirmar están aislados en **un solo archivo**, `src/lib/procoreSpec.ts`, y marcados con `TODO(verify)`.

---

## Índice

- [Arquitectura](#arquitectura)
- [Instalación y desarrollo](#instalación-y-desarrollo)
- [Variables de entorno](#variables-de-entorno)
- [Configuración en el Developer Portal](#configuración-en-el-developer-portal)
- [Webhook](#webhook)
- [Despliegue en Vercel](#despliegue-en-vercel)
- [Instalación en un proyecto sandbox](#instalación-en-un-proyecto-sandbox)
- [Checklist de pruebas manuales](#checklist-de-pruebas-manuales)
- [TODOs pendientes de verificar contra la API](#todos-pendientes-de-verificar-contra-la-api)
- [Decisiones de diseño](#decisiones-de-diseño)

---

## Arquitectura

```
.
├── index.html / auth-complete.html   Entradas de Vite (app y cierre de la ventana de login)
├── src/
│   ├── catalog.json                  Catálogo v3: domains → elements (EDITABLE)
│   ├── App.tsx, components/, hooks/  UI (React + Tailwind)
│   └── lib/                          Lógica pura y testeable
│       ├── procoreSpec.ts            ★ Contrato con Procore: rutas, payloads, campos, TODOs
│       ├── procore.ts                Cliente tipado: una función por endpoint (transporte inyectado)
│       ├── workflow.ts               Orquestación: preparar → plantilla → inspección → valores → planificada
│       ├── selection.ts              Selección, validación y saneado, plan de secciones/ítems
│       ├── catalog.ts, dates.ts      Catálogo/búsqueda y utilidades de fecha
│       ├── retry.ts                  Backoff exponencial (429/503) y paginación (Link)
│       ├── procoreContext.ts         Contexto del iframe (postMessage "setup") y orígenes permitidos
│       ├── transport.ts / dryRun.ts  Transporte real (vía proxy) y simulado (dry-run)
│       └── webhook.ts                Verificación y sincronización de fecha fin
├── api/                              Funciones serverless (Vercel, firma web Request → Response)
│   ├── config.ts                     GET  /api/config            configuración pública
│   ├── auth/login.ts                 GET  /api/auth/login        inicio OAuth (state en cookie HttpOnly)
│   ├── auth/callback.ts              GET  /api/auth/callback     intercambio code → tokens (client_secret)
│   ├── procore/proxy.ts              POST /api/procore/proxy     única puerta a la API de Procore (allowlist)
│   ├── webhooks/procore.ts           POST /api/webhooks/procore  webhook de Procore
│   └── _lib/                         env, sesión cifrada, HTTP/CORS, llamadas a Procore
├── tests/                            Vitest
└── vercel.json                       Cabeceras CSP / frame-ancestors
```

**Flujo de "Crear"**

1. `GET /rest/v1.0/projects/{id}`: se lee la fecha fin del proyecto. Si no existe o ya pasó, se muestra un error y **no se crea nada**.
2. Se buscan por nombre (con paginación) la plantilla, la inspección y la planificada. Si alguna existe, la app ofrece **Reutilizar** o **Cancelar**.
3. Se crea la plantilla, luego una sección por cada dominio con elementos seleccionados y después un ítem por elemento. El nombre del ítem es `"{label} ({unit})"`, o `"{label}"` si no hay unidad.
4. Se crea la inspección "Reporte de objetivos" desde la plantilla. Después se leen sus ítems y se carga cada valor objetivo como respuesta (`number_value` o `text_value`).
5. Se crea la planificada trimestral desde hoy hasta la fecha fin del proyecto. Sus ítems no llevan valor.
6. Se muestra un resumen con enlaces a Procore. Si un paso falla, el proceso se detiene y el resumen indica qué se creó y qué no.

**Autenticación**

- Se usa el flujo *Authorization Code Grant*. La página de login de Procore no se muestra dentro de un iframe, así que se abre en una **ventana emergente** con `@procore/procore-iframe-helpers` (`authenticate` → `notifySuccess`).
- El intercambio del code y el refresco de tokens se hacen en `/api` con el `client_secret`, que **nunca llega al navegador**.
- Los tokens van en una **sesión cifrada con AES-256-GCM** que dura como máximo 8 horas. El navegador la guarda **solo en memoria** como un blob opaco y la envía al proxy en la cabecera `X-App-Session`. No se usa ninguna base de datos, `localStorage` ni cookie persistente.
- Se eligió la memoria en lugar de una cookie porque dentro del iframe de Procore la cookie sería de terceros, y Safari y Chrome la bloquean o la particionan.
- La única cookie que usa la app es la del parámetro `state` de OAuth: es HttpOnly, dura 10 minutos y se crea en la ventana emergente, que es de primer nivel.

**Contexto**

- `project_id` y `company_id` llegan del mensaje `setup` que Procore envía al panel lateral por `postMessage` (la app primero envía `{type:'initialize'}` al origen de Procore).
- Como alternativa, también se aceptan parámetros interpolados en la URL (`?companyId={{procore.company.id}}&projectId={{procore.project.id}}`).
- El usuario sale de `GET /rest/v1.0/me`. El contexto del Side Panel no incluye `user_id`.
- Solo se aceptan mensajes que vengan de `https://*.procore.com` y con ids numéricos. No hay ningún campo de la UI donde el usuario pueda escribir ids.

---

## Instalación y desarrollo

Requisitos: Node 20 o superior.

```bash
npm install
cp .env.example .env      # rellena las variables (o deja DRY_RUN=true para probar sin Procore)
npm run dev               # http://localhost:5173 (Vite + funciones /api servidas por un plugin de desarrollo)
```

- Con `DRY_RUN=true` puedes abrir la app fuera de Procore pasando el contexto por la URL: `http://localhost:5173/?companyId=1&projectId=2`. Las peticiones que se enviarían aparecen en la consola y en el panel *Dry-run* de la UI.
- `npm test` ejecuta los tests de Vitest.
- `npm run build` ejecuta el typecheck (frontend y `/api`) y el build de Vite.
- `npm run typecheck` ejecuta solo el typecheck.
- Para probar **dentro** de Procore en local, expón el puerto con un túnel HTTPS (por ejemplo `cloudflared` o `ngrok`) y usa esa URL en el Developer Portal y en `PROCORE_REDIRECT_URI`.
- También puedes usar `vercel dev`, que sirve las mismas funciones.

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `PROCORE_CLIENT_ID` | Sí, salvo en dry-run | Client ID (credenciales de Sandbox o de Producción, según el entorno). |
| `PROCORE_CLIENT_SECRET` | Sí, salvo en dry-run | Client Secret. **Solo lo usa el servidor.** |
| `PROCORE_BASE_URL` | Sí | API y web: `https://sandbox.procore.com` (sandbox) o `https://api.procore.com` (producción). |
| `PROCORE_LOGIN_URL` | No | Servidor OAuth: `https://login-sandbox.procore.com` o `https://login.procore.com`. Si se omite, se deduce de `PROCORE_BASE_URL`. |
| `PROCORE_REDIRECT_URI` | Sí, salvo en dry-run | `https://<tu-dominio>/api/auth/callback`. Debe coincidir exactamente con la registrada en el portal. |
| `WEBHOOK_SECRET` | Para el webhook | Secreto de al menos 16 caracteres. Procore lo envía como `Authorization: Bearer <secreto>`. |
| `SESSION_SECRET` | Sí, salvo en dry-run | Clave de cifrado de la sesión (al menos 32 caracteres aleatorios). |
| `DRY_RUN` | No | `true`: no se llama a Procore y se muestran los payloads. El proxy también rechaza las llamadas en este modo. |

`SESSION_SECRET` y `PROCORE_LOGIN_URL` no figuraban en el enunciado. Se añadieron porque la sesión cifrada necesita su propia clave y porque el servidor de login de sandbox es distinto del de la API.

---

## Configuración en el Developer Portal

1. Crea la app en <https://developers.procore.com>. Se genera automáticamente un **Developer Sandbox**.
2. **Configuration Builder → Embedded Components → Add Component**:
   - **Type:** *Side Panel*.
   - **URL:** `https://<tu-dominio>/`. Como alternativa al `postMessage`, puedes añadir `?companyId={{procore.company.id}}&projectId={{procore.project.id}}`.
   - **Side Panel Views:** elige las vistas donde estará disponible la app. Según la *Side Panel View Key Reference*, la herramienta Inspections solo ofrece **`inspections.detail`** (`/:project_id/project/checklists/lists/:id`). Puedes añadir otras vistas de proyecto según necesites.

   > ⚠️ **Limitación de Procore:** no existe una vista de panel lateral para la **lista** de Inspecciones (la pestaña principal); solo para el detalle de una inspección. Por eso el panel lateral no puede aparecer antes de abrir una inspección.
   > Para tener la app disponible **desde la pestaña principal**, añade también un componente **Full Screen** (paso siguiente). Se abre desde el menú **Apps** del proyecto, en cualquier pantalla, incluida Inspecciones.

   **Componente Full Screen (recomendado además del Side Panel):** *Add Component → Type: Full Screen*, con la URL
   `https://<tu-dominio>/?companyId={{procore.company.id}}&projectId={{procore.project.id}}`.
   El contexto llega por la URL interpolada (en Full Screen no hay mensaje `setup`). La app se centra con un ancho máximo para verse bien a pantalla completa.
3. **Permisos de herramientas** (componente de datos o permisos de la app):
   - **Inspections:** *Admin* o *Standard*, para crear plantillas, inspecciones y planificadas. **Verifica cuál exige cada endpoint.**
   - **Inspections a nivel de compañía (Admin):** necesario si la app tiene que construir la plantilla a nivel compañía (ver "Plantilla: proyecto → compañía" más abajo).
   - **Projects** (lectura del proyecto) y, si usas el webhook, **Webhooks API**: *Standard*.
4. **OAuth:** registra la **Redirect URI** `https://<tu-dominio>/api/auth/callback`. Usa las *Sandbox OAuth Credentials* con las URLs de sandbox.
5. **Webhook con client credentials (DMSA):** el webhook trabaja sin usuario, así que pide el token con `grant_type=client_credentials`. Eso requiere que la app tenga permisos de **Developer Managed Service Account** a nivel de empresa o proyecto (Inspections + Projects).
6. **Save → Create Version** (por ejemplo `0.1.0`).

---

## Webhook

Endpoint: `POST https://<tu-dominio>/api/webhooks/procore`

- **Verificación.** Procore **no firma** los webhooks. El mecanismo documentado son las `destination_headers` del hook, así que se configura `Authorization: Bearer <WEBHOOK_SECRET>` y la app la compara en tiempo constante. Una petición sin esa cabecera recibe `401`.
- **Lógica.** Ante un evento `update` del recurso `Projects` (o `Project Dates`; ver los TODOs):
  - se obtiene un token con client credentials;
  - se relee el proyecto;
  - se busca la planificada por nombre (`Medición trimestral de objetivos`);
  - si su `end_date` es distinta de la fecha fin del proyecto, se actualiza con `PATCH`.
- **Respuesta.** Se responde `202` de inmediato, porque Procore corta la conexión a los 5 segundos. El trabajo continúa con `waitUntil`.
- **Duplicados.** La deduplicación por `ulid` es *best-effort* y en memoria. La operación es idempotente de todas formas.
- **Formatos.** Acepta los payloads v2/v3 (`resource_name`, `event_type`) y v4 (`resource_type`, `reason`).

Alta del hook (en la UI de Procore, *Company/Project Admin → Webhooks*, o por API):

```json
POST /rest/v1.0/webhooks/hooks
{ "project_id": 123, "hook": { "api_version": "v2", "namespace": "objetivos-side-panel",
  "destination_url": "https://<tu-dominio>/api/webhooks/procore",
  "destination_headers": { "Authorization": "Bearer <WEBHOOK_SECRET>" } } }

POST /rest/v1.0/webhooks/hooks/{hook_id}/triggers
{ "project_id": 123, "api_version": "v2", "trigger": { "resource_name": "Projects", "event_type": "update" } }
```

---

## Despliegue en Vercel

1. Importa el repositorio en Vercel. El framework se detecta como **Vite** y `vercel.json` ya define el build y `dist`.
2. En *Settings → Environment Variables*, añade las variables de la tabla anterior. Usa `DRY_RUN=false` en producción.
3. Despliega. Las funciones de `api/` exportan `GET` y `POST` con la firma web (`Request → Response`). Los archivos de `api/_lib/` no se publican como rutas, porque empiezan por `_`.
4. Actualiza la URL del componente, la Redirect URI y la URL del webhook con el dominio de Vercel.

**Cabeceras de seguridad** (`vercel.json`):

- CSP estricta (`default-src 'self'`, sin scripts inline).
- `frame-ancestors https://*.procore.com`: la app solo se puede embeber en Procore.
- `nosniff` y HSTS.

**API:**

- La API devuelve `Cache-Control: no-store` y `frame-ancestors 'none'`.
- El proxy rechaza cualquier `Origin` que no sea el propio ni de Procore.
- Solo reenvía rutas de una **allowlist** (método + ruta con ids numéricos) y limita el tamaño del cuerpo.
- Los logs registran método, ruta y estado. **Nunca** tokens ni cuerpos de autenticación.

---

## Instalación en un proyecto sandbox

1. En el Developer Portal, abre tu app y ve a **Install App** con la versión *Ready for Testing* en tu **Developer Sandbox** (el *Sandbox App Version Key* solo sirve ahí).
2. En el sandbox (`https://sandbox.procore.com`), abre el proyecto *1234 – Sandbox Test Project*.
3. **Pon una fecha de finalización** al proyecto (*Admin del proyecto → General*). El sandbox no siempre trae una.
4. Lanza la app:
   - **Desde la pestaña principal de Inspecciones (o cualquier pantalla del proyecto):** menú **Apps** (arriba a la derecha) → la app (componente Full Screen).
   - **Desde el detalle de una inspección:** dock derecho (componente Side Panel, vista `inspections.detail`).
5. Pulsa **Iniciar sesión con Procore**: se abre una ventana emergente. Si no aparece, permite las ventanas emergentes.
6. Para probar en un *On-Demand* o *Monthly Sandbox* de un cliente, usa la **versión de producción** y las credenciales de producción.

---

## Checklist de pruebas manuales

**Interfaz**
- [ ] Sin selección, **Crear** está deshabilitado y el texto indica "Selecciona al menos un elemento".
- [ ] Al marcar un elemento aparece su campo: numérico con la unidad como sufijo si es `number`, de texto si es `text`.
- [ ] Con valores vacíos, negativos, no numéricos o con espacios en blanco, aparece el error en rojo y **Crear** sigue deshabilitado.
- [ ] Se acepta la coma decimal (`12,5`).
- [ ] "Todos" del dominio marca y desmarca todos sus elementos. Con una selección parcial, la casilla queda indeterminada. El contador muestra `n/total`.
- [ ] El buscador filtra sin distinguir tildes y abre los dominios con resultados. Si no hay coincidencias, muestra un mensaje.
- [ ] La cabecera muestra el nombre del proyecto y el del usuario.
- [ ] Teclado: Tab llega a acordeones, casillas, campos y botón. En el diálogo de duplicados, el foco queda atrapado y Escape cancela.
- [ ] Con 400 px de ancho no aparece scroll horizontal.

**Flujo (con `DRY_RUN=true`)**
- [ ] El panel *Dry-run* lista los `POST`: plantilla → secciones (solo dominios con selección) → ítems → inspección → respuestas → planificada.

**Flujo (contra el sandbox)**
- [ ] Se crean la plantilla, "Reporte de objetivos" con los valores y la planificada trimestral con fin igual a la fecha fin del proyecto. Los enlaces del resumen abren Procore.
- [ ] Al pulsar **Crear** de nuevo, aparece el diálogo de duplicados. *Cancelar* no crea nada. *Reutilizar* actualiza los valores y la fecha fin sin crear objetos nuevos.
- [ ] Con un proyecto sin fecha fin, aparece el error "no tiene fecha de finalización" y no se crea nada.
- [ ] Error parcial (por ejemplo, retirando el permiso de schedules): el resumen indica qué se creó y qué no.
- [ ] Tras más de 1,5 h, el token se refresca solo. Tras más de 8 h, se pide volver a conectar.

**Seguridad**
- [ ] Embeber la app en un dominio que no sea Procore está bloqueado (CSP `frame-ancestors`).
- [ ] `POST /api/webhooks/procore` sin la cabecera correcta devuelve 401.
- [ ] Al cambiar la fecha fin del proyecto, la planificada se actualiza (revisa los logs de Vercel).

---

## TODOs pendientes de verificar contra la API

> **Descubrimiento automático.** Como la referencia REST no se pudo consultar, las rutas de secciones, ítems, inspección y respuestas se descubren en tiempo de ejecución (`src/lib/adaptive.ts`):
> primero se localiza la colección con **GET** (sin efectos) y después se hace el **POST**; un 404 pasa a la siguiente ruta y un 400/422 a la siguiente variante de cuerpo (ninguno crea nada). Lo que funciona se reutiliza en las siguientes llamadas.
> Si la plantilla queda incompleta, la app intenta **borrarla** para no dejar restos.
>
> **Plantilla a nivel compañía.** Las secciones e ítems de plantilla solo se pueden crear con los endpoints de compañía (*Company Checklist Template Sections*), que exigen el id de una plantilla **de compañía**: con el id de una plantilla de proyecto devuelven 404. Por eso la app crea la plantilla con `POST /rest/v1.0/companies/{cid}/checklist/list_templates`, le añade secciones e ítems, **la relee** para comprobar que existen y crea la inspección y la planificada con ese `list_template_id`. Los duplicados se buscan en `GET /rest/v1.0/companies/{cid}/checklist/list_templates`.
> TODO(verify): que *Create Checklist* y *Checklist Schedules* acepten una plantilla de compañía; si no, hará falta el endpoint que importa una plantilla de compañía al proyecto.
> En el panel, **Herramientas de soporte → Diagnóstico de API** hace solo GET y genera un informe copiable con las rutas que existen en tu cuenta y ejemplos reales de respuesta: con él se pueden fijar las rutas definitivas dejando una sola candidata en `CANDIDATES`.

Todos están en **`src/lib/procoreSpec.ts`**. Cada punto se corrige en una sola función o constante.

| # | Qué verificar | Dónde (`procoreSpec.ts`) | Supuesto actual |
| --- | --- | --- | --- |
| 1 | Ruta de "Show Project" y **campo de fecha fin** | `ENDPOINTS.showProject`, `PROJECT_END_DATE_FIELDS` | `GET /rest/v1.0/projects/{id}?company_id=`; prueba primero `completion_date` y luego `projected_finish_date` |
| 2 | List y Create de **Company Checklist Templates** | `paths.companyTemplates`, `buildTemplatePayload` | La plantilla se crea **a nivel compañía**: `POST /rest/v1.0/companies/{cid}/checklist/list_templates` (el listado `GET` está confirmado y da los ids que aceptan las secciones). Cuerpo `{ list_template: { name, description } }` pendiente de confirmar |
| 3 | Crear **sección** de plantilla | `CANDIDATES.templateSections`, `sectionBodies()` | **Descubrimiento automático**: GET a 3 rutas candidatas (company → project → `/checklist/list_templates/{tid}/sections`) y POST en la que exista; cuerpo `{ section: {…} }` o plano. La de proyecto devolvió 404 en sandbox |
| 4 | Crear **ítem** de plantilla | `CANDIDATES.templateItems`, `itemBodies()` | Ruta confirmada (*Create Company Inspection Template Item*): `POST /rest/v1.0/companies/{cid}/inspection_templates/{tid}/items`. Pendiente: campo de sección en el cuerpo (se envía `section_id`) y de tipo; 4 variantes (envuelto/plano, con/sin tipo) |
| 5 | **Tipo de ítem** número/texto (*Checklist Item Types*) | `itemTypeFields()` | `{ item_type: 'number' \| 'text' }` |
| 6 | Cuerpo de **Create Checklist** desde plantilla | `CANDIDATES.checklistCreate`, `buildChecklistPayload()` | `POST /rest/v1.0/checklist/lists?project_id=` y, si da 404, `/projects/{pid}/checklist/lists`; cuerpo `{ project_id, list_template_id, list: { name } }` |
| 7 | **Show Checklist** devuelve las secciones con sus ítems | `CANDIDATES.checklistShow`, `CANDIDATES.checklistItems`, `extractChecklistItems()` | `{ sections: [{ name, items: [{ id, name }] }] }`; si no trae ítems, se listan aparte |
| 8 | **Checklist Item Responses**: ruta y formato | `CANDIDATES.itemResponses`, `itemResponseBodies()` | 3 rutas candidatas; cuerpo `{ item_response: { number_value \| text_value } }` o plano |
| 9 | **Checklist Schedules**: List, Create y Update | `paths.schedules`, `paths.schedule`, `buildSchedulePayload()`, `buildScheduleEndDatePatch()` | `{ schedule: { name, list_template_id, start_date, end_date, … } }` |
| 10 | **Periodicidad trimestral** del schedule | `quarterlyRecurrenceFields()` | `{ frequency: 'monthly', interval: 3, day_of_month }` |
| 11 | Campo `end_date` en la respuesta del schedule | `extractScheduleEndDate()` | `end_date` |
| 12 | URL web de plantillas y planificadas | `templateWebUrl()`, `scheduleWebUrl()` | `/:pid/project/checklists/list_templates/:id` y `/:pid/project/checklists` |
| 13 | Nombre del recurso de webhook cuando cambia la fecha fin | `PROJECT_WEBHOOK_RESOURCES` | `Projects`, `Project Dates` |
| 14 | Paginación (`page`/`per_page`) en los listados de checklist | `procore.ts → listAll` | `per_page=100`, sigue `Link rel="next"` |
| 15 | Permisos mínimos (Inspections: Standard o Admin) y DMSA para el webhook | Developer Portal | — |

**Confirmado en la documentación oficial** (repositorio `procore/documentation`):

- Contexto del Side Panel por `postMessage` (`setup`, `company_id`, `project_id`, `id`, `view`).
- Interpolación de URL (`procore.company.id`, `procore.project.id`).
- Endpoints OAuth (`/oauth/authorize`, `/oauth/token`), refresco con rotación del refresh token y expiración del access token (5400 s).
- Client credentials (DMSA).
- URLs de sandbox (`sandbox.procore.com`, `login-sandbox.procore.com`).
- Cabecera `Procore-Company-Id`.
- Rate limits: `X-Rate-Limit-*`, `429` y `503` con `Retry-After`.
- Paginación (`page`, `per_page`, `Link`, `Total`).
- Webhooks: payloads v2/v4, `destination_headers`, timeout de 5 s.
- `GET /rest/v1.0/me`.
- Patrón de URL `/:project_id/project/checklists/lists/:id` (vista `inspections.detail`).

Las rutas `POST /rest/v1.0/checklist/lists` y `POST /rest/v1.0/projects/{project_id}/checklist/schedules` vienen del enunciado. El catálogo `src/catalog.json` usa el esquema v3: el dominio tiene `id` y `name` (también se acepta `label`), y cada elemento tiene `id`, `label`, `unit` y `valueType`.

---

## Decisiones de diseño

- **Un solo archivo de contrato** (`procoreSpec.ts`). Ajustar la app a la API real no exige tocar la UI ni la orquestación.
- **Proxy con allowlist** en lugar de dar el token al navegador. Aunque alguien obtuviera la sesión, solo podría hacer las operaciones que necesita la app.
- **Duplicados por nombre exacto**, sin distinguir mayúsculas ni tildes.
  - Al *reutilizar* una inspección se actualizan sus valores.
  - Al reutilizar una planificada solo se corrige su fecha fin.
  - Si se reutiliza una plantilla cuyos ítems no coinciden con la selección, los valores se emparejan por nombre de ítem y los que no encuentran pareja se muestran como aviso.
- **Errores parciales.** El flujo es secuencial y se detiene en el primer fallo. No se revierte lo ya creado, para evitar borrados accidentales en Procore; el resumen indica exactamente qué existe.
- **Reintentos.** Ante 429/502/503/504 o un error de red, el servidor espera hasta `X-Rate-Limit-Reset` o `Retry-After`, o aplica un backoff exponencial con jitter. Son como máximo 4 reintentos y 45 s de espera en total.
