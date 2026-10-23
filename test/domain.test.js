import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute,status,sessionAt,finance,billLines,billStatus,salesSummary,cartLines,total,migrateLegacy,upgradeState,validateState} from '../src/domain.js';
function fixture(){let state=createDemo(),seq=0,now=1000;return {get state(){return state;},time(t){now=t;},run(type,payload={},actor='staff-01',id=`command-${++seq}`,revision=state.revision){if(['payBill','checkout'].includes(type))payload={method:'cash',paymentConfirmed:true,...payload};const result=execute(state,{id,type,payload,expectedRevision:revision},actor,now);state=result.state;return result;},start(station_id=1){return this.run('start',{station_id}).result.session_id;},s(id){return state.sessions.find(s=>s.session_id===id);},base(id){return {session_id:id,expectedStationId:this.s(id).station_id};},pay(id,p={}){return this.run('payBill',{...this.base(id),...p});},product(id,product_id='p1',quantity=1){return this.run('addBillProduct',{...this.base(id),product_id,quantity});}};}
test('12 stations start immediately with one UNPAID bill, no money, exact persisted deadline',()=>{
 const f=fixture(),id=f.start();assert.equal(f.state.stations.length,12);assert.equal(f.state.sessions.length,1);assert.equal(f.state.bills.length,1);assert.equal(f.state.bills[0].status,'UNPAID');assert.equal(f.state.transactions.length,0);assert.equal(f.s(id).endsAt,1501000);assert.equal(finance(f.state,f.s(id).bill_id).due,2000);assert.equal(billLines(f.state,f.s(id).bill_id)[0].name,'ค่าบริการหนีบ20');
 const restored=validateState(JSON.parse(JSON.stringify(f.state)));assert.equal(sessionAt(restored,1).endsAt,1501000);assert.equal(status(f.s(id),1201000),'warning');assert.equal(status(f.s(id),1501000),'expired');assert.equal(f.state.stations[0].session_id,id);assert.throws(()=>f.start(1),/มีคิว/);
});
test('start/extension idempotency: same session, bill, +5 minutes/5 baht with no receipt',()=>{
 const f=fixture();const result=f.run('start',{station_id:1},'staff-01','start');f.run('start',{station_id:1},'staff-01','start',0);const id=result.result.session_id,end=f.s(id).endsAt;
 f.run('extend',f.base(id),'staff-01','extend');f.run('extend',f.base(id),'staff-01','extend',0);assert.equal(f.s(id).endsAt,end+300000);assert.equal(f.s(id).feeSatang,2500);assert.equal(f.state.bills.length,1);assert.equal(f.state.receipts.length,0);assert.equal(salesSummary(f.state).net,0);
});
test('example 20+5+29+10=64: same Bill/Session, stock deducted only at one payment',()=>{
 const f=fixture(),id=f.start(),bill=f.s(id).bill_id;f.run('extend',f.base(id));f.product(id);
 f.run('addProduct',{sku:'WATER',name:'น้ำทดสอบ',category:'เครื่องดื่ม',barcode:'',cost:5,price:10,stock:5},'manager-01');const water=f.state.products.at(-1);f.product(id,water.id);
 assert.equal(finance(f.state,bill).charged,6400);assert.equal(salesSummary(f.state).net,0);assert.equal(f.state.products[0].stock,20);assert.equal(water.stock,5);
 const paid=f.pay(id,{method:'qr'});assert.ok(paid.result.transaction_id);assert.equal(f.state.receipts.length,1);assert.equal(f.state.receipts[0].total,64);assert.equal(f.state.bills.length,1);assert.equal(f.state.bills[0].status,'PAID');assert.equal(f.state.bills[0].paidAt,1000);assert.equal(f.state.bills[0].paidBy,'staff-01');assert.equal(f.state.bills[0].paymentMethod,'qr');assert.equal(f.state.transactions.length,4);assert.ok(f.state.transactions.every(t=>t.bill_id===bill&&t.session_id===id&&t.payment_id===paid.result.transaction_id));assert.equal(f.state.products[0].stock,19);assert.equal(f.state.products.at(-1).stock,4);assert.equal(salesSummary(f.state).net,6400);
});
test('move 01 to 05 keeps entire 49-baht bill, session, products and deadline',()=>{
 const f=fixture(),id=f.start();f.product(id);const bill=structuredClone(f.state.bills[0]),end=f.s(id).endsAt;f.run('move',{...f.base(id),targetStationId:5,reason:'เก้าอี้เสีย'});
 assert.deepEqual(f.state.bills[0],bill);assert.equal(f.s(id).endsAt,end);assert.equal(f.state.stations[0].session_id,null);assert.equal(f.state.stations[4].session_id,id);assert.equal(f.state.sessions.length,1);assert.equal(finance(f.state,bill.id).charged,4900);assert.equal(f.state.transactions.length,0);assert.equal(f.state.audit.at(-1).before.station_id,1);assert.equal(f.state.audit.at(-1).after.station_id,5);
});
test('occupied move / stale station command rejected without changing anything',()=>{
 const f=fixture(),id=f.start();f.start(3);const before=structuredClone(f.state);assert.throws(()=>f.run('move',{...f.base(id),targetStationId:3,reason:'ทดสอบ'}));assert.deepEqual(f.state,before);
 f.run('move',{...f.base(id),targetStationId:2,reason:'ทดสอบ'});assert.throws(()=>f.run('extend',{session_id:id,expectedStationId:1}),/คิวถูกย้าย/);
});
test('unpaid finish blocked; paid finish and repeated finish never create payments/bills',()=>{
 const f=fixture(),id=f.start();assert.throws(()=>f.run('finish',f.base(id)),/ยังไม่ได้ชำระ/);assert.equal(f.state.stations[0].session_id,id);assert.equal(f.state.transactions.length,0);
 f.pay(id);const transactions=structuredClone(f.state.transactions),receipts=structuredClone(f.state.receipts);f.run('finish',f.base(id),'staff-01','finish');f.run('finish',f.base(id),'staff-01','finish',0);f.run('finish',f.base(id));assert.equal(f.state.stations[0].session_id,null);assert.equal(f.state.bills.length,1);assert.deepEqual(f.state.transactions,transactions);assert.deepEqual(f.state.receipts,receipts);
});
test('one payment cannot be recorded again by replay, new key or two stale devices',()=>{
 const f=fixture(),id=f.start(),payload={...f.base(id),method:'cash'},revision=f.state.revision;f.run('payBill',payload,'staff-01','pay');const before=structuredClone(f.state);f.run('payBill',payload,'staff-01','pay',revision);assert.deepEqual(f.state,before);
 assert.throws(()=>f.run('payBill',payload,'staff-01','second',revision),/ข้อมูลเปลี่ยน/);assert.throws(()=>f.run('payBill',payload),/ชำระแล้ว/);assert.equal(salesSummary(f.state).net,2000);assert.equal(f.state.receipts.length,1);assert.throws(()=>f.run('payBill',{...payload,method:'qr'},'staff-01','pay'),/เนื้อหาต่างกัน/);
});
test('payment requires method and explicit confirmation; rejection changes no money/stock',()=>{
 const f=fixture(),id=f.start();f.product(id);const before=structuredClone(f.state);assert.throws(()=>f.pay(id,{paymentConfirmed:false}));assert.throws(()=>f.pay(id,{method:'bank'}));assert.deepEqual(f.state,before);
});
test('unpaid cancel frees station, keeps bill/history, no revenue or inventory change',()=>{
 const f=fixture(),id=f.start();f.product(id,'p1',2);const stock=f.state.products[0].stock;assert.throws(()=>f.run('cancelUnpaid',{...f.base(id),reason:''}));const payload={...f.base(id),reason:'ลูกค้าไม่ใช้แล้ว'};
 f.run('cancelUnpaid',payload,'staff-01','cancel');f.run('cancelUnpaid',payload,'staff-01','cancel',0);f.run('cancelUnpaid',payload);assert.equal(f.state.bills[0].status,'CANCELLED');assert.equal(f.state.bills[0].charges.length,2);assert.equal(f.state.stations[0].session_id,null);assert.equal(f.state.products[0].stock,stock);assert.equal(salesSummary(f.state).net,0);assert.equal(f.state.audit.at(-1).reason,payload.reason);
});
test('paid cancellation needs manager, original sale retained, refund linked and never repeated',()=>{
 const f=fixture(),id=f.start();f.product(id);f.pay(id);const original=structuredClone(f.state.transactions);assert.throws(()=>f.run('cancelUnpaid',{...f.base(id),reason:'ยกเลิก'}),/ผู้จัดการ/);
 f.run('requestCancel',{...f.base(id),reason:'ยกเลิกหลังจ่าย'});const p={session_id:id,reason:'อนุมัติคืนเต็ม',unused:false,refundAmountSatang:4900,method:'cash',refundConfirmed:true};assert.throws(()=>f.run('approveCancel',p),/ผู้จัดการ/);f.run('approveCancel',p,'manager-01','cancel-paid');f.run('approveCancel',p,'manager-01','cancel-paid',0);f.run('approveCancel',p,'manager-01');
 assert.equal(f.state.bills[0].status,'REFUNDED');assert.equal(salesSummary(f.state).net,0);assert.deepEqual(f.state.transactions.filter(t=>t.type==='payment'),original);assert.ok(f.state.transactions.filter(t=>t.type==='refund').every(t=>original.some(p=>p.id===t.original_transaction_id)));assert.equal(f.state.receipts.length,1);
 const productTx=original.find(t=>t.category==='product');assert.throws(()=>f.run('returnProduct',{transaction_id:productTx.id,quantity:1,restock:true,reason:'ห้ามคืนเงินซ้ำ',method:'cash',refundConfirmed:true},'manager-01'),/คืนไปแล้ว/);
});
test('restore keeps expired deadline and paid bill, never creates a new sale',()=>{
 const f=fixture(),id=f.start(),end=f.s(id).endsAt;f.pay(id);f.run('finish',f.base(id));f.time(end+1000);assert.throws(()=>f.run('restore',{session_id:id,targetStationId:1,reason:'จบผิด'}),/ผู้จัดการ/);
 f.run('restore',{session_id:id,targetStationId:1,reason:'จบผิด'},'manager-01');assert.equal(status(f.s(id),end+1000),'expired');assert.equal(f.state.bills.length,1);assert.equal(f.state.transactions.length,1);assert.equal(f.s(id).endsAt,end);
});
test('paid and refunded bills are immutable, so paid total never changes silently',()=>{
 const f=fixture(),id=f.start();f.pay(id);assert.throws(()=>f.run('extend',f.base(id)),/บิลชำระแล้ว/);assert.throws(()=>f.product(id),/บิลชำระแล้ว/);assert.equal(f.s(id).feeSatang,2000);assert.equal(f.state.bills[0].status,'PAID');
});
test('two open bills may request last stock; payment checks aggregated stock and rolls back completely',()=>{
 const f=fixture();f.run('adjustStock',{product_id:'p1',quantityDelta:-19,reason:'ตั้งค่าสต๊อกทดสอบ'},'manager-01');const a=f.start(1),b=f.start(2);f.product(a);f.product(b);assert.equal(f.state.products[0].stock,1);f.pay(a);
 const before=structuredClone(f.state);assert.throws(()=>f.pay(b),/สต๊อกไม่เพียงพอ/);assert.deepEqual(f.state,before);assert.equal(f.state.stations[1].session_id,b);assert.equal(billStatus(f.state,f.s(b).bill_id),'UNPAID');assert.equal(salesSummary(f.state).net,4900);
 const line=billLines(f.state,f.s(b).bill_id).find(l=>l.kind==='product');f.run('removeBillProduct',{...f.base(b),charge_id:line.id,reason:'สินค้าหมด'});f.pay(b);assert.equal(salesSummary(f.state).net,6900);assert.equal(f.state.bills.find(x=>x.id===f.s(b).bill_id).charges.find(c=>c.id===line.id).voided,true);
});
test('multi-quantity product lines aggregate stock requirements and keep price snapshots',()=>{
 const f=fixture(),id=f.start();f.product(id,'p1',2);f.product(id,'p1',2);assert.equal(finance(f.state,f.s(id).bill_id).charged,13600);
 const p=f.state.products[0];f.run('editProduct',{...p,product_id:p.id,price:40},'manager-01');f.pay(id);assert.equal(f.state.products[0].stock,16);assert.equal(f.state.receipts[0].total,136);assert.equal(f.state.transactions.filter(t=>t.category==='product').reduce((n,t)=>n+t.amountSatang,0),11600);
});
test('catalog, POS-only bills, receive/adjust/return stock and original payment references remain functional',()=>{
 const f=fixture(),p={sku:'NEW',name:'สินค้าทดสอบใหม่',category:'ทดสอบ',barcode:'ABC',cost:10,price:15,stock:2};assert.throws(()=>f.run('addProduct',p),/ผู้จัดการ/);f.run('addProduct',p,'manager-01');const id=f.state.products.at(-1).id;
 f.run('receiveStock',{product_id:id,quantityDelta:3,reason:'รับเข้า'});f.run('adjustStock',{product_id:id,quantityDelta:-1,reason:'เสีย'},'manager-01');f.run('setProductActive',{product_id:id,active:false,reason:'พักขาย'},'manager-01');assert.throws(()=>f.run('addCart',{product_id:id}),/ไม่เปิดขาย/);f.run('setProductActive',{product_id:id,active:true,reason:'เปิด'},'manager-01');
 f.run('addCart',{product_id:id});f.run('checkout',{method:'qr'});const tx=f.state.transactions[0];assert.equal(f.state.bills[0].type,'pos');assert.equal(f.state.bills[0].status,'PAID');assert.equal(tx.bill_id,f.state.bills[0].id);
 const ret={transaction_id:tx.id,quantity:1,restock:true,reason:'คืนสินค้า',method:'qr',refundConfirmed:true};f.run('returnProduct',ret,'manager-01','return');f.run('returnProduct',ret,'manager-01','return',0);assert.equal(f.state.products.at(-1).stock,4);assert.equal(f.state.bills[0].status,'REFUNDED');assert.equal(salesSummary(f.state).net,0);assert.equal(f.state.stockMovements.at(-1).transaction_id,f.state.transactions.at(-1).id);
});
test('v3 upgrade preserves prepaid money, receipt and deadline instead of charging 20 again',()=>{
 const f=fixture(),id=f.start();f.pay(id);const old=structuredClone(f.state);old.version=3;delete old.bills[0].status;const copy=structuredClone(old),upgraded=upgradeState(old);assert.equal(upgraded.version,4);assert.deepEqual(upgraded.transactions,copy.transactions);assert.deepEqual(upgraded.receipts,copy.receipts);assert.equal(upgraded.sessions[0].endsAt,copy.sessions[0].endsAt);assert.equal(upgraded.bills[0].status,'PAID');assert.deepEqual(upgraded.schemaArchives.at(-1).state,copy);assert.deepEqual(old,copy);
});
test('v1 migration keeps complete archive and unpaid service, no invented financial transactions',()=>{
 const old={version:1,stations:Array.from({length:12},(_,i)=>({id:i+1,session:i===0?{id:'old-active',startedAt:100,endsAt:9999,extensions:1}:null})),products:createDemo().products,cart:[],receipts:[{id:'old-receipt',total:29}]};const migrated=migrateLegacy(old);assert.equal(sessionAt(migrated,1).endsAt,9999);assert.equal(migrated.bills[0].status,'UNPAID');assert.deepEqual(migrated.legacyArchive,old);assert.equal(migrated.transactions.length,0);
});
test('one Session cannot have two main bills',()=>{
 const f=fixture();f.start();const invalid=structuredClone(f.state);invalid.bills.push({...invalid.bills[0],id:'duplicate-main'});assert.throws(()=>validateState(invalid));
});
