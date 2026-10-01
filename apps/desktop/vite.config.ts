import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@itstudio/schemas': fileURLToPath(new URL('../../src/types/schemas.ts', import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
