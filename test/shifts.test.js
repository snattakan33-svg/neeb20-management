import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute,salesSummary,upgradeState,validateState} from '../src/domain.js';
import {reconciliation} from '../src/shifts.js';
import {makeReport,reportRange,isoWeek,shiftsCSV} from '../src/reports.js';
function fixture(initial=createDemo()){let state=initial,n=0,now=Date.parse('2026-10-23T01:00:00Z');return {get state(){return state;},time(t){now=t;},run(type,payload={},actor='staff-01',id=`shift-test-${++n}`,revision=state.revision){now++;const out=execute(state,{id,type,payload,expectedRevision:revision},actor,now);state=out.state;return out.result;},open(float=10000){return this.run('openShift',{employee_id:'staff-01',openingFloatSatang:float}).shift_id;},sale(method='cash',quantity=1){this.run('addCart',{product_id:'p1'});for(let i=1;i<quantity;i++)this.run('addCart',{product_id:'p1'});return this.run('checkout',{method,paymentConfirmed:true});},r(id){return reconciliation(state,state.shifts.find(s=>s.id===id));}};}
const actual=(shift_id,cash,qr,retained,handover,extra={})=>({shift_id,countedCashSatang:cash,verifiedQRSatang:qr,retainedFloatSatang:retained,handedOverSatang:handover,qrEvidence:'DEMO bank statement',...extra});
test('float, refunds, cash in/out, counted cash and handover reconcile without changing revenue',()=>{
 const f=fixture(),shift=f.open();f.sale('cash',2);const cashTx=f.state.transactions.at(-1);f.sale('qr');f.run('returnProduct',{transaction_id:cashTx.id,quantity:1,restock:true,reason:'คืนทดสอบ',method:'cash',refundConfirmed:true},'manager-01');
 f.run('drawerMovement',{shift_id:shift,direction:'in',amountSatang:2000,reason:'เติมเงิน'});f.run('drawerMovement',{shift_id:shift,direction:'out',amountSatang:3000,reason:'นำออก'});
 const r=f.r(shift);assert.equal(r.cashNet,2900);assert.equal(r.qrNet,2900);assert.equal(r.expectedCash,11900);assert.equal(salesSummary(f.state).net,5800);
 f.run('submitShift',actual(shift,11900,2900,10000,1900));assert.equal(f.r(shift).status,'MATCH');assert.equal(f.r(shift).expectedHandover,1900);assert.equal(f.r(shift).totalDifference,0);assert.equal(f.state.shifts[0].transaction_ids.length,3);assert.equal(f.state.transactions.find(t=>t.method==='qr').qrBankStatus,'UNVERIFIED');
});
test('short/over and opposite cash/QR differences do not hide each other',()=>{
 for(const [cash,qr,handover,expected] of [[11900,2900,1900,'SHORT'],[13900,2900,3900,'OVER'],[11900,3900,1900,'PENDING']]){
  const f=fixture(),shift=f.open();f.sale('cash');f.sale('qr');const data=actual(shift,cash,qr,10000,handover);
  assert.throws(()=>f.run('submitShift',data),/เหตุผล/);f.run('submitShift',{...data,reason:'ข้อมูลทดสอบไม่ตรง'});assert.equal(f.r(shift).status,expected);if(expected==='PENDING')assert.equal(f.r(shift).totalDifference,0);
 }
});
test('handover can differ even when till count and QR match',()=>{
 const f=fixture(),shift=f.open();f.sale('cash');f.run('submitShift',actual(shift,12900,0,10000,1900,{reason:'ส่งน้อยกว่าเงินที่นับได้'}));const r=f.r(shift);assert.equal(r.cashDifference,0);assert.equal(r.qrDifference,0);assert.equal(r.handoverDifference,-1000);assert.equal(r.status,'SHORT');
});
test('submit/approve/retry locks records; manager correction appends and preserves original snapshot',()=>{
 const f=fixture(),shift=f.open();f.sale('cash');const data=actual(shift,12400,0,10000,2400,{reason:'นับขาด 5 บาท'});f.run('submitShift',data,'staff-01','submit');f.run('submitShift',data,'staff-01','submit',0);
 assert.throws(()=>f.run('approveShift',{shift_id:shift,reason:'ตรวจแล้ว'}),/ผู้จัดการ/);f.run('approveShift',{shift_id:shift,reason:'รับทราบเงินขาด'},'manager-01','approve');f.run('approveShift',{shift_id:shift,reason:'รับทราบเงินขาด'},'manager-01','approve',0);const snapshot=structuredClone(f.state.shifts[0].approvedSnapshot),original=structuredClone(f.state.shifts[0].actual),tx=structuredClone(f.state.transactions);
 assert.throws(()=>f.run('drawerMovement',{shift_id:shift,direction:'out',amountSatang:1,reason:'แก้ย้อนหลัง'}));assert.throws(()=>f.run('submitShift',data));assert.throws(()=>f.run('correctShift',{shift_id:shift,countedCashDelta:500,verifiedQRDelta:0,handedOverDelta:500,reason:'นับใหม่'}),/ผู้จัดการ/);
 const correction={shift_id:shift,countedCashDelta:500,verifiedQRDelta:0,handedOverDelta:500,reason:'พบเงินทดสอบอีก 5 บาท'};f.run('correctShift',correction,'manager-01','fix');f.run('correctShift',correction,'manager-01','fix',0);
 assert.deepEqual(f.state.shifts[0].approvedSnapshot,snapshot);assert.deepEqual(f.state.shifts[0].actual,original);assert.deepEqual(f.state.transactions,tx);assert.equal(f.state.shifts[0].corrections.length,1);assert.equal(f.r(shift).status,'MATCH');assert.equal(snapshot.status,'SHORT');assert.equal(f.state.audit.at(-1).type,'shiftCorrection');
});
test('once shift control enabled, money needs an open shift and is never assigned twice',()=>{
 const f=fixture(),a=f.open();f.sale();f.run('submitShift',actual(a,12900,0,10000,2900));f.run('addCart',{product_id:'p1'});const before=structuredClone(f.state);assert.throws(()=>f.run('checkout',{method:'cash',paymentConfirmed:true}),/เปิดกะ/);assert.deepEqual(f.state,before);
 const b=f.open();f.run('checkout',{method:'cash',paymentConfirmed:true});assert.equal(f.state.shifts[0].transaction_ids.length,1);assert.equal(f.state.shifts[1].transaction_ids.length,1);assert.notEqual(f.state.shifts[0].transaction_ids[0],f.state.shifts[1].transaction_ids[0]);assert.equal(f.state.transactions[1].shift_id,b);
 const broken=structuredClone(f.state);broken.shifts[1].transaction_ids.push(broken.shifts[0].transaction_ids[0]);assert.throws(()=>validateState(broken),/นับซ้ำ/);
});
test('second open shift and stale close commands cannot create parallel drawers',()=>{
 const f=fixture(),revision=f.state.revision;f.open();assert.throws(()=>f.run('openShift',{employee_id:'staff-01',openingFloatSatang:0},'staff-01','device-b',revision),/ข้อมูลเปลี่ยน/);assert.throws(()=>f.open(),/มีกะเปิด/);assert.equal(f.state.shifts.length,1);
});
test('refund in later shift belongs to refund shift, with negative QR net verified separately',()=>{
 const f=fixture(),a=f.open(0);f.sale('qr');const tx=f.state.transactions[0];f.run('submitShift',actual(a,0,2900,0,0));f.run('approveShift',{shift_id:a,reason:'ตรวจหลักฐานแล้ว'},'manager-01');const before=structuredClone(f.state.shifts[0]);const b=f.open(0);
 f.run('returnProduct',{transaction_id:tx.id,quantity:1,restock:true,reason:'คืนในกะใหม่',method:'qr',refundConfirmed:true},'manager-01');f.run('submitShift',actual(b,0,-2900,0,0));assert.equal(f.r(b).status,'MATCH');assert.equal(f.r(b).qrNet,-2900);assert.deepEqual(f.state.shifts[0],before);assert.equal(f.state.transactions.at(-1).shift_id,b);
});
test('cash refund cannot make drawer negative; cash top-up is not revenue',()=>{
 const f=fixture(),id=f.open(0);f.sale('qr');const tx=f.state.transactions[0],p={transaction_id:tx.id,quantity:1,restock:true,reason:'คืนสด',method:'cash',refundConfirmed:true};assert.throws(()=>f.run('returnProduct',p,'manager-01'),/ไม่พอคืนเงิน/);assert.equal(f.state.transactions.length,1);
 f.run('drawerMovement',{shift_id:id,direction:'in',amountSatang:2900,reason:'เติมเพื่อคืนเงิน'});f.run('returnProduct',p,'manager-01');assert.equal(f.r(id).expectedCash,0);assert.equal(salesSummary(f.state).net,0);
});
test('historical shift half-open boundaries, overlaps, unknown channel and complete old records',()=>{
 const f=fixture();f.time(100000);f.sale();f.time(200000);f.sale('qr');const transactions=structuredClone(f.state.transactions);f.time(300000);
 const old={employee_id:'staff-01',openedAt:100000,endedAt:200000,openingFloatSatang:0,countedCashSatang:2900,verifiedQRSatang:0,retainedFloatSatang:0,handedOverSatang:2900,reason:'จัดกะย้อนหลังจากหลักฐาน'};
 const id=f.run('createHistoricalShift',old,'manager-01').shift_id;assert.equal(f.state.shifts[0].transaction_ids.length,1);assert.deepEqual(f.state.transactions,transactions);assert.throws(()=>f.run('createHistoricalShift',{...old,openedAt:150000,endedAt:250000},'manager-01'),/ซ้อน/);
 f.run('approveShift',{shift_id:id,reason:'ตรวจหลักฐานเดิม'},'manager-01');assert.equal(f.state.shifts[0].approvedSnapshot.status,'MATCH');
});
test('weekly ISO boundaries and all-history lookup, employee totals and graphs',()=>{
 assert.equal(reportRange({mode:'weekly',week:'2020-W53'}).from,'2020-12-28');assert.equal(reportRange({mode:'weekly',week:'2020-W53'}).to,'2021-01-03');assert.throws(()=>reportRange({mode:'weekly',week:'2021-W53'}));assert.equal(isoWeek('2021-01-01'),'2020-W53');
 const f=fixture();f.time(Date.parse('2020-12-31T17:00:00Z'));f.sale('cash');f.time(Date.parse('2026-10-23T03:00:00Z'));f.sale('qr');
 const report=makeReport(f.state,{mode:'all'});assert.equal(report.summary.net,5800);assert.equal(report.paidBillCount,2);assert.equal(report.charts.daily.length,2);assert.equal(report.summary.wash100,0);assert.equal(report.unassignedTransactions.length,2);assert.equal(report.employees.find(e=>e.employee_id==='staff-01').net,5800);
 const weekly=makeReport(f.state,{mode:'weekly',week:'2020-W53'});assert.equal(weekly.summary.net,2900);const filtered=makeReport(f.state,{mode:'all',employee_id:'manager-01'});assert.equal(filtered.summary.net,0);
});
test('QR reconciliation requires evidence, does not rewrite original bank status, CSV records handover',()=>{
 const f=fixture(),id=f.open();f.sale('qr');const p=actual(id,10000,2900,10000,0,{qrEvidence:''});assert.throws(()=>f.run('submitShift',p),/หลักฐาน/);f.run('submitShift',{...p,qrEvidence:'DEMO บัญชีทดสอบ 29 บาท'});f.run('approveShift',{shift_id:id,reason:'ตรวจด้วยมือ'},'manager-01');assert.equal(f.state.transactions[0].qrBankStatus,'UNVERIFIED');assert.equal(f.state.shifts[0].bankVerification.status,'MANUALLY_REVIEWED');
 const report=makeReport(f.state,{mode:'all'});assert.ok(shiftsCSV(report).includes(id));assert.ok(shiftsCSV(report).includes('MATCH'));assert.equal(report.anomalies.some(a=>a.type==='paymentReview'),false);
});
test('v4 upgrade does not fabricate historical shift assignment or destroy ledger',()=>{
 const f=fixture();f.sale();const old=structuredClone(f.state);old.version=4;delete old.shifts;delete old.shiftControl;const upgraded=upgradeState(old);assert.equal(upgraded.version,5);assert.equal(upgraded.shifts.length,0);assert.equal(upgraded.shiftControl.enabled,false);assert.deepEqual(upgraded.transactions,old.transactions);assert.deepEqual(upgraded.schemaArchives.at(-1).state,old);
});
test('historical unknown payment channel stays pending, cannot be approved by guessing',()=>{
 const initial=createDemo();initial.transactions=[{id:'legacy-money',type:'payment',amountSatang:2000,at:1000,employee_id:null,demo:true}];const f=fixture(initial);f.time(5000);
 const id=f.run('createHistoricalShift',{employee_id:'staff-01',openedAt:0,endedAt:2000,openingFloatSatang:0,countedCashSatang:0,verifiedQRSatang:0,retainedFloatSatang:0,handedOverSatang:0,reason:'ตรวจรายการเก่าไม่มีช่องทาง'},'manager-01').shift_id;
 assert.equal(f.r(id).status,'PENDING');assert.throws(()=>f.run('approveShift',{shift_id:id,reason:'เดาว่าเงินสด'},'manager-01'),/ไม่ทราบช่องทาง/);assert.equal(f.state.transactions[0].method,undefined);
 const report=makeReport(f.state,{mode:'all'});assert.equal(report.employees.find(e=>e.employee_id==='unknown').net,2000);assert.equal(report.summary.unknown.net,2000);
});
test('sample reconciliation fixture is explicit and has correct historical shortage/correction',async()=>{
 const {createReconciliationScenario}=await import('../src/demo-scenarios.js');const state=createReconciliationScenario(Date.parse('2026-10-23T03:00:00Z')),report=makeReport(state,{mode:'all'});
 assert.ok(state.fixtureLabel.includes('ทดสอบ'));assert.equal(report.summary.net,13200);assert.equal(report.shifts.length,3);assert.equal(report.shifts[0].approvedSnapshot.expectedCash,14400);assert.equal(report.shifts[0].approvedSnapshot.expectedHandover,4400);assert.equal(report.shifts[1].approvedSnapshot.status,'SHORT');assert.equal(report.shifts[1].approvedSnapshot.cashDifference,-500);assert.equal(report.shifts[1].reconciliation.status,'MATCH');assert.equal(report.shifts[2].status,'OPEN');assert.equal(report.unpaidCurrentSatang,4900);assert.equal(report.unassignedTransactions.length,0);assert.ok(report.anomalies.some(a=>a.type==='shiftCorrection'));
});
test('report exports use Bangkok time and retain original approval plus corrections',async()=>{
 const {bangkokTimestamp,incomeSummaryCSV,reportCSV}=await import('../src/reports.js');const {createReconciliationScenario}=await import('../src/demo-scenarios.js');
 assert.equal(bangkokTimestamp(Date.parse('2026-10-23T17:30:00Z')),'2026-10-24T00:30:00.000+07:00');const report=makeReport(createReconciliationScenario(),{mode:'all'}),csv=shiftsCSV(report);assert.ok(csv.includes('+07:00'));assert.ok(csv.includes('SHORT'));assert.ok(csv.includes('MATCH'));assert.ok(csv.includes('นับสดเดิมบาท'));assert.ok(csv.includes('countedCashDelta'));assert.ok(incomeSummaryCSV(report).includes('สุทธิ'));assert.ok(reportCSV(report).includes('Asia/Bangkok'));
});
