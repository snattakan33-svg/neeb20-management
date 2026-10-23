// One shared cash drawer; sequential shifts. Financial records remain immutable.
function shiftInvalid(message,code='INVALID'){const e=new Error(message);e.code=code;throw e;}
function shiftAmount(value,positive=false){if(!Number.isSafeInteger(value)||value<(positive?1:0)||value>100000000)shiftInvalid('จำนวนเงินต้องเป็นสตางค์เต็มและไม่ติดลบ');return value;}
function shiftReason(value){if(typeof value!=='string'||!value.trim()||value.length>2000)shiftInvalid('ต้องระบุเหตุผล/หมายเหตุ 1–2000 ตัวอักษร');return value.trim();}
function signedShiftAmount(value){if(!Number.isSafeInteger(value)||Math.abs(value)>100000000)shiftInvalid('ยอด QR สุทธิต้องเป็นสตางค์เต็ม');return value;}
export function ensureShiftState(state){state.shifts||=[];state.shiftControl||={enabled:false};return state;}
export function shiftTotals(state,shift){
 const transactions=state.transactions.filter(t=>shift.transaction_ids.includes(t.id));
 const result={cashReceived:0,cashRefunded:0,qrReceived:0,qrRefunded:0,unknownReceived:0,unknownRefunded:0,unknownCount:0,qrCount:0,cashIn:0,cashOut:0};
 for(const t of transactions){const prefix=t.method==='cash'?'cash':t.method==='qr'?'qr':'unknown';result[prefix+(t.type==='refund'?'Refunded':'Received')]+=t.amountSatang;if(prefix==='unknown')result.unknownCount++;if(prefix==='qr')result.qrCount++;}
 for(const m of shift.cashMovements)result[m.direction==='in'?'cashIn':'cashOut']+=m.amountSatang;
 result.cashNet=result.cashReceived-result.cashRefunded;result.qrNet=result.qrReceived-result.qrRefunded;result.expectedCash=shift.openingFloatSatang+result.cashNet+result.cashIn-result.cashOut;return result;
}
export function reconciliation(state,shift){
 const totals=shiftTotals(state,shift),actual=shift.actual?structuredClone(shift.actual):null;
 if(actual)for(const correction of shift.corrections){actual.countedCashSatang+=correction.countedCashDelta;actual.verifiedQRSatang+=correction.verifiedQRDelta;actual.handedOverSatang+=correction.handedOverDelta;}
 if(!actual)return {...totals,actual:null,status:'PENDING',cashDifference:null,qrDifference:null,totalDifference:null,handoverDifference:null,expectedHandover:null};
 const cashDifference=actual.countedCashSatang-totals.expectedCash,qrDifference=actual.verifiedQRSatang-totals.qrNet;
 const expectedHandover=totals.expectedCash-actual.retainedFloatSatang,handoverDifference=actual.handedOverSatang-(actual.countedCashSatang-actual.retainedFloatSatang);
 const deltas=[cashDifference,qrDifference,handoverDifference],nonzero=deltas.filter(n=>n!==0);
 const status=totals.unknownCount?'PENDING':!nonzero.length?'MATCH':nonzero.every(n=>n>0)?'OVER':nonzero.every(n=>n<0)?'SHORT':'PENDING';
 return {...totals,actual,cashDifference,qrDifference,totalDifference:cashDifference+qrDifference,handoverDifference,expectedHandover,handoverAgainstExpected:actual.handedOverSatang-expectedHandover,status};
}
export function applyShiftCommand(state,command,actor,now,{newId,log}){
 if(!['openShift','drawerMovement','submitShift','approveShift','correctShift','createHistoricalShift'].includes(command.type))return {handled:false};
 ensureShiftState(state);const p=command.payload||{},manager=()=>{if(actor.role!=='manager')shiftInvalid('ต้องได้รับอนุมัติจากผู้จัดการ','FORBIDDEN');};
 const get=()=>{const s=state.shifts.find(s=>s.id===p.shift_id);if(!s)shiftInvalid('ไม่พบกะ');return s;};
 const owner=s=>{if(actor.id!==s.employee_id&&actor.role!=='manager')shiftInvalid('ไม่ใช่ผู้รับผิดชอบกะ','FORBIDDEN');};
 const actualValues=()=>({countedCashSatang:shiftAmount(p.countedCashSatang),verifiedQRSatang:signedShiftAmount(p.verifiedQRSatang),retainedFloatSatang:shiftAmount(p.retainedFloatSatang),handedOverSatang:shiftAmount(p.handedOverSatang)});
 const checkActual=s=>{
  const r=reconciliation(state,s);if(r.actual.retainedFloatSatang>r.actual.countedCashSatang||r.actual.retainedFloatSatang>r.expectedCash)shiftInvalid('เงินทอนเก็บไว้ต้องไม่เกินเงินสดที่นับและเงินสดตามระบบ');
  if(r.qrCount&&!s.qrEvidence)shiftInvalid('ต้องระบุหลักฐาน/บัญชีที่ตรวจ QR จริง (Demo ใช้หลักฐานทดสอบ)');
  if(r.status!=='MATCH'&&!s.reason)shiftInvalid('ยอดไม่ตรงหรือรอตรวจสอบ ต้องระบุเหตุผล');return r;
 };
 let result={};
 switch(command.type){
  case 'openShift':{
   if(state.shifts.some(s=>s.status==='OPEN'))shiftInvalid('มีกะเปิดอยู่แล้วสำหรับลิ้นชักกลาง','CONFLICT');if(state.shifts.some(s=>s.endedAt>now))shiftInvalid('เวลาระบบก่อนกะที่ปิดแล้ว กรุณาตรวจนาฬิกาเซิร์ฟเวอร์');
   if(!state.employees.some(e=>e.id===p.employee_id))shiftInvalid('ไม่พบพนักงาน');if(actor.role!=='manager'&&p.employee_id!==actor.id)shiftInvalid('เปิดกะให้พนักงานอื่นต้องเป็นผู้จัดการ','FORBIDDEN');
   const s={id:newId(),employee_id:p.employee_id,openedAt:now,endedAt:null,openingFloatSatang:shiftAmount(p.openingFloatSatang),status:'OPEN',transaction_ids:[],cashMovements:[],corrections:[],actual:null,note:String(p.note||'').slice(0,2000),createdBy:actor.id,historical:false};
   state.shifts.push(s);state.shiftControl.enabled=true;log('shiftOpen',null,null,s,null,{shift_id:s.id});result={shift_id:s.id};break;
  }
  case 'drawerMovement':{
   const s=get();owner(s);if(s.status!=='OPEN')shiftInvalid('กะส่งยอดหรืออนุมัติแล้ว ห้ามแก้เงินเข้าออก');if(!['in','out'].includes(p.direction))shiftInvalid('ทิศทางเงินไม่ถูกต้อง');
   const before=shiftTotals(state,s),m={id:newId(),at:now,employee_id:actor.id,amountSatang:shiftAmount(p.amountSatang,true),direction:p.direction,reason:shiftReason(p.reason),command_id:command.id};
   s.cashMovements.push(m);if(shiftTotals(state,s).expectedCash<0)shiftInvalid('เงินสดในลิ้นชักตามระบบไม่พอให้นำออก');log('drawerMovement',null,before,shiftTotals(state,s),m.reason,{shift_id:s.id,movement_id:m.id});break;
  }
  case 'submitShift':{
   const s=get();owner(s);if(s.status!=='OPEN')shiftInvalid('กะนี้ส่งยอดไปแล้ว','CONFLICT');const before=structuredClone(s);
   s.actual=actualValues();s.qrEvidence=String(p.qrEvidence||'').trim().slice(0,2000);s.reason=String(p.reason||'').trim().slice(0,2000);s.note=String(p.note||'').slice(0,2000);s.status='SUBMITTED';s.endedAt=now;s.submittedAt=now;s.submittedBy=actor.id;
   s.submittedSnapshot=checkActual(s);log('shiftSubmitted',null,before,s,s.reason||null,{shift_id:s.id});break;
  }
  case 'approveShift':{
   manager();const s=get();if(s.status!=='SUBMITTED')shiftInvalid('อนุมัติได้เฉพาะกะที่ส่งยอดแล้ว','CONFLICT');const r=checkActual(s);if(r.unknownCount)shiftInvalid('มีรายการไม่ทราบช่องทาง ต้องตรวจสอบก่อน ไม่สามารถอนุมัติกะนี้ได้');
   const before=structuredClone(s);s.status='APPROVED';s.approvedAt=now;s.approvedBy=actor.id;s.approvalReason=shiftReason(p.reason);s.approvedSnapshot=r;s.bankVerification={status:r.qrCount?'MANUALLY_REVIEWED':'NO_QR',at:now,employee_id:actor.id,evidence:s.qrEvidence};
   log('shiftApproved',null,before,s,s.approvalReason,{shift_id:s.id});break;
  }
  case 'correctShift':{
   manager();const s=get();if(s.status!=='APPROVED')shiftInvalid('รายการแก้ไขใช้กับกะที่อนุมัติแล้วเท่านั้น');
   const fields=['countedCashDelta','verifiedQRDelta','handedOverDelta'];if(fields.some(k=>!Number.isSafeInteger(p[k])||Math.abs(p[k])>100000000)||fields.every(k=>p[k]===0))shiftInvalid('ระบุผลต่างแก้ไขเป็นจำนวนสตางค์เต็มอย่างน้อยหนึ่งช่อง');
   const before=reconciliation(state,s),correction={id:newId(),at:now,employee_id:actor.id,reason:shiftReason(p.reason),qrEvidence:String(p.qrEvidence||'').trim().slice(0,2000),command_id:command.id,...Object.fromEntries(fields.map(k=>[k,p[k]]))};
   if(p.verifiedQRDelta&&!correction.qrEvidence)shiftInvalid('แก้ยอดตรวจ QR ต้องมีหลักฐานใหม่');s.corrections.push(correction);const after=reconciliation(state,s);
   if([after.actual.countedCashSatang,after.actual.handedOverSatang].some(n=>n<0)||after.actual.retainedFloatSatang>after.actual.countedCashSatang)shiftInvalid('ยอดจริงหลังแก้ไขไม่ถูกต้อง');
   log('shiftCorrection',null,before,after,correction.reason,{shift_id:s.id,correction_id:correction.id});result={correction_id:correction.id};break;
  }
  case 'createHistoricalShift':{
   manager();if(!Number.isSafeInteger(p.openedAt)||!Number.isSafeInteger(p.endedAt)||p.openedAt<0||p.endedAt<=p.openedAt||p.endedAt>now)shiftInvalid('ช่วงเวลากะย้อนหลังไม่ถูกต้อง');
   if(!state.employees.some(e=>e.id===p.employee_id))shiftInvalid('ไม่พบพนักงาน');
   if(state.shifts.some(s=>p.openedAt<(s.endedAt??Infinity)&&p.endedAt>s.openedAt))shiftInvalid('ช่วงเวลากะซ้อนกับกะอื่น','CONFLICT');
   const assigned=new Set(state.shifts.flatMap(s=>s.transaction_ids));const transactions=state.transactions.filter(t=>t.at>=p.openedAt&&t.at<p.endedAt);
   if(transactions.some(t=>assigned.has(t.id)))shiftInvalid('รายการเงินถูกนับในกะอื่นแล้ว','CONFLICT');
   const s={id:newId(),employee_id:p.employee_id,openedAt:p.openedAt,endedAt:p.endedAt,openingFloatSatang:shiftAmount(p.openingFloatSatang),status:'SUBMITTED',transaction_ids:transactions.map(t=>t.id),cashMovements:[],corrections:[],actual:actualValues(),qrEvidence:String(p.qrEvidence||'').trim().slice(0,2000),reason:shiftReason(p.reason),note:String(p.note||'').slice(0,2000),createdBy:actor.id,submittedBy:actor.id,submittedAt:now,historical:true};
   for(const [direction,value] of [['in',p.historicalCashInSatang||0],['out',p.historicalCashOutSatang||0]]){shiftAmount(value);if(value)s.cashMovements.push({id:newId(),direction,amountSatang:value,at:p.endedAt-1,employee_id:actor.id,reason:'ยอดรวมย้อนหลังที่ผู้จัดการระบุ: '+s.reason,command_id:command.id,historical:true});}
   s.submittedSnapshot=checkActual(s);state.shifts.push(s);log('historicalShiftSubmitted',null,null,s,s.reason,{shift_id:s.id});result={shift_id:s.id};break;
  }
 }
 return {handled:true,result};
}
export function assignNewTransactions(state,startIndex,actor,now){
 ensureShiftState(state);const added=state.transactions.slice(startIndex);if(!added.length)return;
 const shift=state.shifts.find(s=>s.status==='OPEN');if(state.shiftControl.enabled&&!shift)shiftInvalid('ต้องเปิดกะก่อนรับเงินหรือคืนเงิน','SHIFT_REQUIRED');
 for(const t of added){t.staff_confirmation={employee_id:actor.id,at:now,type:t.type};if(t.method==='qr')t.qrBankStatus='UNVERIFIED';if(shift){t.shift_id=shift.id;shift.transaction_ids.push(t.id);}}
 if(shift&&shiftTotals(state,shift).expectedCash<0)shiftInvalid('เงินสดตามระบบไม่พอคืนเงิน กรุณาบันทึกเติมเงินเข้าลิ้นชักก่อน');
}
export function validateShifts(state){
 if(!Array.isArray(state.shifts)||!state.shiftControl)shiftInvalid('ข้อมูลกะไม่ครบ');if(state.shifts.filter(s=>s.status==='OPEN').length>1)shiftInvalid('กะเปิดซ้ำ');
 const txIds=new Set(state.transactions.map(t=>t.id)),assigned=new Set(),ids=new Set();
 for(const s of state.shifts){if(ids.has(s.id))shiftInvalid('รหัสกะซ้ำ');ids.add(s.id);for(const id of s.transaction_ids){if(!txIds.has(id)||assigned.has(id))shiftInvalid('รายการเงินถูกนับซ้ำระหว่างกะ');assigned.add(id);}if(s.status==='APPROVED'&&(!s.approvedSnapshot||!s.approvedBy))shiftInvalid('ข้อมูลอนุมัติกะไม่ครบ');}
}
