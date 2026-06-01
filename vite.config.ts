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
    }),
  ],
  build: {
    sourcemap: 'hidden',  // Uploaded to Sentry but not served publicly
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
  },
})
