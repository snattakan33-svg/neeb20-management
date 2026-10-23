import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
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
  const [a,b]=await Promise.all([post({id:'device-a',type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:0}),post({id:'device-b',type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:0})]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);let state=await read();assert.equal(state.sessions.length,1);assert.equal(state.bills.length,1);
  const winner=a.status===200?'device-a':'device-b';assert.equal((await post({id:winner,type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:0})).body.replayed,true);
  const s=state.sessions[0],deadline=s.endsAt;
  const move={id:'move',type:'move',payload:{session_id:s.session_id,expectedStationId:1,targetStationId:3,reason:'ทดสอบย้าย'},expectedRevision:state.revision};
  assert.equal((await post(move)).status,200);
  assert.equal((await post({id:'stale-finish',type:'finish',payload:{session_id:s.session_id,expectedStationId:1},expectedRevision:state.revision})).status,409);
  state=await read();assert.equal(state.transactions.length,0);assert.equal(state.sessions[0].endsAt,deadline);assert.equal(state.stations[2].session_id,s.session_id);
  assert.equal(state.transactions.length,0);
  const payment={id:'pay-bill-a',type:'payBill',payload:{session_id:s.session_id,expectedStationId:3,method:'cash',paymentConfirmed:true},expectedRevision:state.revision};
  const [paidA,paidB]=await Promise.all([post(payment),post({...payment,id:'pay-bill-b'})]);assert.deepEqual([paidA.status,paidB.status].sort(),[200,409]);state=await read();assert.equal(state.receipts.length,1);assert.equal(state.transactions.length,1);
  const report=await (await fetch(base+'/api/reports')).json();assert.equal(report.summary.base,2000);assert.equal(report.summary.cash.received,2000);assert.equal(report.transactions.length,1);
  assert.equal((await fetch(base+'/api/reports?mode=daily&day=2026-02-30')).status,400);
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
  first.dispatch({id:'one',type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:0},'staff-01');
  assert.throws(()=>second.dispatch({id:'two',type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:stale},'staff-01'),/ข้อมูลเปลี่ยน/);
  assert.equal(second.read().sessions.length,1);assert.equal(second.read().stations[0].session_id,first.read().sessions[0].session_id);
 }finally{first.close();second.close();await rm(directory,{recursive:true,force:true});}
});
test('session bill payment, inventory, refund and command IDs survive database reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'neeb20-prepaid-persist-')),path=join(directory,'demo.sqlite');let store=new DemoStore(path);
 try{
  let seq=0;const run=(type,payload,actor='staff-01')=>store.dispatch({id:`persist-${++seq}`,type,payload,expectedRevision:store.read().revision},actor);
  const start={id:'persistent-start',type:'start',payload:{station_id:1,method:'qr',paymentConfirmed:true},expectedRevision:0};const outcome=store.dispatch(start,'staff-01');
  const id=outcome.result.session_id;run('extend',{session_id:id,expectedStationId:1});run('payBill',{session_id:id,expectedStationId:1,method:'cash',paymentConfirmed:true});run('addCart',{product_id:'p1'});run('checkout',{method:'qr',paymentConfirmed:true});
  const productTx=store.read().transactions.find(t=>t.category==='product');run('returnProduct',{transaction_id:productTx.id,quantity:1,restock:true,reason:'คืนทดสอบ',method:'qr',refundConfirmed:true},'manager-01');
  const before=store.read();store.close();store=new DemoStore(path);assert.deepEqual(store.read(),before);assert.equal(store.dispatch(start,'staff-01').replayed,true);assert.equal(store.read().sessions[0].endsAt,before.sessions[0].endsAt);assert.equal(store.read().transactions.length,4);assert.equal(store.read().products[0].stock,20);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
test('server upgrades v2 SQLite once without erasing old records or inventing money',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'neeb20-upgrade-')),path=join(directory,'demo.sqlite');let store=new DemoStore(path);
 try{
  const legacy=store.read();legacy.version=2;legacy.transactions=[{id:'legacy-receipt-payment',type:'payment',amountSatang:2000,at:1000,bill_id:null,session_id:null}];delete legacy.stockMovements;
  store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(legacy));store.close();store=new DemoStore(path);const migrated=store.read();assert.equal(migrated.version,4);assert.deepEqual(migrated.transactions,legacy.transactions);assert.deepEqual(migrated.schemaArchives.at(-1).state,legacy);
  store.close();store=new DemoStore(path);assert.deepEqual(store.read(),migrated);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});

test('occupied port never upgrades or mutates the database of an already running app',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'neeb20-port-conflict-')),path=join(directory,'demo.sqlite');
 const seed=new DemoStore(path),old=seed.read();old.version=2;delete old.stockMovements;seed.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(old));seed.close();
 const occupantStore=new DemoStore(),occupied=createServer(occupantStore);await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 try{
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(occupied.address().port),HOST:'127.0.0.1',NEEB20_DEMO_DB:path},stdio:'pipe'});
  let error='';child.stderr.on('data',chunk=>error+=chunk);assert.equal(await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);}),1);assert.match(error,/Port already in use/);
  const raw=new DatabaseSync(path);try{assert.deepEqual(JSON.parse(raw.prepare('SELECT body FROM demo_state WHERE id=1').get().body),old);}finally{raw.close();}
 }finally{await new Promise(resolve=>occupied.close(resolve));occupantStore.close();await rm(directory,{recursive:true,force:true});}
});
