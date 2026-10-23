import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DemoStore} from '../server/store.js';
import {createServer} from '../server.js';
test('HTTP two devices, idempotent retry, stale move, persisted restart and API safeguards',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'neeb20-test-')),path=join(directory,'demo.sqlite');let store=new DemoStore(path);const server=createServer(store);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const read=async()=>{const r=await fetch(base+'/api/state');assert.equal(r.status,200);return (await r.json()).state;};
 const post=async(command,actorId='staff-01')=>{const r=await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,actorId})});return {status:r.status,body:await r.json()};};
 try{
  const [a,b]=await Promise.all([post({id:'device-a',type:'start',payload:{station_id:1},expectedRevision:0}),post({id:'device-b',type:'start',payload:{station_id:1},expectedRevision:0})]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);let state=await read();assert.equal(state.sessions.length,1);assert.equal(state.bills.length,1);
  const winner=a.status===200?'device-a':'device-b';assert.equal((await post({id:winner,type:'start',payload:{station_id:1},expectedRevision:0})).body.replayed,true);
  const s=state.sessions[0],deadline=s.endsAt;
  const move={id:'move',type:'move',payload:{session_id:s.session_id,expectedStationId:1,targetStationId:3,reason:'ทดสอบย้าย'},expectedRevision:state.revision};
  assert.equal((await post(move)).status,200);
  assert.equal((await post({id:'stale-finish',type:'finish',payload:{session_id:s.session_id,expectedStationId:1},expectedRevision:state.revision})).status,409);
  state=await read();assert.equal(state.transactions.length,0);assert.equal(state.sessions[0].endsAt,deadline);assert.equal(state.stations[2].session_id,s.session_id);
  assert.equal((await fetch(base+'/.data/demo.sqlite')).status,404);
  assert.equal((await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await post({id:'staff-refund',type:'refund',payload:{session_id:s.session_id,reason:'test',amountSatang:100},expectedRevision:state.revision})).status,403);
  const before=structuredClone(state);await new Promise(resolve=>server.close(resolve));store.close();store=new DemoStore(path);assert.deepEqual(store.read(),before);
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));store.close();await rm(directory,{recursive:true,force:true});}
});
test('independent SQLite connections enforce fresh revision within transaction',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'neeb20-two-connections-')),path=join(directory,'demo.sqlite');
 const first=new DemoStore(path),second=new DemoStore(path);
 try{
  const stale=second.read().revision;
  first.dispatch({id:'one',type:'start',payload:{station_id:1},expectedRevision:0},'staff-01');
  assert.throws(()=>second.dispatch({id:'two',type:'start',payload:{station_id:1},expectedRevision:stale},'staff-01'),/ข้อมูลเปลี่ยน/);
  assert.equal(second.read().sessions.length,1);assert.equal(second.read().stations[0].session_id,first.read().sessions[0].session_id);
 }finally{first.close();second.close();await rm(directory,{recursive:true,force:true});}
});
