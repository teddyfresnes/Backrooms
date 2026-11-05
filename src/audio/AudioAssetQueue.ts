/** Fetch/decode budgets are shared by all audio users, including menu and scene
 * preparation. Immutable encoded bytes survive a runtime replacement; decoded
 * buffers are shared only inside their owning context. */
const encoded = new Map<string, Promise<ArrayBuffer>>();
const decoded = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer>>>();
let active = 0;
const waiting: Array<()=>void> = [];
async function budget<T>(work:()=>Promise<T>):Promise<T> {
  if(active>=3)await new Promise<void>(resolve=>waiting.push(resolve));
  else active++;
  try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}
}
export function loadAudioAsset(context:AudioContext,url:string,signal?:AbortSignal):Promise<AudioBuffer> {
  let cache=decoded.get(context);if(!cache){cache=new Map();decoded.set(context,cache);}
  const existing=cache.get(url);if(existing)return existing;
  const pending=budget(async()=>{
    signal?.throwIfAborted();
    let bytes=encoded.get(url);
    if(!bytes){
      bytes=fetch(url,{signal:AbortSignal.timeout(30000)}).then(response=>{if(!response.ok)throw new Error(`Audio unavailable: ${url}`);return response.arrayBuffer();});
      encoded.set(url,bytes);void bytes.catch(()=>encoded.delete(url));
    }
    const data=await bytes;signal?.throwIfAborted();
    const buffer=await context.decodeAudioData(data.slice(0));signal?.throwIfAborted();return buffer;
  });
  cache.set(url,pending);void pending.catch(()=>cache!.delete(url));return pending;
}
