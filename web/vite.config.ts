import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';

const analyze = process.env['ANALYZE'] === '1';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    analyze
      ? (visualizer({
          filename: 'dist/stats.html',
          gzipSize: true,
          template: 'treemap',
        }) as PluginOption)
      : null,
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Same origin in production (Firebase Hosting rewrite), so the dev server proxies instead of
    // enabling CORS on the API.
    proxy: { '/api/v1': 'http://localhost:8080' },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        // One named chunk for the Firebase SDK so the bundle check can assert who imports it.
        manualChunks(id) {
          if (id.includes('node_modules/firebase/') || id.includes('node_modules/@firebase/')) {
            return 'firebase';
          }
          return undefined;
        },
      },
    },
  },
});
