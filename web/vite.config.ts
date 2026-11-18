import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv, type PluginOption } from 'vite';

const analyze = process.env['ANALYZE'] === '1';

/** Build-time auth provider (`VITE_AUTH_PROVIDER=firebase|oidc`); see src/auth/provider.ts. */
function authProvider(mode: string): PluginOption {
  const oidc = loadEnv(mode, process.cwd(), 'VITE_')['VITE_AUTH_PROVIDER'] === 'oidc';
  return {
    name: 'auth-provider',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!oidc || !source.endsWith('/selected-backend')) return null;
      return this.resolve(`${source}.oidc`, importer, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    authProvider(mode),
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
          if (id.includes('node_modules/oidc-client-ts/')) return 'oidc';
          return undefined;
        },
      },
    },
  },
}));
