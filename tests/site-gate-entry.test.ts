import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Needs a built dist (`npm run build`), like checkout-server-entry.test.ts.
const dist = join(__dirname, '..', 'dist', 'site-gate');

describe('dist/site-gate/*', () => {
  it.each(['index.js', 'index.mjs', 'index.d.ts', 'index.d.mts', 'client.js', 'client.mjs', 'client.d.ts', 'client.d.mts'])('%s exists', (f) => {
    expect(existsSync(join(dist, f))).toBe(true);
  });
  it('the server entry has no use-client directive and no react import (a middleware imports it)', () => {
    for (const f of ['index.js', 'index.mjs']) {
      const src = readFileSync(join(dist, f), 'utf8');
      expect(src).not.toMatch(/use client/);
      expect(src).not.toMatch(/from\s*['"]react(\/|['"])/);
      expect(src).not.toMatch(/require\(\s*['"]react/);
      expect(src).toMatch(/next\/server/);
    }
  });
  it('the client entry keeps its directive', () => {
    for (const f of ['client.js', 'client.mjs']) {
      expect(readFileSync(join(dist, f), 'utf8').startsWith("'use client';")).toBe(true);
    }
  });
});
