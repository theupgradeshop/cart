import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@upgradeshop/cart/tracking': fileURLToPath(new URL('./src/tracking/index.ts', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
