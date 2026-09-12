export * from 'three';
// Only the GPU surface is substituted. Scene, skeletons, clips, input and
// collision/ragdoll simulation use the production classes and actual FBXs.
export class WebGLRenderer {
  constructor(){ this.domElement=document.createElement('canvas');this.shadowMap={enabled:false}; }
  setPixelRatio(){} setSize(){} setClearColor(){} setAnimationLoop(callback){this.loop=callback;}
  render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);}
  dispose(){}
}
