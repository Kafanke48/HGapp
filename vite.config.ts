import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Ime repozitorija na GitHubu. Aplikacija se streže pod https://<user>.github.io/HGapp/
// Ta vrednost mora biti identična v `base`, `start_url` in `scope`.
const BASE = '/HGapp/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' namesto 'autoUpdate': nova različica počaka, uporabnik jo potrdi.
      // Sredi seje nočemo samodejnega osveževanja.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'HGapp — domači poker',
        short_name: 'HGapp',
        description: 'Evidenca domačih poker sej in poravnava',
        lang: 'sl',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1120',
        theme_color: '#0b1120',
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${BASE}icons/maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Skupaj z registerType 'prompt': nova različica čaka na potrditev.
        skipWaiting: false,
        runtimeCaching: [
          {
            // Telegram se NIKOLI ne predpomni. Predpomnjen odgovor bi pomenil
            // podvojena sporočila ali zastarela stanja potrditev.
            urlPattern: ({ url }: { url: URL }) => url.hostname === 'api.telegram.org',
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
