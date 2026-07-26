import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Multi-seed topology audits intentionally generate hundreds of complete
      // chunks, including the navigation-component classification pass.
      testTimeout: 30_000,
      // @dimforge/rapier3d ships its browser build with a native ESM WebAssembly
      // import. Node needs this flag for the real physics implementation to run
      // inside Vitest instead of being replaced by a collision mock.
      execArgv: ['--experimental-wasm-modules'],
    },
  }),
);
