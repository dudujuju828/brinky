import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
const size=256, data=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const o=y*(size*4+1)+1+x*4;
  const circle=(cx,cy,r)=>Math.hypot(x-cx,y-cy)<r;
  let color=[0,0,0,0];
  if(circle(128,128,121))color=[49,92,73,255];
  if(((x-128)/76)**4+((y-126)/73)**4<1)color=[244,142,114,255];
  if(((x-103)/8)**2+((y-126)/16)**2<1||((x-153)/8)**2+((y-126)/16)**2<1)color=[57,59,46,255];
  color.forEach((v,i)=>data[o+i]=v);
}
function crc(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc(Buffer.concat([name,bytes])));return Buffer.concat([len,name,bytes,sum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
await writeFile('renderer/brinky.png',png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
await writeFile('renderer/brinky.ico',Buffer.concat([ico,png]));
