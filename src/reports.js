import {fail,status} from './domain.js';
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
  const transactions=state.transactions.filter(t=>inside(t.at));
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
  return {demo:true,generatedAt:now,range,summary,sessionCount:sessions.length,finishedCount:sessions.filter(s=>s.status==='finished').length,cancelledCount:sessions.filter(s=>s.status==='cancelled').length,finishedInRange:state.sessions.filter(s=>inside(s.finishedAt)).length,cancelledInRange:state.sessions.filter(s=>inside(s.cancelledAt)).length,sessions,transactions,refunds:transactions.filter(t=>t.type==='refund')};
}
export function reportCSV(report){
  const cell=value=>{if(typeof value==='number')return String(value);let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['DEMO ONLY','เวลา UTC','ประเภท','หมวด','ช่องทาง','จำนวนบาท','Transaction ID','Session ID','บิล','อ้างอิงรายการเดิม','พนักงาน','เหตุผล'],...report.transactions.map(t=>['ข้อมูลทดสอบ',new Date(t.at).toISOString(),t.type,t.category||'legacy',t.method||'unknown',(t.type==='refund'?-1:1)*t.amountSatang/100,t.id,t.session_id,t.bill_id,t.original_transaction_id,t.employee_id,t.reason])];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
