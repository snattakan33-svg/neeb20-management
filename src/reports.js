import {fail,status,recognizedTransactions,billLines,billStatus,finance} from './domain.js';
export const bangkokDay=ms=>new Date(ms+7*3600000).toISOString().slice(0,10);
function midnight(day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('วันที่ไม่ถูกต้อง');
  const ms=Date.parse(day+'T00:00:00.000Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==day)fail('วันที่ไม่ถูกต้อง');return ms-7*3600000;
}
export function reportRange(input={},now=Date.now()){
  const mode=input.mode||'daily';let from,to;
  if(mode==='daily'){from=to=input.day||bangkokDay(now);}
  else if(mode==='monthly'){
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
  const range=reportRange(input,now),inside=ms=>Number.isFinite(ms)&&ms>=range.start&&ms<range.end;
  const transactions=recognizedTransactions(state).filter(t=>inside(t.at));
  const summary={base:0,extension:0,product:0,legacy:0,received:0,refunded:0,net:0,cash:{received:0,refunded:0,net:0},qr:{received:0,refunded:0,net:0},unknown:{received:0,refunded:0,net:0}};
  for(const t of transactions){
    const refund=t.type==='refund',method=['cash','qr'].includes(t.method)?t.method:'unknown',category=['base','extension','product'].includes(t.category)?t.category:'legacy';
    if(refund)summary.refunded+=t.amountSatang;else{summary.received+=t.amountSatang;summary[category]+=t.amountSatang;}
    summary[method][refund?'refunded':'received']+=t.amountSatang;
  }
  summary.net=summary.received-summary.refunded;for(const key of ['cash','qr','unknown'])summary[key].net=summary[key].received-summary[key].refunded;
  const sessions=state.sessions.filter(s=>inside(s.startedAt)).map(s=>{
    const moves=state.audit.filter(a=>a.type==='move'&&a.session_id===s.session_id);
    return {session_id:s.session_id,bill_id:s.bill_id,station_id:s.station_id,startedAt:s.startedAt,endsAt:s.endsAt,finishedAt:s.finishedAt??null,cancelledAt:s.cancelledAt??null,status:status(s,now),serviceStatus:s.serviceStatus,moves:moves.length,stationHistory:stationHistory(state,s),usageMilliseconds:usageMilliseconds(s,now),usageIntervals:s.usageIntervals||[],legacy:!!s.legacyPostpaid};
  });
  const bills=state.bills.filter(b=>inside(b.createdAt)||inside(b.paidAt)||transactions.some(t=>t.bill_id===b.id)).map(b=>{
    const session=state.sessions.find(s=>s.session_id===b.session_id),lines=billLines(state,b.id),financial=finance(state,b.id),payments=state.transactions.filter(t=>t.bill_id===b.id&&t.type==='payment');
    return {bill_id:b.id,session_id:b.session_id,station_id:session?.station_id??null,startedAt:session?.startedAt??null,finishedAt:session?.finishedAt??null,cancelledAt:session?.cancelledAt??null,usageMilliseconds:session?usageMilliseconds(session,now):null,status:billStatus(state,b.id),lines,serviceSatang:lines.filter(l=>l.kind!=='product').reduce((n,l)=>n+l.amountSatang,0),productSatang:lines.filter(l=>l.kind==='product').reduce((n,l)=>n+l.amountSatang,0),totalSatang:financial.charged,receivedSatang:financial.paid,refundedSatang:financial.refunded,netSatang:financial.net,cashSatang:payments.filter(t=>t.method==='cash').reduce((n,t)=>n+t.amountSatang,0),qrSatang:payments.filter(t=>t.method==='qr').reduce((n,t)=>n+t.amountSatang,0),paidAt:b.paidAt??null,paidBy:b.paidBy??null,paymentMethod:b.paymentMethod??null,payment_id:b.payment_id??null,transaction_ids:payments.map(t=>t.id)};
  });
  return {bills,demo:true,generatedAt:now,range,summary,sessionCount:sessions.length,finishedCount:sessions.filter(s=>s.status==='finished').length,cancelledCount:sessions.filter(s=>s.status==='cancelled').length,finishedInRange:state.sessions.filter(s=>inside(s.finishedAt)).length,cancelledInRange:state.sessions.filter(s=>inside(s.cancelledAt)).length,sessions,transactions,refunds:transactions.filter(t=>t.type==='refund')};
}
export function reportCSV(report){
  const cell=value=>{if(typeof value==='number')return String(value);let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['DEMO ONLY','เวลา UTC','ประเภท','หมวด','ช่องทาง','จำนวนบาท','Transaction ID','Session ID','บิล','อ้างอิงรายการเดิม','พนักงาน','เหตุผล'],...report.transactions.map(t=>['ข้อมูลทดสอบ',new Date(t.at).toISOString(),t.type,t.category||'legacy',t.method||'unknown',(t.type==='refund'?-1:1)*t.amountSatang/100,t.id,t.session_id,t.bill_id,t.original_transaction_id,t.employee_id,t.reason])];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function billsCSV(report){
 const cell=value=>{if(typeof value==='number')return String(value);let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const time=ms=>ms===null?'':new Date(ms).toISOString();
 const rows=[['DEMO ONLY','Bill ID','Session ID','Station','เริ่ม UTC','จบ UTC','ใช้งานวินาที','รายการบริการ','รายการสินค้า','ยอดบริการบาท','ยอดสินค้าบาท','ยอดรวมบาท','รับเงินสดบาท','รับ QR บาท','ชำระ UTC','พนักงาน','สถานะ','Payment ID','Transaction IDs','คืนเงินบาท','สุทธิบาท'],...report.bills.map(b=>['ข้อมูลทดสอบ',b.bill_id,b.session_id,b.station_id,time(b.startedAt),time(b.finishedAt),b.usageMilliseconds===null?'ไม่ทราบ':b.usageMilliseconds/1000,JSON.stringify(b.lines.filter(l=>l.kind!=='product')),JSON.stringify(b.lines.filter(l=>l.kind==='product')),b.serviceSatang/100,b.productSatang/100,b.totalSatang/100,b.cashSatang/100,b.qrSatang/100,time(b.paidAt),b.paidBy,b.status,b.payment_id,b.transaction_ids.join(' / '),b.refundedSatang/100,b.netSatang/100])];
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
