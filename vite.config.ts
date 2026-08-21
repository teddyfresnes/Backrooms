import { defineConfig } from 'vite';

export default defineConfig({
  // The game, stairwell and wardrobe are loaded on demand. Prebundle their
  // shared Three.js helpers up front so opening a late runtime cannot trigger a
  // dependency re-optimization that invalidates modules already in the page.
  optimizeDeps: {
    include: [
      'three/addons/controls/PointerLockControls.js',
      'three/addons/loaders/FBXLoader.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/utils/SkeletonUtils.js',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
