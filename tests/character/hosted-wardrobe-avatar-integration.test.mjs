import './support/headless-character.mjs';
import { readFileSync } from 'node:fs';

// Exercise the exact gzip files and rewritten manifest sent to hosting.
globalThis.fetch = async url => {
  try { return new Response(readFileSync(`dist${decodeURIComponent(new URL(String(url), 'http://localhost').pathname)}`)); }
  catch { return new Response(null, { status: 404 }); }
};
await import('./wardrobe-avatar-integration.test.mjs');
