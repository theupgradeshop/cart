import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Needs a built dist (`npm run build`); the build script is part of the release gate (R2).
const dist = join(__dirname, '..', 'dist', 'checkout');
const files = ['server.js', 'server.mjs', 'server.d.ts', 'server.d.mts'];

describe('dist/checkout/server.* is server-safe', () => {
  it.each(files)('%s exists, has no use-client directive and no react import', (f) => {
    expect(existsSync(join(dist, f))).toBe(true);
    const src = readFileSync(join(dist, f), 'utf8');
    expect(src).not.toMatch(/use client/);
    expect(src).not.toMatch(/from\s*['"]react(\/|['"])/);
    expect(src).not.toMatch(/require\(\s*['"]react/);
  });
  it('the client entry keeps its directive', () => {
    for (const f of ['index.js', 'index.mjs']) {
      expect(readFileSync(join(dist, f), 'utf8').startsWith("'use client';")).toBe(true);
    }
  });
  it('usePayFrame lives only in the pay-frame entry, which keeps its directive', () => {
    for (const f of ['index.js', 'index.mjs', 'server.js', 'server.mjs']) {
      expect(readFileSync(join(dist, f), 'utf8')).not.toMatch(/usePayFrame|breakOutOfFrame|tus-payment/);
    }
    for (const f of ['pay-frame.js', 'pay-frame.mjs']) {
      const src = readFileSync(join(dist, f), 'utf8');
      expect(src.startsWith("'use client';")).toBe(true);
      expect(src).toMatch(/usePayFrame/);
      expect(src).toMatch(/breakOutOfFrame/);
    }
    for (const f of ['pay-frame.d.ts', 'pay-frame.d.mts']) expect(existsSync(join(dist, f))).toBe(true);
  });
});
