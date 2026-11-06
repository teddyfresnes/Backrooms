import { menuPlaylist } from 'virtual:public-manifests';

export function chooseMenuTrack(tracks: readonly string[] = menuPlaylist, random = randomUnit): string {
  if (!tracks.length) throw new Error('La playlist du menu est vide.');
  return tracks[Math.min(tracks.length - 1, Math.max(0, Math.floor(random() * tracks.length)))]!;
}

function randomUnit(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
}
