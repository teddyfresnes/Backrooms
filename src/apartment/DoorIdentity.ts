import { STAIRWELL_LEVEL_COUNT } from '../stairwell/layout';

/** Canonical address shared by the real leaf, bell, saves and neighbour filter. */
export const PLAYER_APARTMENT_DOOR_ID = `west-neighbor-door-${STAIRWELL_LEVEL_COUNT-1}-leaf`;
export const isPlayerApartmentDoor = (id:string):boolean => id===PLAYER_APARTMENT_DOOR_ID;
