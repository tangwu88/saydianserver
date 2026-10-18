// Explicit maintenance command: only public published product cover images, no credentials.
// Run manually from repo root after reviewing catalog changes; never run during CI/build.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sharp=createRequire(new URL('../apps/api/package.json',import.meta.url))('sharp');
const root=new URL('../apps/shop/src/static/catalog/',import.meta.url);
const base='https://app.saydian.cn/api/saidian-mall/v1';
const allowed=new Set(['app.saydian.cn','img10.360buyimg.com','images.sursung.com']);
const manifest=[];await mkdir(root,{recursive:true});
for(let page=1;page<=100;page++){
  const response=await fetch(`${base}/storefront/products?page=${page}&pageSize=24`,{signal:AbortSignal.timeout(15000),redirect:'error'});assert(response.ok,'Public catalog unavailable');const data=await response.json();assert(Array.isArray(data.items)&&Number.isSafeInteger(data.total));
  for(const product of data.items){
    if(!product.coverImage)continue;
    assert(/^[0-9a-f-]{36}$/i.test(product.id));const url=new URL(product.coverImage.replace(/^http:/,'https:'));assert(url.protocol==='https:'&&allowed.has(url.hostname)&&!url.username&&!url.password&&!url.port,'Unreviewed public image source');
    const image=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(image.ok&&/^image\//.test(image.headers.get('content-type')||''));const chunks=[];let size=0;for await(const chunk of image.body){size+=chunk.length;assert(size<=12_000_000,'Image too large');chunks.push(chunk);}const original=Buffer.concat(chunks);
    const thumbnail=await sharp(original,{limitInputPixels:40_000_000}).resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
    await writeFile(new URL(product.id+'.webp',root),thumbnail);manifest.push({id:product.id,source:product.coverImage,sourceSha256:createHash('sha256').update(original).digest('hex'),originalBytes:original.length,thumbnailBytes:thumbnail.length});
  }
  if(page*24>=data.total)break;
}
await writeFile(new URL('sources.json',root),JSON.stringify({verifiedAt:new Date().toISOString().slice(0,10),purpose:'Public catalog thumbnails; exact original image URL mapping only',images:manifest},null,2)+'\n');
await writeFile(new URL('../apps/shop/src/catalog-thumbnails.ts',import.meta.url),manifest.map((m,i)=>`import image${i} from './static/catalog/${m.id}.webp';`).join('\n')+'\nconst thumbnails: Record<string,string> = {\n'+manifest.map((m,i)=>`  ${JSON.stringify(m.source)}: image${i},`).join('\n')+'\n};\nexport function productThumbnail(source: string): string { return thumbnails[source] || source; }\n');
console.log(`Prepared ${manifest.length} public thumbnails. Review sources.json and the resulting diff before committing.`);
