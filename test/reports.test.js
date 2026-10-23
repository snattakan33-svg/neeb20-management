import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute} from '../src/domain.js';
import {reportRange,makeReport,usageMilliseconds,reportCSV} from '../src/reports.js';
test('Bangkok day/month boundaries, refunds on actual day, cash/QR and separate income',()=>{
 let state=createDemo();let seq=0;
 const run=(type,payload,at,actor='staff-01')=>{const result=execute(state,{id:`r-${++seq}`,type,payload,expectedRevision:state.revision},actor,at);state=result.state;return result.result;};
 const at=Date.parse('2026-10-22T17:00:00Z'),pay={method:'cash',paymentConfirmed:true};
 const {session_id:id}=run('start',{station_id:1,...pay},at);run('extend',{session_id:id,expectedStationId:1,method:'qr',paymentConfirmed:true},at+1000);run('addCart',{product_id:'p1'},at+2000);run('checkout',{method:'qr',paymentConfirmed:true},at+3000);
 run('refund',{session_id:id,amountSatang:500,reason:'คืนบางส่วน',method:'cash',refundConfirmed:true},at+86400000,'manager-01');
 const first=makeReport(state,{mode:'daily',day:'2026-10-23'},at+5000);
 assert.equal(first.summary.base,2000);assert.equal(first.summary.extension,500);assert.equal(first.summary.product,2900);assert.equal(first.summary.net,5400);assert.equal(first.summary.cash.received,2000);assert.equal(first.summary.qr.received,3400);assert.equal(first.sessionCount,1);
 const next=makeReport(state,{mode:'daily',day:'2026-10-24'});assert.equal(next.summary.received,0);assert.equal(next.summary.refunded,500);assert.equal(next.summary.net,-500);assert.equal(next.refunds[0].original_transaction_id,state.transactions[0].id);
 assert.equal(makeReport(state,{mode:'monthly',month:'2026-10'}).summary.net,4900);assert.equal(makeReport(state,{mode:'range',from:'2026-10-23',to:'2026-10-24'}).summary.net,4900);
 assert.equal(makeReport(state,{mode:'daily',day:'2026-10-22'}).summary.net,0);
});
test('strict date validation, leap month and inclusive end date',()=>{
 assert.throws(()=>reportRange({mode:'daily',day:'2026-02-30'}));assert.throws(()=>reportRange({mode:'monthly',month:'2026-13'}));assert.throws(()=>reportRange({mode:'range',from:'2026-10-24',to:'2026-10-23'}));
 const leap=reportRange({mode:'monthly',month:'2028-02'});assert.equal(leap.to,'2028-02-29');assert.equal(leap.end-leap.start,29*86400000);
});
test('usage intervals exclude restored gaps, movements counted and session cohort is explicit',()=>{
 let state=createDemo(),seq=0;
 const run=(type,payload,now,actor='staff-01')=>{const out=execute(state,{id:String(++seq),type,payload,expectedRevision:state.revision},actor,now);state=out.state;return out.result;};
 const t=Date.parse('2026-10-23T03:00:00Z'),{session_id:id}=run('start',{station_id:1,method:'cash',paymentConfirmed:true},t);
 run('markUsed',{session_id:id,expectedStationId:1},t+1000);run('move',{session_id:id,expectedStationId:1,targetStationId:3,reason:'ทดสอบ'},t+2000);run('finish',{session_id:id,expectedStationId:3},t+61000);
 run('restore',{session_id:id,targetStationId:3,reason:'จบผิด'},t+120000,'manager-01');run('markUsed',{session_id:id,expectedStationId:3},t+121000);run('finish',{session_id:id,expectedStationId:3},t+181000);
 assert.equal(usageMilliseconds(state.sessions[0]),120000);const report=makeReport(state,{day:'2026-10-23'});assert.equal(report.sessions[0].moves,1);assert.deepEqual(report.sessions[0].stationHistory,[1,3]);assert.equal(report.finishedCount,1);assert.equal(report.summary.net,2000);
});
test('legacy channels remain unknown and CSV protects spreadsheet text formulas',()=>{
 const state=createDemo();state.transactions=[{id:'=BAD()',type:'payment',amountSatang:1234,at:Date.parse('2026-10-23T01:00Z'),employee_id:'@someone'}];
 const report=makeReport(state,{day:'2026-10-23'});assert.equal(report.summary.unknown.net,1234);assert.equal(report.summary.legacy,1234);const csv=reportCSV(report);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=BAD()"));assert.ok(csv.includes("'@someone"));
});
