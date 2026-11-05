import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createLab,stepLab,THREE} from '../tests/character/support/headless-character.mjs';
const runs=[],stats=values=>{const a=[...values].sort((x,y)=>x-y);return {n:a.length,median:a[Math.floor(a.length/2)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
for(const fps of [30,60,120]){
  const lab=await createLab();lab.setInteractionPartner(null);lab.player.controls.isLocked=true;
  lab.player.teleport({x:-14,y:.865,z:-12});lab.updateAvatarTransform(0,true);lab.viewMode='first-person';lab.applyViewMode(true);
  lab.startRagdoll({fatal:false,addedVelocity:new THREE.Vector3(.3,0,.2)});
  for(let i=0;i<fps*3;i++)stepLab(lab,1/fps);
  lab.refreshRecoveryAvailability(true);
  let sample,physicsSeconds=0;
  const step=lab.physics.world.step.bind(lab.physics.world);
  lab.physics.world.step=(...args)=>{const t=performance.now();const result=step(...args);if(sample){sample.physics+=performance.now()-t;sample.steps++;physicsSeconds+=lab.physics.world.timestep;}return result;};
  const began=performance.now();lab.startGetUp();const activationCPU=performance.now()-began;
  if(!lab.recovery)throw Error('No valid get-up in the declared fixture.');
  const clip=lab.recovery.action.getClip().name,frames=[];
  for(let i=0;lab.recovery&&i<fps*10;i++){
    sample={physics:0,steps:0};const t=performance.now();stepLab(lab,1/fps);sample.cpu=performance.now()-t;frames.push(sample);sample=undefined;
  }
  if(lab.recovery)throw Error('Get-up failed to finish.');
  runs.push({fps,clip,activationCPU,physicsSeconds,cpu:stats(frames.map(f=>f.cpu)),physics:stats(frames.map(f=>f.physics)),frames});
  lab.dispose();
}
writeFileSync(process.argv[2]??'.fall-audit/getup-profile.json',JSON.stringify({seed:'movement-lab',start:{x:-14,y:.865,z:-12},renderer:'none',runs},null,2));
console.log(JSON.stringify(runs.map(({frames,...r})=>r)));
