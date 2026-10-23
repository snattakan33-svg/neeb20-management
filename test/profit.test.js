import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute,upgradeState} from '../src/domain.js';
import {makeProfitReport,profitCSV} from '../src/profit.js';
import {costVisibleState} from '../src/costing.js';
import {DemoStore} from '../server/store.js';
import {createServer} from '../server.js';
const day=Date.parse('2026-10-23T10:00:00+07:00'),mgr='manager-01';
const costs={materialsSatang:100,electricitySatang:100,waterSatang:0,laborSatang:500,otherSatang:0,commissionIncludedSatang:300};
function fixture(){let state=createDemo(),seq=0;return {get state(){return state;},set state(s){state=s;},run(type,payload={},actor='staff-01',at=day,id){const command={id:id||'p'+(++seq),type,payload,expectedRevision:state.revision};const r=execute(state,command,actor,at);state=r.state;return {command,...r.result};},report(input={mode:'all'}){return makeProfitReport(state,input,mgr,day+86400000);},start(){this.run('start',{station_id:1});return state.sessions.at(-1);},pay(s,at=day){this.run('payBill',{session_id:s.session_id,expectedStationId:1,method:'cash',paymentConfirmed:true},'staff-01',at);}};}
const editProduct=(f,cost,price=29)=>f.run('editProduct',{...f.state.products[0],product_id:'p1',cost,price},mgr);
test('service snapshot at start, product snapshot at payment, later price/cost edits never rewrite sale history',()=>{
 const f=fixture();f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);const s=f.start();f.run('addBillProduct',{session_id:s.session_id,expectedStationId:1,product_id:'p1',quantity:2});editProduct(f,16);f.run('editService',{service_id:'base',priceSatang:3000,cost:{...costs,laborSatang:900}},mgr);
 assert.equal(f.report().total.netRevenueSatang,0);f.pay(s);const tx=structuredClone(f.state.transactions),charges=structuredClone(f.state.bills[0].charges);editProduct(f,20,35);
 assert.deepEqual(f.state.transactions,tx);assert.deepEqual(f.state.bills[0].charges,charges);const r=f.report();assert.equal(r.product.costSatang,3200);assert.equal(r.service.costSatang,700);assert.equal(r.total.netRevenueSatang,7800);assert.equal(r.total.grossProfitSatang,3900);assert.equal(r.total.marginPercent,50);assert.equal(f.state.catalogHistory.length,4);
});
test('actual commission replaces included estimate exactly once, overrides append, retries idempotent',()=>{
 const f=fixture();f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);const s=f.start();f.pay(s);const tx=structuredClone(f.state.transactions),line=f.state.bills[0].charges[0];
 const change=f.run('recordServiceCost',{bill_id:s.bill_id,charge_id:line.id,actualCost:null,actualCommissionSatang:400,reason:'ยอดค่าคอมจริง'},mgr);assert.equal(f.report().service.costSatang,800);assert.equal(f.report().total.grossProfitSatang,1200);
 const replay=execute(f.state,change.command,mgr,day);assert.equal(replay.replayed,true);assert.equal(replay.state.costAdjustments.length,1);
 f.run('recordServiceCost',{bill_id:s.bill_id,charge_id:line.id,actualCost:null,actualCommissionSatang:200,reason:'แก้จากหลักฐาน'},mgr);assert.equal(f.report().service.costSatang,600);assert.deepEqual(f.state.transactions,tx);assert.equal(f.state.costAdjustments.length,2);
});
test('extension inherits service-time cost without duplicate commission or revenue; move/finish not profit',()=>{
 const f=fixture();f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);f.run('editService',{service_id:'extension',priceSatang:500,cost:{...costs,laborSatang:0,commissionIncludedSatang:0}},mgr);const s=f.start();f.run('extend',{session_id:s.session_id,expectedStationId:1});f.pay(s);const before=f.report().total;f.run('move',{session_id:s.session_id,expectedStationId:1,targetStationId:3,reason:'ย้าย'});f.run('finish',{session_id:s.session_id,expectedStationId:3});assert.deepEqual(f.report().total,before);assert.equal(before.netRevenueSatang,2500);assert.equal(before.costSatang,900);
});
test('physical product returns reverse original sale cost, money-only refunds retain COGS and can be losses',()=>{
 const f=fixture();f.run('addCart',{product_id:'p1'});f.run('addCart',{product_id:'p1'});f.run('checkout',{method:'qr',paymentConfirmed:true});const tx=f.state.transactions[0];editProduct(f,25);
 f.run('returnProduct',{transaction_id:tx.id,quantity:1,method:'qr',refundConfirmed:true,restock:true,reason:'รับกลับเข้าสต๊อก'},mgr);assert.equal(f.report().product.netRevenueSatang,2900);assert.equal(f.report().product.costSatang,1500);assert.equal(f.report().product.grossProfitSatang,1400);
 f.run('returnProduct',{transaction_id:tx.id,quantity:1,method:'qr',refundConfirmed:true,restock:false,reason:'สินค้าชำรุด'},mgr);assert.equal(f.report().product.netRevenueSatang,0);assert.equal(f.report().product.costSatang,1500);assert.equal(f.report().product.grossProfitSatang,-1500);assert.equal(f.report().product.marginPercent,null);
});
test('refund on later Bangkok day reverses revenue then, keeps service cost; explicit zero actual cost reverses unused service cost',()=>{
 const f=fixture();f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);const s=f.start();f.pay(s);f.run('refund',{session_id:s.session_id,amountSatang:2000,method:'cash',refundConfirmed:true,reason:'คืนเงิน'},mgr,day+86400000);
 assert.equal(f.report({mode:'daily',day:'2026-10-23'}).total.grossProfitSatang,1300);assert.equal(f.report({mode:'daily',day:'2026-10-24'}).total.grossProfitSatang,-2000);assert.equal(f.report().total.grossProfitSatang,-700);
 f.run('recordServiceCost',{bill_id:s.bill_id,charge_id:f.state.bills[0].charges[0].id,actualCost:Object.fromEntries(Object.keys(costs).map(k=>[k,0])),actualCommissionSatang:0,reason:'หลักฐานยังไม่ใช้วัสดุหรือแรงงาน'},mgr,day+86400000);assert.equal(f.report().total.grossProfitSatang,0);
});
test('unpaid cancellation has no revenue; explicitly recorded incurred costs remain as loss',()=>{
 const f=fixture(),s=f.start();f.run('cancelUnpaid',{session_id:s.session_id,expectedStationId:1,reason:'ลูกค้ายกเลิก'});assert.equal(f.report().total.grossProfitSatang,0);
 f.run('recordServiceCost',{bill_id:s.bill_id,charge_id:f.state.bills[0].charges[0].id,actualCost:costs,actualCommissionSatang:null,reason:'ใช้วัสดุจริงก่อนยกเลิก'},mgr);assert.equal(f.report().total.netRevenueSatang,0);assert.equal(f.report().total.grossProfitSatang,-700);
});
test('old unknown service costs are incomplete, not invented from current catalog; migration preserves all transaction history',()=>{
 const f=fixture(),s=f.start();f.pay(s);const old=structuredClone(f.state);delete old.services;delete old.costSchema;delete old.costAdjustments;delete old.transactions[0].costSnapshot;const original=structuredClone(old.transactions);f.state=upgradeState(old);f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);assert.deepEqual(f.state.transactions,original);assert.equal(f.report().service.complete,false);assert.equal(f.report().total.grossProfitSatang,null);assert.match(profitCSV(f.report()),/ต้นทุนไม่ครบ/);
});
test('daily, weekly, monthly and custom reports agree; operating expenses never reduce gross profit',()=>{
 const f=fixture();f.run('addCart',{product_id:'p1'});f.run('checkout',{method:'cash',paymentConfirmed:true});f.state.operatingExpenses.push({amountSatang:999999,category:'rent',at:day});const results=[{mode:'daily',day:'2026-10-23'},{mode:'weekly',week:'2026-W43'},{mode:'monthly',month:'2026-10'},{mode:'range',from:'2026-10-23',to:'2026-10-23'}].map(i=>f.report(i).total);for(const r of results)assert.deepEqual(r,results[0]);assert.equal(results[0].grossProfitSatang,1400);assert.ok(Math.abs(results[0].marginPercent-1400/2900*100)<1e-9);
});
test('staff cannot change service costs, actual commission or read profit; redaction covers all nested archives/commands',()=>{
 const f=fixture();assert.throws(()=>f.run('editService',{service_id:'base',priceSatang:2000,cost:costs}),{code:'FORBIDDEN'});assert.throws(()=>makeProfitReport(f.state,{},'staff-01'),{code:'FORBIDDEN'});assert.throws(()=>f.run('recordServiceCost',{}),{code:'FORBIDDEN'});
 f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);const s=f.start();f.pay(s);f.state.schemaArchives=[{state:structuredClone(f.state)}];const redacted=JSON.stringify(costVisibleState(f.state));assert.doesNotMatch(redacted,/unitCost|costSnapshot|materialsSatang|commissionIncludedSatang|catalogHistory|fingerprint|schemaArchives/);assert.equal(f.state.services[0].cost.materialsSatang,100);
});
test('API protects costs on GET, POST and reports; manager can read profit',async()=>{
 const store=new DemoStore(),f=fixture();f.run('editService',{service_id:'base',priceSatang:2000,cost:costs},mgr);const s=f.start();f.pay(s);store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(f.state));const server=createServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const url of ['/api/state','/api/reports?mode=all']){const response=await fetch(base+url);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/unitCost|costSnapshot|materialsSatang|fingerprint/);}assert.equal((await fetch(base+'/api/profit?mode=all')).status,403);const report=await fetch(base+'/api/profit?mode=all',{headers:{'X-NEEB20-Actor':mgr}});assert.equal(report.status,200);assert.equal((await report.json()).total.costSatang,700);
 const response=await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorId:'staff-01',command:{id:'http-finish',type:'finish',expectedRevision:f.state.revision,payload:{session_id:s.session_id,expectedStationId:1}}})});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/costSnapshot|materialsSatang|fingerprint/);
 }finally{await new Promise(r=>server.close(r));store.close();}
});
test('invalid cost, commission and staff sale-cost spoofing cannot change stored costs',()=>{
 const f=fixture();assert.throws(()=>f.run('editService',{service_id:'base',priceSatang:2000,cost:{...costs,commissionIncludedSatang:501}},mgr));const s=f.start();f.run('addBillProduct',{session_id:s.session_id,expectedStationId:1,product_id:'p1',quantity:1,unitCostSatang:0});f.pay(s);assert.equal(f.state.transactions.find(t=>t.category==='product').unitCostSatang,1500);
});
test('cost fixture is labeled and agrees with profit formula; snapshots and append-only actual costs survive SQLite restart',async()=>{
 const {createProfitScenario}=await import('../src/profit-scenarios.js');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'profit-store-'));let store;
 try{const state=createProfitScenario(day);assert.match(state.fixtureLabel,/ข้อมูลทดสอบ/);const r=makeProfitReport(state,{mode:'all'},mgr,day);assert.equal(r.total.netRevenueSatang,5400);assert.equal(r.total.costSatang,2400);assert.equal(r.total.grossProfitSatang,3000);
 store=new DemoStore(join(dir,'test.sqlite'));store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(state));store.close();store=null;store=new DemoStore(join(dir,'test.sqlite'));assert.deepEqual(store.read(),state);assert.deepEqual(makeProfitReport(store.read(),{mode:'all'},mgr,day),r);
 // Additive migration of older schema 5 writes catalog structure without touching money or history.
 const legacy=structuredClone(state);for(const k of ['services','costSchema','costAdjustments','catalogHistory'])delete legacy[k];store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(legacy));store.close();store=null;store=new DemoStore(join(dir,'test.sqlite'));assert.equal(store.read().costSchema,1);assert.deepEqual(store.read().transactions,state.transactions);assert.deepEqual(store.read().audit,state.audit);
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
