import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CorridorReaction } from './CorridorReaction';
import { CorridorStory } from '../story/CorridorProgress';
import type { CharacterRuntime } from '../character/CharacterRuntime';
import type { PlayerController } from '../player/PlayerController';

it('retains one prepared light slot through the reaction and return to first person',()=>{
 const scene=new THREE.Scene(),story=new CorridorStory(),camera=new THREE.PerspectiveCamera();
 const character={setActive:vi.fn(),beginComputerPresentation:vi.fn(),endComputerPresentation:vi.fn(),sampleCorridorPresentation:()=>({eye:new THREE.Vector3(20,10,-2.7)})};
 const player={fieldOfView:70,prepareScriptedStanding:vi.fn(),setScriptedPose:vi.fn(),setInputEnabled:vi.fn(),setLookQuaternion:vi.fn()};
 const reaction=new CorridorReaction(scene,story,character as unknown as CharacterRuntime,player as unknown as PlayerController,camera,new THREE.Vector3(-2,9.8,-2.7));
 const slots=()=>{const lights:THREE.Light[]=[];scene.traverseVisible(o=>{if(o instanceof THREE.Light)lights.push(o);});return lights;};
 const before=slots();expect(before).toHaveLength(1);expect(before[0]!.intensity).toBe(0);
 Object.assign(story.state,{triggered:true,active:true,elapsed:1,distance:20,reactionPosition:{x:20,y:9.535,z:-2.7}});
 reaction.update(false);expect(slots().map(l=>l.uuid)).toEqual(before.map(l=>l.uuid));expect(before[0]!.intensity).toBe(.7);
 story.state.returned=true;reaction.update(false);expect(slots().map(l=>l.uuid)).toEqual(before.map(l=>l.uuid));expect(before[0]!.intensity).toBe(0);
 expect(character.endComputerPresentation).toHaveBeenCalledOnce();reaction.dispose();expect(slots()).toHaveLength(0);
});
