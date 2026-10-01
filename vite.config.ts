/// <reference types="vitest/config" />
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(new URL(import.meta.url).pathname);

/** Misma política que vercel.json, para que el desarrollo local se comporte igual. */
const DEV_HEADERS = {
  // En dev Vite inyecta scripts/estilos inline (HMR), por eso se relaja script/style.
  'Content-Security-Policy': "frame-ancestors 'self' https://*.procore.com",
  'X-Content-Type-Options': 'nosniff',
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Sirve las funciones de /api en `npm run dev` con la misma firma web
 * (export function GET/POST(request: Request): Response) que usa Vercel.
 */
function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api/')) return next();
        const route = url.pathname.slice('/api/'.length);
        const file = path.join(root, 'api', `${route}.ts`);
        if (!/^[a-z0-9/-]+$/.test(route) || route.split('/').some((s) => s.startsWith('_')) || !fs.existsSync(file)) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const method = (req.method ?? 'GET').toUpperCase();
          const handler = mod[method] as ((r: Request) => Response | Promise<Response>) | undefined;
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end('Method not allowed');
          }
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
            else if (v !== undefined) headers.set(k, v);
          }
          const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req));
          const response = await handler(new Request(url, { method, headers, body }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie') res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.config.logger.error(`[api] ${url.pathname}: ${e instanceof Error ? e.message : String(e)}`);
          res.statusCode = 500;
          res.end('Internal error');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expone las variables de .env (sin prefijo VITE_) SOLO al proceso de Node de las funciones /api.
  const env = loadEnv(mode, root, '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

  return {
    plugins: [react(), tailwindcss(), apiDevPlugin()],
    // Ninguna variable del servidor llega al bundle: solo se exponen las VITE_* (no usamos ninguna).
    envPrefix: 'VITE_',
    server: { headers: DEV_HEADERS },
    preview: { headers: DEV_HEADERS },
    build: {
      rollupOptions: {
        input: {
          main: path.join(root, 'index.html'),
          authComplete: path.join(root, 'auth-complete.html'),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
