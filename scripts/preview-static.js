import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function createStaticPreview(){
 const root=new URL('../static-site/',import.meta.url),allowed=new Set(await readdir(root)),mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};
 return http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,name=path==='/'?'index.html':path.slice(1);if(!['GET','HEAD'].includes(req.method)||!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)]||'application/octet-stream','Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'"});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(500);res.end('Build static-site first');}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=await createStaticPreview();server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`Browser-only preview: http://127.0.0.1:${server.address().port} (test data stored on THIS browser only)`));}
