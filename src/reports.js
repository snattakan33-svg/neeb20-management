import {reconciliation} from './shifts.js';
import {fail,status,recognizedTransactions,billLines,billStatus,finance} from './domain.js';
export const bangkokTimestamp=ms=>new Date(ms+7*3600000).toISOString().replace('Z','+07:00');
export const bangkokDay=ms=>new Date(ms+7*3600000).toISOString().slice(0,10);
function midnight(day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('วันที่ไม่ถูกต้อง');
  const ms=Date.parse(day+'T00:00:00.000Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==day)fail('วันที่ไม่ถูกต้อง');return ms-7*3600000;
}
export function isoWeek(day){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+3-((d.getUTCDay()+6)%7));const year=d.getUTCFullYear(),week=Math.ceil(((d-Date.UTC(year,0,1))/86400000+1)/7);return `${year}-W${String(week).padStart(2,'0')}`;}
export function reportRange(input={},now=Date.now(),state=null){
  const mode=input.mode||'daily';let from,to;
  if(mode==='daily'){from=to=input.day||bangkokDay(now);}
  else if(mode==='weekly'){
    const week=input.week||isoWeek(bangkokDay(now));if(!/^\d{4}-W\d{2}$/.test(week))fail('สัปดาห์ไม่ถูกต้อง');const y=Number(week.slice(0,4)),w=Number(week.slice(6));const jan4=new Date(Date.UTC(y,0,4));const monday=Date.UTC(y,0,4)-((jan4.getUTCDay()+6)%7)*86400000+(w-1)*7*86400000;
    from=new Date(monday).toISOString().slice(0,10);to=new Date(monday+6*86400000).toISOString().slice(0,10);if(isoWeek(from)!==week)fail('สัปดาห์ไม่ถูกต้อง');
  }else if(mode==='all'){
    const times=[now,...(state?.transactions||[]).map(t=>t.at),...(state?.sessions||[]).map(s=>s.startedAt),...(state?.shifts||[]).map(s=>s.openedAt)].filter(Number.isFinite);from=bangkokDay(times.reduce((a,b)=>Math.min(a,b),now));to=bangkokDay(times.reduce((a,b)=>Math.max(a,b),now));
  }else if(mode==='monthly'){
    const month=input.month||bangkokDay(now).slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))fail('เดือนไม่ถูกต้อง');
    from=month+'-01';midnight(from);const [y,m]=month.split('-').map(Number);to=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  }else if(mode==='range'){from=input.from;to=input.to;}else fail('ประเภทรายงานไม่ถูกต้อง');
  const start=midnight(from),end=midnight(to)+86400000;if(end<=start)fail('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');return {mode,from,to,start,end,timeZone:'Asia/Bangkok'};
}
export function usageMilliseconds(session,now=Date.now()){
  if(session.legacyPostpaid||(!session.usageIntervals?.length&&session.cancellation?.unused!==true))return null;
  return (session.usageIntervals||[]).reduce((sum,i)=>sum+Math.max(0,(i.endedAt??now)-i.startedAt),0);
}
function stationHistory(state,s){const path=state.audit.filter(a=>a.session_id===s.session_id&&['start','importLegacy','move','restore'].includes(a.type)).map(a=>a.after.station_id);if(!path.length)path.push(s.station_id);return path.filter((id,i)=>i===0||id!==path[i-1]);}
export function makeReport(state,input={},now=Date.now()){
  const range=reportRange(input,now,state),inside=ms=>Number.isFinite(ms)&&ms>=range.start&&ms<range.end;
  const transactions=recognizedTransactions(state).filter(t=>inside(t.at)&&(!input.employee_id||t.employee_id===input.employee_id));
  const summary={base:0,extension:0,wash100:0,product:0,legacy:0,received:0,refunded:0,net:0,cash:{received:0,refunded:0,net:0},qr:{received:0,refunded:0,net:0},unknown:{received:0,refunded:0,net:0}};
  for(const t of transactions){
    const refund=t.type==='refund',method=['cash','qr'].includes(t.method)?t.method:'unknown',category=['base','extension','wash100','product'].includes(t.category)?t.category:'legacy';
    if(refund)summary.refunded+=t.amountSatang;else{summary.received+=t.amountSatang;summary[category]+=t.amountSatang;}
    summary[method][refund?'refunded':'received']+=t.amountSatang;
  }
  summary.net=summary.received-summary.refunded;for(const key of ['cash','qr','unknown'])summary[key].net=summary[key].received-summary[key].refunded;
  const sessions=state.sessions.filter(s=>inside(s.startedAt)&&(!input.employee_id||state.audit.some(a=>a.type==='start'&&a.session_id===s.session_id&&a.employee_id===input.employee_id))).map(s=>{
    const moves=state.audit.filter(a=>a.type==='move'&&a.session_id===s.session_id);
    return {session_id:s.session_id,bill_id:s.bill_id,station_id:s.station_id,startedAt:s.startedAt,endsAt:s.endsAt,finishedAt:s.finishedAt??null,cancelledAt:s.cancelledAt??null,status:status(s,now),serviceStatus:s.serviceStatus,moves:moves.length,stationHistory:stationHistory(state,s),usageMilliseconds:usageMilliseconds(s,now),usageIntervals:s.usageIntervals||[],legacy:!!s.legacyPostpaid};
  });
  const bills=state.bills.filter(b=>(inside(b.createdAt)||inside(b.paidAt)||transactions.some(t=>t.bill_id===b.id))&&(!input.employee_id||b.paidBy===input.employee_id||transactions.some(t=>t.bill_id===b.id)||state.audit.some(a=>a.type==='start'&&a.session_id===b.session_id&&a.employee_id===input.employee_id))).map(b=>{
    const session=state.sessions.find(s=>s.session_id===b.session_id),lines=billLines(state,b.id),financial=finance(state,b.id),payments=state.transactions.filter(t=>t.bill_id===b.id&&t.type==='payment');
    return {bill_id:b.id,session_id:b.session_id,station_id:session?.station_id??null,startedAt:session?.startedAt??null,finishedAt:session?.finishedAt??null,cancelledAt:session?.cancelledAt??null,usageMilliseconds:session?usageMilliseconds(session,now):null,status:billStatus(state,b.id),lines,serviceSatang:lines.filter(l=>l.kind!=='product').reduce((n,l)=>n+l.amountSatang,0),productSatang:lines.filter(l=>l.kind==='product').reduce((n,l)=>n+l.amountSatang,0),totalSatang:financial.charged,receivedSatang:financial.paid,refundedSatang:financial.refunded,netSatang:financial.net,cashSatang:payments.filter(t=>t.method==='cash').reduce((n,t)=>n+t.amountSatang,0),qrSatang:payments.filter(t=>t.method==='qr').reduce((n,t)=>n+t.amountSatang,0),paidAt:b.paidAt??null,paidBy:b.paidBy??null,paymentMethod:b.paymentMethod??null,payment_id:b.payment_id??null,transaction_ids:payments.map(t=>t.id)};
  });
  const paidBillCount=new Set(transactions.filter(t=>t.type==='payment').map(t=>t.bill_id||t.receipt_id||t.id)).size;
  const unpaid=state.bills.filter(b=>billStatus(state,b.id)==='UNPAID'&&(!input.employee_id||state.audit.some(a=>a.type==='start'&&a.session_id===b.session_id&&a.employee_id===input.employee_id)));
  const buckets={daily:new Map(),weekly:new Map(),monthly:new Map()};
  for(const t of transactions){const day=bangkokDay(t.at);for(const [group,key] of [['daily',day],['weekly',isoWeek(day)],['monthly',day.slice(0,7)]]){const row=buckets[group].get(key)||{key,received:0,refunded:0,net:0};row[t.type==='refund'?'refunded':'received']+=t.amountSatang;row.net=row.received-row.refunded;buckets[group].set(key,row);}}
  const employeeRows=[...new Set([...state.employees.map(e=>e.id),...transactions.map(t=>t.employee_id||'unknown')])].map(id=>{const e=state.employees.find(e=>e.id===id),tx=transactions.filter(t=>(t.employee_id||'unknown')===id);return {employee_id:id,name:e?.name||'ข้อมูลเก่า/ไม่ระบุ: '+id,received:tx.filter(t=>t.type==='payment').reduce((n,t)=>n+t.amountSatang,0),refunded:tx.filter(t=>t.type==='refund').reduce((n,t)=>n+t.amountSatang,0),count:tx.length};}).map(e=>({...e,net:e.received-e.refunded}));
  const shifts=(state.shifts||[]).filter(s=>(inside(s.openedAt)||inside(s.endedAt)||inside(s.approvedAt)||s.corrections.some(c=>inside(c.at)))&&(!input.employee_id||s.employee_id===input.employee_id)).map(s=>({...structuredClone(s),reconciliation:reconciliation(state,s)}));
  const assigned=new Set((state.shifts||[]).flatMap(s=>s.transaction_ids));const unassignedTransactions=transactions.filter(t=>!assigned.has(t.id));
  const anomalyTypes=new Set(['cancel','refund','refundProduct','move','editProduct','addProduct','setProductActive','removeBillProduct','adjustStock','stock:adjustStock','extend','shiftCorrection']);
  const anomalies=state.audit.filter(a=>inside(a.at)&&anomalyTypes.has(a.type)&&(!input.employee_id||a.employee_id===input.employee_id)).map(a=>({type:a.type,at:a.at,employee_id:a.employee_id,session_id:a.session_id,shift_id:a.shift_id||null,id:a.id,reason:a.reason,details:a}));
  for(const bill of unpaid)anomalies.push({type:'UNPAID',at:bill.createdAt,employee_id:null,id:bill.id,session_id:bill.session_id,reason:'บิลค้างปัจจุบัน ไม่รวมรายได้',details:bill});
  for(const t of transactions){const assignedShift=(state.shifts||[]).find(s=>s.transaction_ids.includes(t.id)),manuallyReviewed=assignedShift?.status==='APPROVED'&&assignedShift.bankVerification?.status==='MANUALLY_REVIEWED';const unusual=!['cash','qr'].includes(t.method)||!t.bill_id||(t.method==='qr'&&!manuallyReviewed);if(unusual)anomalies.push({type:'paymentReview',at:t.at,employee_id:t.employee_id,id:t.id,reason:t.method==='qr'?'QR ยืนยันโดยพนักงาน แยกจากการตรวจบัญชีในกะ':'ข้อมูลช่องทาง/บิลไม่ครบ ต้องตรวจสอบ',details:t});}
  for(const s of shifts)if(s.status!=='OPEN'&&s.reconciliation.status!=='MATCH')anomalies.push({type:'shiftMismatch',at:s.endedAt,employee_id:s.employee_id,id:s.id,shift_id:s.id,reason:s.reason,details:s.reconciliation});
  for(const t of unassignedTransactions)anomalies.push({type:'unassignedShift',at:t.at,employee_id:t.employee_id,id:t.id,reason:'ยังไม่ผูกกะ',details:t});
  return {employee_id:input.employee_id||null,paidBillCount,unpaidCurrentCount:unpaid.length,unpaidCurrentSatang:unpaid.reduce((n,b)=>n+finance(state,b.id).due,0),charts:Object.fromEntries(Object.entries(buckets).map(([key,map])=>[key,[...map.values()].sort((a,b)=>a.key.localeCompare(b.key))])),employees:employeeRows,shifts,unassignedTransactions,anomalies,bills,demo:true,generatedAt:now,range,summary,sessionCount:sessions.length,finishedCount:sessions.filter(s=>s.status==='finished').length,cancelledCount:sessions.filter(s=>s.status==='cancelled').length,finishedInRange:state.sessions.filter(s=>inside(s.finishedAt)).length,cancelledInRange:state.sessions.filter(s=>inside(s.cancelledAt)).length,sessions,transactions,refunds:transactions.filter(t=>t.type==='refund')};
}
export function reportCSV(report){
  const cell=value=>{if(typeof value==='number')return String(value);let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['DEMO ONLY','เวลา Asia/Bangkok','ประเภท','หมวด','ช่องทาง','จำนวนบาท','Transaction ID','Session ID','บิล','อ้างอิงรายการเดิม','พนักงาน','เหตุผล'],...report.transactions.map(t=>['ข้อมูลทดสอบ',bangkokTimestamp(t.at),t.type,t.category||'legacy',t.method||'unknown',(t.type==='refund'?-1:1)*t.amountSatang/100,t.id,t.session_id,t.bill_id,t.original_transaction_id,t.employee_id,t.reason])];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function billsCSV(report){
 const cell=value=>{if(typeof value==='number')return String(value);let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const time=ms=>ms===null?'':bangkokTimestamp(ms);
 const rows=[['DEMO ONLY','Bill ID','Session ID','Station','เริ่ม Asia/Bangkok','จบ Asia/Bangkok','ใช้งานวินาที','รายการบริการ','รายการสินค้า','ยอดบริการบาท','ยอดสินค้าบาท','ยอดรวมบาท','รับเงินสดบาท','รับ QR บาท','ชำระ Asia/Bangkok','พนักงาน','สถานะ','Payment ID','Transaction IDs','คืนเงินบาท','สุทธิบาท'],...report.bills.map(b=>['ข้อมูลทดสอบ',b.bill_id,b.session_id,b.station_id,time(b.startedAt),time(b.finishedAt),b.usageMilliseconds===null?'ไม่ทราบ':b.usageMilliseconds/1000,JSON.stringify(b.lines.filter(l=>l.kind!=='product')),JSON.stringify(b.lines.filter(l=>l.kind==='product')),b.serviceSatang/100,b.productSatang/100,b.totalSatang/100,b.cashSatang/100,b.qrSatang/100,time(b.paidAt),b.paidBy,b.status,b.payment_id,b.transaction_ids.join(' / '),b.refundedSatang/100,b.netSatang/100])];
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function shiftsCSV(report){
 const cell=v=>typeof v==='number'?String(v):'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['DEMO ONLY','Shift ID','ผู้รับผิดชอบ','เริ่ม Asia/Bangkok','สิ้นสุด Asia/Bangkok','สถานะกะ','สถานะเงิน','เงินทอนบาท','เงินสดระบบบาท','QR ระบบบาท','เงินเข้าบาท','เงินออกบาท','เงินสดคาดบาท','นับจริงบาท','QR ตรวจจริงบาท','เงินทอนเก็บบาท','ควรส่งบาท','ส่งจริงบาท','ผลต่างสดบาท','ผลต่าง QR บาท','ผลต่างรวมบาท','ผลต่างส่งมอบบาท','ผู้อนุมัติ','เหตุผล','นับสดเดิมบาท','QR ตรวจเดิมบาท','ส่งจริงเดิมบาท','สถานะเงินตอนอนุมัติ','ผลต่างสดตอนอนุมัติบาท','จำนวนแก้ไข','รายการแก้ไข JSON'],...report.shifts.map(s=>{const r=s.reconciliation;return ['ข้อมูลทดสอบ',s.id,s.employee_id,bangkokTimestamp(s.openedAt),s.endedAt===null?'':bangkokTimestamp(s.endedAt),s.status,r.status,s.openingFloatSatang/100,r.cashNet/100,r.qrNet/100,r.cashIn/100,r.cashOut/100,r.expectedCash/100,r.actual?r.actual.countedCashSatang/100:'',r.actual?r.actual.verifiedQRSatang/100:'',r.actual?r.actual.retainedFloatSatang/100:'',r.expectedHandover===null?'':r.expectedHandover/100,r.actual?r.actual.handedOverSatang/100:'',r.cashDifference===null?'':r.cashDifference/100,r.qrDifference===null?'':r.qrDifference/100,r.totalDifference===null?'':r.totalDifference/100,r.handoverDifference===null?'':r.handoverDifference/100,s.approvedBy,s.reason,s.actual?s.actual.countedCashSatang/100:'',s.actual?s.actual.verifiedQRSatang/100:'',s.actual?s.actual.handedOverSatang/100:'',s.approvedSnapshot?.status,s.approvedSnapshot?s.approvedSnapshot.cashDifference/100:'',s.corrections.length,JSON.stringify(s.corrections)];})];return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function incomeSummaryCSV(report){
 const cell=v=>typeof v==='number'?String(v):'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const s=report.summary;
 const metrics=[['ยอดรับรวม',s.received/100,'บาท'],['ยอดคืน',s.refunded/100,'บาท'],['สุทธิ',s.net/100,'บาท'],['บริการหนีบ20',s.base/100,'บาท'],['ต่อเวลา',s.extension/100,'บาท'],['สระ100',s.wash100/100,'บาท'],['สินค้า',s.product/100,'บาท'],['เงินสดสุทธิ',s.cash.net/100,'บาท'],['QR สุทธิ (พนักงานยืนยัน)',s.qr.net/100,'บาท'],['บิลรับเงินในช่วงนี้',report.paidBillCount,'บิล'],['คิวเริ่มในช่วงนี้',report.sessionCount,'คิว'],['บิลค้างปัจจุบัน',report.unpaidCurrentCount,'บิล']];
 for(const e of report.employees){metrics.push(['พนักงาน '+e.name+' รับ',e.received/100,'บาท'],['พนักงาน '+e.name+' คืน',e.refunded/100,'บาท'],['พนักงาน '+e.name+' สุทธิ',e.net/100,'บาท']);}
 for(const [group,rows] of Object.entries(report.charts))for(const row of rows)metrics.push([group+' '+row.key+' สุทธิ',row.net/100,'บาท']);
 return '\uFEFF'+[['DEMO ONLY','หัวข้อ','ค่า','หน่วย','จาก (Asia/Bangkok)','ถึง (Asia/Bangkok)','พนักงานที่กรอง'],...metrics.map(row=>['ข้อมูลทดสอบ',...row,report.range.from,report.range.to,report.employee_id||'ทั้งหมด'])].map(row=>row.map(cell).join(',')).join('\r\n');
}
