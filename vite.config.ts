import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Sentry must be last — uploads source maps on production build
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Only upload on CI builds (SENTRY_AUTH_TOKEN set)
      disable: !process.env.SENTRY_AUTH_TOKEN,
      // Upload to Sentry, then DELETE the .map files so they are not deployed.
      // `sourcemap: 'hidden'` only omits the //# sourceMappingURL comment — the
      // files were still emitted into dist/ and served, so anyone could fetch
      // them by guessing the name (audit 2026-08-08, finding 35). Nothing
      // sensitive was in them (grepped: only i18n strings and UI labels), but
      // the config comment asserted "not served publicly", which was false —
      // and a future author may write sensitive commentary into client code
      // believing that assurance. An .assetsignore is NOT sufficient on a CF
      // Pages Functions project; the files have to be removed.
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ],
  build: {
    sourcemap: 'hidden',  // Emitted for the Sentry upload, then deleted (see above)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1234,
    // Bind all interfaces so the dev server is reachable over Tailscale/LAN
    // (e.g. http://100.76.39.66:1234) without an SSH tunnel — the repo + Vite
    // run on lenovoserver but get accessed from another machine. dev Directus
    // is CORS_ORIGIN=*, so a non-localhost origin is still accepted; via a
    // non-localhost host the app uses VITE_DIRECTUS_URL (dev) from `.env`.
    host: true,
    // `npm run dev:prod` sets VITE_PROD_DATA=1 → all `/directus/*` requests
    // (REST + WS) get reverse-proxied to prod Directus. The browser only
    // ever talks to localhost:1234, so CORS never engages. Writes hit
    // PROD — `src/lib/api.ts` prints a red console banner on startup so
    // this can't be forgotten.
    ...(process.env.VITE_PROD_DATA === '1' && {
      proxy: {
        '/directus': {
          target: 'https://directus.kscw.ch',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/directus/, ''),
          ws: true,
          secure: true,
        },
      },
    }),
    // `npm run dev:login` sets VITE_DEV_PROXY=1 → same proxy aimed at DEV
    // Directus, so cookie-session login works in a real browser. The dev
    // session cookie is `Domain=.kscw.ch; SameSite=Lax` — no localhost or
    // pages.dev origin can hold it, which is why logging in on the CF Pages
    // preview 401s on the very next request. Through the proxy everything is
    // same-origin, and stripping the Domain attribute makes the cookie stick
    // to the vite origin. Access via http://localhost:1234 (SSH tunnel), NOT
    // the Tailscale IP: `Secure` cookies and the E2EE screens' crypto.subtle
    // both need a secure context, and localhost is one while a bare IP isn't.
    ...(process.env.VITE_DEV_PROXY === '1' && {
      proxy: {
        '/directus': {
          target: 'https://directus-dev.kscw.ch',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/directus/, ''),
          ws: true,
          secure: true,
          configure: (proxy: { on: (ev: 'proxyRes', cb: (res: { headers: Record<string, unknown> }) => void) => void }) => {
            proxy.on('proxyRes', (res) => {
              const sc = res.headers['set-cookie']
              if (Array.isArray(sc)) {
                res.headers['set-cookie'] = sc.map((c: string) => c.replace(/;\s*Domain=[^;]*/i, ''))
              }
            })
          },
        },
      },
    }),
  },
})
