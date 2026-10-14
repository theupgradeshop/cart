import { defineConfig } from 'tsup';

// Array config: one object per entry, so the root entry's build is exactly what it was.
// tsup cannot set a per-entry banner, hence one object per entry. Neither cleans (two parallel cleans
// could wipe each other's output): `npm run build` empties dist/ first.
// The root entry (cart provider) and the checkout entry (sessionStorage/location, React hooks) carry
// 'use client'. checkout/server carries no directive: a Server Component calls it.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    external: ['react', 'react-dom', 'next'],
    banner: {
      js: "'use client';",
    },
  },
  {
    entry: ['src/checkout/index.ts'],
    outDir: 'dist/checkout',
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    external: ['react', 'react-dom', 'next'],
    banner: {
      js: "'use client';",
    },
  },
  {
    // Server-safe entry: NO 'use client' banner, no React import (checked by tests/checkout-server-entry.test.ts).
    entry: ['src/checkout/server.ts'],
    outDir: 'dist/checkout',
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    external: ['react', 'react-dom', 'next'],
  },
]);
