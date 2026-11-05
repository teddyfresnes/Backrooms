import { build } from 'esbuild';
import path from 'node:path';
await build({
  entryPoints:['artifact-preview/preview.ts'], outfile:'artifact-preview/output/preview.mjs',
  bundle:true, format:'esm', platform:'browser', target:'es2022', minify:true,
  plugins:[{name:'conversation-runtime',setup(build){
    build.onResolve({filter:/^three$/},()=>({path:'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',external:true}));
    build.onResolve({filter:/^@dimforge\/rapier3d$/},()=>({path:'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/rapier.mjs',external:true}));
    build.onResolve({filter:/^three\/(?:examples\/jsm|addons)\/loaders\/FBXLoader\.js$/},()=>({path:path.resolve('artifact-preview/memory-assets.ts')}));
    build.onResolve({filter:/^\.\/preview-assets\.mjs$/},()=>({path:'https://cdn.jsdelivr.net/gh/teddyfresnes/Backrooms@2309d02266aa72a1d5f317f30f48dfb31594d136/character-preview/preview-assets.mjs',external:true}));
  }}],
});
