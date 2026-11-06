import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const outfile = path.join(root, '.character-test-dist/ground-volume-contact.mjs');
await build({ entryPoints: [path.join(root, 'src/physics/GroundKickContact.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{
    name: 'rapier-test-runtime', setup(build) {
      build.onResolve({ filter: /^@dimforge\/rapier3d$/ }, () => ({ path: path.join(root, 'tests/character/support/rapier-headless.mjs') }));
    },
  }] });
export const { sweepGroundKickVolumes } = await import(outfile);
