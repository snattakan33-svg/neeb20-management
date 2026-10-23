import {spawn} from 'node:child_process';
const port=process.env.PORT||'3000';
if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('PORT must be between 1 and 65535');
const url=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),stdio:['inherit','pipe','inherit']});
let output='',opened=false;
child.stdout.on('data',chunk=>{
 process.stdout.write(chunk);output=(output+chunk).slice(-2000);
 if(!opened&&output.includes('NEEB20 SERVER DEMO:')){
  opened=true;console.log(`Open in Edge/Chrome: ${url}`);
  if(process.platform==='win32'){
   const opener=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true});
   opener.on('error',()=>console.log(`Please open ${url} manually.`));
  }
 }
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
