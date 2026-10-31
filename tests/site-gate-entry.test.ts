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
      expect(src).toMatch(/next\/server\.js/);
    }
  });
  it('the client entry keeps its directive', () => {
    for (const f of ['client.js', 'client.mjs']) {
      expect(readFileSync(join(dist, f), 'utf8').startsWith("'use client';")).toBe(true);
    }
  });
});

describe('built ESM resolves under plain Node ESM (no consumer config)', () => {
  it('node --input-type=module can import dist/site-gate/index.mjs and run the gate', () => {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const file = join(dist, 'index.mjs');
    const code = `
      const m = await import(${JSON.stringify(file)});
      if (typeof m.siteGate !== 'function' || typeof m.thankYouSkip !== 'function') throw new Error('exports missing');
      const { NextRequest } = await import('next/server.js');
      const res = await m.siteGate(new NextRequest('https://a.test/x'), { domain: 'a.test', platformUrl: 'https://p.test',
        fetchImpl: async () => new Response(JSON.stringify({ on: true, view: 'visitor', variant: 'centered', businessName: 'A' }), { status: 200 }) });
      if (!res || res.status !== 503) throw new Error('unexpected ' + (res && res.status));
      console.log('ok');
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    expect(out.trim()).toBe('ok');
  });

  it('the CJS build still loads', () => {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync(process.execPath, ['-e', `const m=require(${JSON.stringify(join(dist, 'index.js'))});console.log(typeof m.siteGate)`], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    expect(out.trim()).toBe('function');
  });
});
