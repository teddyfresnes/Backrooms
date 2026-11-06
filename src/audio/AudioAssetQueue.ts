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
/** The deadline covers only an unanswered request. A body still arriving while
 * scene preparation keeps the main thread busy is progress, not a stall; a
 * fixed whole-download timeout aborted healthy loads after a long freeze. */
async function fetchAudioBytes(url:string):Promise<ArrayBuffer>{
  let failure:unknown;
  for(let attempt=0;attempt<2;attempt++){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(new DOMException('Audio request stalled','TimeoutError')),30000);
    try{
      const response=await fetch(url,{signal:abort.signal,...(attempt?{cache:'reload' as const}:{})});
      clearTimeout(timer);
      if(!response.ok)throw new Error(`Audio unavailable: ${url}`);
      return await response.arrayBuffer();
    }catch(error){failure=error;}
    finally{clearTimeout(timer);}
  }
  throw failure;
}
export function loadAudioAsset(context:AudioContext,url:string,signal?:AbortSignal):Promise<AudioBuffer> {
  let cache=decoded.get(context);if(!cache){cache=new Map();decoded.set(context,cache);}
  const existing=cache.get(url);if(existing)return existing;
  const pending=budget(async()=>{
    signal?.throwIfAborted();
    let bytes=encoded.get(url);
    if(!bytes){
      bytes=fetchAudioBytes(url);
      encoded.set(url,bytes);void bytes.catch(()=>encoded.delete(url));
    }
    const data=await bytes;signal?.throwIfAborted();
    const buffer=await context.decodeAudioData(data.slice(0));signal?.throwIfAborted();return buffer;
  });
  cache.set(url,pending);void pending.catch(()=>cache!.delete(url));return pending;
}
