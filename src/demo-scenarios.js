// Explicit fixture generator: never called by normal application startup.
import {createDemo,execute} from './domain.js';
export function createReconciliationScenario(now=Date.now()){
 let state=createDemo(),seq=0,time=now-8*86400000;
 const run=(type,payload={},actor='staff-01')=>{time+=1000;const out=execute(state,{id:`demo-reconciliation-${++seq}`,type,payload,expectedRevision:state.revision},actor,time);state=out.state;return out.result;};
 const sale=(method,qty=1)=>{for(let i=0;i<qty;i++)run('addCart',{product_id:'p1'});return run('checkout',{method,paymentConfirmed:true});};
 const open=()=>run('openShift',{employee_id:'staff-01',openingFloatSatang:10000}).shift_id;
 const first=open(),session=run('start',{station_id:1});run('extend',{session_id:session.session_id,expectedStationId:1});run('payBill',{session_id:session.session_id,expectedStationId:1,method:'cash',paymentConfirmed:true});run('finish',{session_id:session.session_id,expectedStationId:1});
 sale('cash',2);const original=state.transactions.filter(t=>t.category==='product').at(-1);sale('qr');run('returnProduct',{transaction_id:original.id,quantity:1,restock:true,reason:'ข้อมูลทดสอบ คืนสินค้าหนึ่งชิ้น',method:'cash',refundConfirmed:true},'manager-01');
 run('drawerMovement',{shift_id:first,direction:'in',amountSatang:2000,reason:'ข้อมูลทดสอบ เติมเงินทอน'});run('drawerMovement',{shift_id:first,direction:'out',amountSatang:3000,reason:'ข้อมูลทดสอบ นำออกระหว่างกะ'});
 run('submitShift',{shift_id:first,countedCashSatang:14400,verifiedQRSatang:2900,retainedFloatSatang:10000,handedOverSatang:4400,qrEvidence:'DEMO หลักฐาน QR 29 บาท — ไม่ใช่บัญชีจริง',note:'ข้อมูลตัวอย่างยอดตรง'});run('approveShift',{shift_id:first,reason:'DEMO ตรวจยอดตรง'},'manager-01');
 time=now-86400000;const second=open(),s2=run('start',{station_id:2});run('payBill',{session_id:s2.session_id,expectedStationId:2,method:'qr',paymentConfirmed:true});run('finish',{session_id:s2.session_id,expectedStationId:2});sale('cash');run('drawerMovement',{shift_id:second,direction:'out',amountSatang:1000,reason:'DEMO นำออก 10 บาท'});
 run('submitShift',{shift_id:second,countedCashSatang:11400,verifiedQRSatang:2000,retainedFloatSatang:10000,handedOverSatang:1400,reason:'DEMO นับขาด 5 บาท',qrEvidence:'DEMO หลักฐาน QR 20 บาท'});run('approveShift',{shift_id:second,reason:'DEMO รับทราบส่วนขาดตามรายงาน'},'manager-01');run('correctShift',{shift_id:second,countedCashDelta:500,verifiedQRDelta:0,handedOverDelta:500,reason:'DEMO พบเงินเพิ่ม 5 บาทในการนับซ้ำ'},'manager-01');
 time=now-60000;open();const s3=run('start',{station_id:3});run('addBillProduct',{session_id:s3.session_id,expectedStationId:3,product_id:'p1',quantity:1});run('move',{session_id:s3.session_id,expectedStationId:3,targetStationId:6,reason:'DEMO ย้ายพร้อมบิลค้าง'});
 const cancelled=run('start',{station_id:4});run('cancelUnpaid',{session_id:cancelled.session_id,expectedStationId:4,reason:'DEMO ยกเลิกก่อนรับเงิน'});run('editProduct',{...state.products[0],product_id:'p1',price:35},'manager-01');
 state.fixtureLabel='ข้อมูลทดสอบกระทบยอดเท่านั้น ไม่ใช่ยอดขายจริง';return state;
}
