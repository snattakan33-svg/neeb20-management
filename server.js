import http from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DemoStore} from './server/store.js';
const files = {'/':'index.html','/src/app.js':'src/app.js','/src/domain.js':'src/domain.js','/src/style.css':'src/style.css','/NEEB20-DEMO.html':'NEEB20-DEMO.html'};
const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
export function createServer(store){
  return http.createServer(async (req,res) => {
    const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname.startsWith('/api/')){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){send(403,{error:'ไม่อนุญาตคำสั่งข้ามเว็บไซต์'});return;}
        if(pathname==='/api/state'&&req.method==='GET'){send(200,{state:store.read(),mode:'server-demo'});return;}
        if(pathname==='/api/commands'&&req.method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json')){send(415,{error:'ต้องใช้ JSON'});return;}
          let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>32000){send(413,{error:'คำสั่งใหญ่เกินไป'});return;}body+=chunk;}
          let input;try{input=JSON.parse(body);}catch{send(400,{error:'JSON ไม่ถูกต้อง'});return;}
          if(!input||typeof input!=='object'){send(400,{error:'คำสั่งไม่ถูกต้อง'});return;}
          const result=store.dispatch(input.command,input.actorId);send(200,result);return;
        }
        send(404,{error:'ไม่พบ API'});return;
      }
      if(!['GET','HEAD'].includes(req.method)){send(405,{error:'Method not allowed'});return;}
      const file=files[pathname];if(!file){send(404,{error:'Not found'});return;}
      const body=await readFile(new URL(file,import.meta.url));res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){send(e.code==='FORBIDDEN'?403:e.code==='CONFLICT'?409:e.code==='INVALID'?400:500,{error:e.code?e.message:'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองคำสั่งเดิมอีกครั้ง',code:e.code||'SERVER'});}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=new URL('./.data/',import.meta.url);await mkdir(directory,{recursive:true});
  const store=new DemoStore(process.env.NEEB20_DEMO_DB||fileURLToPath(new URL('demo.sqlite',directory)));
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  const server=createServer(store);server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port already in use. Stop the old server or select another PORT.':e.message);store.close();process.exitCode=1;});
  server.listen(port,host,()=>console.log(`NEEB20 SERVER DEMO: http://${host}:${port} (test data only; demo roles are NOT authentication)`));
}
