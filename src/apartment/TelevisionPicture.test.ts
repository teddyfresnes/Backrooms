import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@dimforge/rapier3d',()=>({default:{}}));
import { TelevisionPicture } from './ApartmentDevices';
const pictures:TelevisionPicture[]=[];
afterEach(()=>{pictures.splice(0).forEach(p=>p.dispose());vi.unstubAllGlobals();});
function fixture(){
  const draw=vi.fn(),context=new Proxy({drawImage:draw,createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>k in o?o[k as keyof typeof o]:()=>{}}),images:{src:string;onload:null|(()=>void);onerror:null|(()=>void)}[]=[];
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>context})});
  vi.stubGlobal('Image',class{src='';onload=null;onerror=null;constructor(){images.push(this);}});
  const picture=new TelevisionPicture();pictures.push(picture);return{picture,draw,image:images[0]!};
}
it('draws the original local face only during Pressure, using the existing TV canvas texture',async()=>{
  const {picture,draw,image}=fixture();expect(image.src).toBe('/assets/apartment/tv-pressure-smile.webp');image.onload!();await picture.ready;
  draw.mockClear();picture.draw(1,false);expect(draw.mock.calls.some(c=>c[0]===image)).toBe(false);
  picture.draw(1,true);expect(draw.mock.calls.some(c=>c[0]===image)).toBe(true);expect(picture.canvas.width).toBe(256);expect(picture.canvas.height).toBe(192);
});
it('settles readiness and removes late load listeners when a session ends during image loading',async()=>{
  const {picture,image}=fixture();picture.dispose();await picture.ready;expect(image.onload).toBe(null);expect(image.onerror).toBe(null);
});
