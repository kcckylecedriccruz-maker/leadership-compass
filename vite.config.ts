import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    // On Windows, a zip being written in the project folder locks the file and
    // crashes the watcher. Edge functions under supabase/ are never bundled here.
    watch: { ignored: ['**/*.zip', '**/supabase/**'] },
  },
  preview: {
    // Lets a temporary Cloudflare quick tunnel (https://*.trycloudflare.com) reach `npm run preview`.
    allowedHosts: ['.trycloudflare.com'],
  },
});
