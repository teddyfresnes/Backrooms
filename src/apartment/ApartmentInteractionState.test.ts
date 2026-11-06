import { expect,it } from 'vitest';
import { freshFixtures,sanitizeApartmentFixtures,sanitizeApartmentObjects } from './ApartmentInteractionState';
it('round-trips independent appliances, stable body poses, broken pots, plants and actual surface deposits',()=>{
  const pose={position:{x:-5,y:9.7,z:0},rotation:{x:0,y:0,z:0,w:1},sleeping:true};
  const objects={version:1,bodies:{'prop:flowerpot/plant':pose},broken:{'prop:flowerpot':{kind:'pot',position:{x:-5,y:9.7,z:0},residuePending:true}},deposits:[{kind:'soil',position:{x:-5,y:9.57,z:0},normal:{x:0,y:1,z:0},radius:.1}]};
  expect(sanitizeApartmentObjects(JSON.parse(JSON.stringify(objects)))).toEqual(objects);
  const fixtures={...freshFixtures(),waterLevel:1,deskLampOn:true,fanOn:true,closetDoor:.5};expect(sanitizeApartmentFixtures(fixtures)).toEqual(fixtures);
  expect(sanitizeApartmentFixtures({...fixtures,waterLevel:4})).toBeNull();expect(sanitizeApartmentObjects({...objects,bodies:{bad:{...pose,rotation:{x:0,y:0,z:0,w:0}}}})).toBeNull();
});
