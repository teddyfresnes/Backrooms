import { describe,it,expect } from 'vitest';
import { CHARACTER_VOICES, characterVoiceUrl } from './VoiceCatalog';

describe('user-provided cinematic and dialogue recordings',()=>{
  it('ships all five voices and the complete music as verified local Opus files',async()=>{
    // @ts-expect-error Node builtins are test-only.
    const {readFile}=await import('node:fs/promises');
    // @ts-expect-error Node builtins are test-only.
    const {createHash}=await import('node:crypto');
    const manifest=JSON.parse(await readFile(new URL('../../docs/validation/arrival-audio-assets.json',import.meta.url),'utf8')) as {
      total_bytes:number; files:{runtime:string;runtime_sha256:string;bytes:number}[];
    };
    expect(manifest.files).toHaveLength(11);
    for(const voice of CHARACTER_VOICES)for(const cue of ['hmm','gasp'] as const)
      expect(manifest.files.some(file=>'/'+file.runtime===characterVoiceUrl(voice.id,cue))).toBe(true);
    let total=0;
    for(const file of manifest.files){
      const bytes=await readFile(new URL('../../public/'+file.runtime,import.meta.url));
      expect(bytes.subarray(0,4).toString()).toBe('OggS');
      expect(bytes.includes('OpusHead')).toBe(true);
      const streams: string[]=[];
      for(let at=0;at<bytes.length;){
        const segments=bytes[at+26]!,body=at+27+segments;
        if(bytes[at+5]!&2)streams.push(bytes.subarray(body,body+8).toString());
        let length=0;for(let i=0;i<segments;i++)length+=bytes[at+27+i]!;
        at=body+length;
      }
      expect(streams).toEqual(['OpusHead']);
      expect(bytes.length).toBe(file.bytes);total+=bytes.length;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.runtime_sha256);
    }
    expect(total).toBe(manifest.total_bytes); expect(total).toBeLessThan(600000);
  });
});
