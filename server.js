import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = {'/':'index.html','/src/app.js':'src/app.js','/src/domain.js':'src/domain.js','/src/style.css':'src/style.css'};
const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
http.createServer(async (req,res) => {
  const file = files[new URL(req.url,'http://localhost').pathname];
  if (!file) {res.writeHead(404); res.end('Not found'); return;}
  try { const body=await readFile(new URL(file,import.meta.url)); res.writeHead(200,{'Content-Type':types[file.split('.').pop()], 'Cache-Control':'no-store'}); res.end(body); }
  catch {res.writeHead(500);res.end('Unable to load application');}
}).listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('NEEB20 demo listening on port '+(process.env.PORT || 3000)));
