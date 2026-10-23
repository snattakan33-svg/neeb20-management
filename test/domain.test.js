import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute,status,sessionAt,finance,salesSummary,cartLines,total,migrateLegacy,validateState,upgradeState} from '../src/domain.js';
function fixture(){let state=createDemo(),seq=0;return {get state(){return state;},run(type,payload={},actor='staff-01',id=`command-${++seq}`,revision=state.revision){if(['start','extend','checkout'].includes(type))payload={method:'cash',paymentConfirmed:true,...payload};const result=execute(state,{id,type,payload,expectedRevision:revision},actor,1000);state=result.state;return result;},start(station_id=1){return this.run('start',{station_id}).result.session_id;},s(id){return state.sessions.find(s=>s.session_id===id);},base(id){return {session_id:id,expectedStationId:this.s(id).station_id};}};}
test('12 stations: persist exact deadline, warning, expiry, explicit finish, combined POS',()=>{
 const f=fixture(),id=f.start();assert.equal(f.state.stations.length,12);assert.equal(f.s(id).endsAt,1501000);
 const restored=validateState(JSON.parse(JSON.stringify(f.state)));assert.equal(sessionAt(restored,1).endsAt,1501000);
 assert.equal(status(f.s(id),1201000),'warning');assert.equal(status(f.s(id),1501000),'expired');assert.equal(f.s(id).serviceStatus,'active');
 f.run('finish',f.base(id));f.run('addCart',{product_id:'p1'});f.run('addCart',{product_id:'p1'});
 assert.equal(total(cartLines(f.state)),58);f.run('checkout');assert.equal(f.state.products[0].stock,18);assert.equal(f.state.receipts[1].total,58);assert.equal(f.state.receipts[1].lines.length,1);assert.equal(f.state.cart.length,0);
});
test('move 01 to 03 keeps same session, bill, deadline and no extra sales',()=>{
 const f=fixture(),id=f.start(),end=f.s(id).endsAt,bill=f.s(id).bill_id;
 f.run('move',{...f.base(id),targetStationId:3,reason:'ย้ายเพราะเก้าอี้เสีย'});
 assert.equal(f.state.stations[0].session_id,null);assert.equal(f.state.stations[2].session_id,id);assert.equal(f.s(id).endsAt,end);assert.equal(f.s(id).bill_id,bill);assert.equal(f.state.sessions.length,1);assert.equal(f.state.bills.length,1);assert.deepEqual(salesSummary(f.state),{received:2000,refunded:0,net:2000});
 const event=f.state.audit.at(-1);assert.equal(event.before.station_id,1);assert.equal(event.after.station_id,3);assert.equal(event.employee_id,'staff-01');assert.ok(event.reason);assert.ok(event.at);
});
test('occupied move and stale station finish rejected atomically',()=>{
 const f=fixture(),id=f.start();f.start(3);const before=structuredClone(f.state);
 assert.throws(()=>f.run('move',{...f.base(id),targetStationId:3,reason:'แก้จุด'}));assert.deepEqual(f.state,before);
 f.run('move',{...f.base(id),targetStationId:2,reason:'แก้จุด'});
 assert.throws(()=>f.run('finish',{session_id:id,expectedStationId:1}),/คิวถูกย้าย/);
});
test('duplicate finish never creates extra bill or sales, duplicate checkout is idempotent',()=>{
 const f=fixture(),id=f.start();f.run('finish',f.base(id),'staff-01','finish-key');f.run('finish',f.base(id),'staff-01','finish-key',0);f.run('finish',f.base(id));
 assert.equal(f.state.cart.length,0);assert.equal(f.state.bills.length,1);assert.equal(f.state.transactions.length,1);f.run('addCart',{product_id:'p1'});
 const revision=f.state.revision;f.run('checkout',{},'staff-01','pay-key');const after=structuredClone(f.state);f.run('checkout',{},'staff-01','pay-key',revision);
 assert.deepEqual(f.state,after);assert.equal(f.state.transactions.length,2);assert.equal(f.state.receipts.length,2);assert.equal(salesSummary(f.state).net,4900);
 assert.throws(()=>f.run('checkout'));assert.throws(()=>f.run('checkout',{changed:true},'staff-01','pay-key'),/เนื้อหาต่างกัน/);
});
test('wrong start cancellation requires reason and manager; history retained',()=>{
 const f=fixture(),id=f.start();assert.throws(()=>f.run('requestCancel',{...f.base(id),reason:''}));
 f.run('requestCancel',{...f.base(id),reason:'ไม่มีลูกค้า กดผิด'});
 assert.throws(()=>f.run('approveCancel',{session_id:id,reason:'ตรวจแล้ว'}),/ผู้จัดการ/);
 f.run('approveCancel',{session_id:id,reason:'ตรวจแล้ว ไม่มีลูกค้า',unused:true,refundAmountSatang:2000,method:'cash',refundConfirmed:true},'manager-01');
 assert.equal(f.s(id).serviceStatus,'cancelled');assert.equal(f.state.stations[0].session_id,null);assert.equal(finance(f.state,f.s(id).bill_id).status,'refund-full');assert.equal(f.state.transactions.length,2);
 assert.deepEqual(f.state.audit.map(e=>e.type),['start','payment','requestCancel','refund','cancel']);assert.equal(f.state.audit.at(-1).request.reason,'ไม่มีลูกค้า กดผิด');assert.equal(f.state.sessions.length,1);
});
test('manager restores original expired session and bill without resetting time or payments',()=>{
 const f=fixture(),id=f.start(),bill=f.s(id).bill_id,end=f.s(id).endsAt;f.run('finish',f.base(id));
 assert.throws(()=>f.run('restore',{session_id:id,targetStationId:1,reason:'จบผิด'}),/ผู้จัดการ/);
 f.start(1);assert.throws(()=>f.run('restore',{session_id:id,targetStationId:1,reason:'จบผิด'},'manager-01'),/ไม่ว่าง/);
 f.run('restore',{session_id:id,targetStationId:3,reason:'จบผิดคิว'},'manager-01');
 assert.equal(f.s(id).bill_id,bill);assert.equal(f.s(id).endsAt,end);assert.equal(status(f.s(id),end+1),'expired');assert.equal(f.state.bills.length,2);assert.equal(f.state.sessions.length,2);assert.equal(f.state.transactions.length,2);
 f.run('finish',f.base(id));assert.equal(f.state.cart.length,0);assert.equal(salesSummary(f.state).net,4000);
});
test('extension command replay adds only 5 minutes / 5 baht; paid bill gets linked supplement',()=>{
 const f=fixture(),id=f.start(),end=f.s(id).endsAt,bill=f.s(id).bill_id;
 f.run('extend',f.base(id),'staff-01','extend-key');f.run('extend',f.base(id),'staff-01','extend-key',0);
 assert.equal(f.s(id).endsAt,end+300000);assert.equal(f.s(id).feeSatang,2500);
 assert.equal(finance(f.state,bill).paid,2500);
 f.run('extend',f.base(id));const financial=finance(f.state,bill);assert.equal(financial.due,0);assert.equal(financial.paid,3000);assert.equal(f.state.bills.length,1);assert.equal(f.state.bills[0].charges.at(-1).supplemental,true);
 assert.equal(salesSummary(f.state).net,3000);assert.equal(finance(f.state,bill).due,0);
});
test('two stale devices cannot open two sessions on same station',()=>{
 const initial=createDemo(),a={id:'a',type:'start',payload:{station_id:1,method:'cash',paymentConfirmed:true},expectedRevision:0},b={...a,id:'b'};
 const first=execute(initial,a,'staff-01');assert.throws(()=>execute(first.state,b,'staff-01'),/ข้อมูลเปลี่ยน/);
 assert.throws(()=>execute(first.state,{...b,expectedRevision:first.state.revision},'staff-01'),/มีคิว/);assert.equal(first.state.sessions.length,1);
});
test('paid cancellation never refunds automatically; manager refund is separate, bounded and replay safe',()=>{
 const f=fixture(),id=f.start();
 f.run('requestCancel',{...f.base(id),reason:'ลูกค้าเปลี่ยนใจ'});const result=f.run('approveCancel',{session_id:id,reason:'อนุมัติ',unused:false,refundAmountSatang:0},'manager-01');assert.deepEqual(result.result.refund_transaction_ids,[]);assert.equal(salesSummary(f.state).net,2000);
 assert.throws(()=>f.run('refund',{session_id:id,amountSatang:500,reason:'คืนบางส่วน',method:'cash',refundConfirmed:true}),/ผู้จัดการ/);
 assert.throws(()=>f.run('refund',{session_id:id,amountSatang:2001,reason:'เกินยอด'},'manager-01'));
 f.run('refund',{session_id:id,amountSatang:500,reason:'คืนบางส่วน',method:'cash',refundConfirmed:true},'manager-01','refund-key');f.run('refund',{session_id:id,amountSatang:500,reason:'คืนบางส่วน',method:'cash',refundConfirmed:true},'manager-01','refund-key',0);
 assert.equal(finance(f.state,f.s(id).bill_id).status,'refund-partial');assert.equal(salesSummary(f.state).net,1500);
 f.run('refund',{session_id:id,amountSatang:1500,reason:'คืนส่วนที่เหลือ',method:'qr',refundConfirmed:true},'manager-01');assert.equal(finance(f.state,f.s(id).bill_id).status,'refund-full');assert.equal(salesSummary(f.state).net,0);assert.equal(f.state.receipts.length,1);
});
test('stock failure never partially commits inventory, transactions or receipts',()=>{
 const f=fixture();for(let i=0;i<20;i++)f.run('addCart',{product_id:'p1'});assert.throws(()=>f.run('addCart',{product_id:'p1'}),/เกินสต๊อก/);
 const corrupt=structuredClone(f.state);corrupt.products[0].stock=0;
 assert.throws(()=>execute(corrupt,{id:'pay',type:'checkout',payload:{method:'cash',paymentConfirmed:true},expectedRevision:corrupt.revision},'staff-01'),/เพียงพอ/);assert.equal(corrupt.transactions.length,0);assert.equal(corrupt.receipts.length,0);
});
test('v1 migration keeps active deadline, pending service cart and full immutable legacy archive',()=>{
 const old={version:1,stations:Array.from({length:12},(_,i)=>({id:i+1,session:i===0?{id:'old-active',startedAt:100,endsAt:9999,extensions:1}:null})),products:createDemo().products,cart:[{kind:'service',id:'old-finished',name:'หนีบจุด 2',price:20,quantity:1,startedAt:10,endsAt:20,finishedAt:30}],receipts:[{id:'old-paid',total:29,demo:true}]};
 const migrated=migrateLegacy(old);assert.equal(sessionAt(migrated,1).endsAt,9999);assert.equal(migrated.sessions.length,2);assert.equal(total(cartLines(migrated)),20);assert.deepEqual(migrated.legacyArchive,old);assert.equal(migrated.transactions.length,0);assert.equal(migrated.audit.length,2);assert.equal(old.version,1);
});
test('prepaid requires a method and explicit payment confirmation; failure creates nothing',()=>{
 const initial=createDemo();for(const payload of [{station_id:1},{station_id:1,method:'cash',paymentConfirmed:false},{station_id:1,method:'bank',paymentConfirmed:true}])assert.throws(()=>execute(initial,{id:'attempt',type:'start',payload,expectedRevision:0},'staff-01'));
 assert.equal(initial.sessions.length,0);assert.equal(initial.transactions.length,0);
 const f=fixture(),id=f.start(),before=structuredClone(f.state);assert.throws(()=>f.run('extend',{...f.base(id),paymentConfirmed:false}));assert.deepEqual(f.state,before);
});
test('unused cancellation refunds full amount atomically and cannot repeat even with a fresh command',()=>{
 const f=fixture(),id=f.start();f.run('requestCancel',{...f.base(id),reason:'ลูกค้ายังไม่ได้ใช้'});
 const payload={session_id:id,reason:'อนุมัติคืนเต็ม',unused:true,refundAmountSatang:2000,method:'qr',refundConfirmed:true};
 assert.throws(()=>f.run('approveCancel',{...payload,refundAmountSatang:1000},'manager-01'),/คืนเต็ม/);
 f.run('approveCancel',payload,'manager-01','cancel-full');const receipt=structuredClone(f.state.receipts[0]);f.run('approveCancel',payload,'manager-01','cancel-full',0);f.run('approveCancel',payload,'manager-01');
 assert.equal(salesSummary(f.state).net,0);assert.equal(f.state.transactions.length,2);assert.equal(f.state.stations[0].session_id,null);assert.deepEqual(f.state.receipts[0],receipt);assert.equal(f.state.transactions[1].original_transaction_id,f.state.transactions[0].id);
});
test('used service cannot be declared unused; partial cancellation refund is manager decision',()=>{
 const f=fixture(),id=f.start();f.run('markUsed',f.base(id));f.run('requestCancel',{...f.base(id),reason:'หยุดใช้แล้ว'});
 const p={session_id:id,reason:'คืนบางส่วนตามนโยบาย',unused:true,refundAmountSatang:2000,method:'cash',refundConfirmed:true};
 assert.throws(()=>f.run('approveCancel',p,'manager-01'),/มีประวัติ/);
 f.run('approveCancel',{...p,unused:false,refundAmountSatang:500},'manager-01');assert.equal(salesSummary(f.state).net,1500);assert.equal(f.s(id).usageIntervals[0].endedAt,1000);
});
test('catalog edits, inactive sales, receive/adjust stock, product return and audit references',()=>{
 const f=fixture(),p={sku:'TEST001',name:'สินค้าใหม่',category:'ทดสอบ',barcode:'ABC001',cost:10,price:15,stock:2};
 assert.throws(()=>f.run('addProduct',p),/ผู้จัดการ/);f.run('addProduct',p,'manager-01');const id=f.state.products.at(-1).id;
 f.run('editProduct',{...p,product_id:id,price:17},'manager-01');assert.equal(f.state.products.at(-1).stock,2);
 f.run('receiveStock',{product_id:id,quantityDelta:3,reason:'รับเข้าทดสอบ'});f.run('adjustStock',{product_id:id,quantityDelta:-1,reason:'เสียหาย'},'manager-01');assert.equal(f.state.products.at(-1).stock,4);
 assert.throws(()=>f.run('adjustStock',{product_id:id,quantityDelta:-5,reason:'เกิน'},'manager-01'));
 f.run('setProductActive',{product_id:id,active:false,reason:'พักขาย'},'manager-01');assert.throws(()=>f.run('addCart',{product_id:id}),/ไม่เปิดขาย/);
 f.run('setProductActive',{product_id:id,active:true,reason:'เปิดอีกครั้ง'},'manager-01');f.run('addCart',{product_id:id});f.run('addCart',{product_id:id});f.run('checkout',{method:'qr'});
 const tx=f.state.transactions[0];assert.equal(tx.amountSatang,3400);assert.equal(tx.category,'product');assert.equal(tx.method,'qr');assert.equal(f.state.products.at(-1).stock,2);
 const back={transaction_id:tx.id,quantity:1,restock:true,reason:'ลูกค้าคืน',method:'cash',refundConfirmed:true};assert.throws(()=>f.run('returnProduct',back),/ผู้จัดการ/);
 f.run('returnProduct',back,'manager-01','return-key');f.run('returnProduct',back,'manager-01','return-key',0);assert.equal(f.state.products.at(-1).stock,3);assert.equal(salesSummary(f.state).net,1700);
 assert.throws(()=>f.run('returnProduct',{...back,quantity:2},'manager-01'),/เกินจำนวน/);
 assert.equal(f.state.stockMovements.at(-1).transaction_id,f.state.transactions.at(-1).id);assert.equal(f.state.audit.at(-1).type,'refundProduct');
});
test('price/active changes invalidate existing cart and preserve original sale snapshots',()=>{
 const f=fixture();f.run('addCart',{product_id:'p1'});const p=f.state.products[0];f.run('editProduct',{...p,product_id:p.id,price:35},'manager-01');assert.throws(()=>f.run('checkout'),/ราคา/);assert.equal(f.state.transactions.length,0);
 f.run('removeCart',{line_id:p.id});f.run('addCart',{product_id:p.id});f.run('checkout');const snapshot=structuredClone(f.state.receipts[0]);
 f.run('editProduct',{...p,product_id:p.id,price:40},'manager-01');assert.deepEqual(f.state.receipts[0],snapshot);
});
test('v2 upgrade preserves old payments, methods unknown, receipts and exact active deadlines',()=>{
 const old=createDemo();old.version=2;delete old.stockMovements;old.transactions=[{id:'old-payment',type:'payment',amountSatang:2000,session_id:null,bill_id:null,at:100}];old.receipts=[{id:'old-receipt',total:20}];const copy=structuredClone(old);
 const state=upgradeState(old);assert.equal(state.version,3);assert.deepEqual(state.transactions,copy.transactions);assert.deepEqual(state.receipts,copy.receipts);assert.deepEqual(state.schemaArchives.at(-1).state,copy);assert.deepEqual(old,copy);assert.equal(state.revision,copy.revision+1);
});
