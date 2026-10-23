import {requireCostManager,serviceCostFor} from './costing.js';
import {reportRange,bangkokTimestamp} from './reports.js';
import {recognizedTransactions} from './domain.js';
export function makeProfitReport(state,input={},actorId,now=Date.now()){
 requireCostManager(state,actorId);const range=reportRange(input,now,state),inside=at=>at>=range.start&&at<range.end;
 const rows=[],unknown=[],payments=recognizedTransactions(state).filter(t=>t.type==='payment');
 for(const tx of recognizedTransactions(state).filter(t=>inside(t.at)&&(!input.employee_id||t.employee_id===input.employee_id))){
  const payment=tx.type==='payment'?tx:payments.find(p=>p.id===tx.original_transaction_id);
  const product=(payment?.category||tx.category)==='product';let cost=null,estimated=false;
  if(tx.type==='payment'){
   if(product)cost=Number.isSafeInteger(tx.unitCostSatang)&&Number.isSafeInteger(tx.quantity)?tx.unitCostSatang*tx.quantity:null;
   else {const result=serviceCostFor(state,{id:tx.charge_id,costSnapshot:tx.costSnapshot},tx.bill_id);cost=result.costSatang;estimated=result.estimated;}
  }else if(payment){
   // Money-only refunds retain incurred cost. Only physical returns to stock reverse product COGS.
   cost=product&&tx.restock?(Number.isSafeInteger(payment.unitCostSatang)&&Number.isSafeInteger(tx.quantity)?-payment.unitCostSatang*tx.quantity:null):0;
  }
  const netRevenueSatang=tx.type==='refund'?-tx.amountSatang:tx.amountSatang;
  const row={transaction_id:tx.id,bill_id:tx.bill_id,session_id:tx.session_id,at:tx.at,employee_id:tx.employee_id,category:product?'product':'service',kind:tx.category,netRevenueSatang,costSatang:cost,grossProfitSatang:cost===null?null:netRevenueSatang-cost,estimated};rows.push(row);if(cost===null)unknown.push(tx.id);
 }
 // Explicitly recorded incurred cost on cancelled, never-paid services is a loss, not paid revenue.
 for(const bill of state.bills.filter(b=>b.cancelled&&!payments.some(t=>t.bill_id===b.id))){
  for(const line of bill.charges.filter(l=>l.kind!=='product'&&!l.voided)){
   const actual=state.costAdjustments.filter(a=>a.bill_id===bill.id&&a.charge_id===line.id&&a.actualCost!==null).at(-1);
   if(!actual||!inside(actual.at)||(input.employee_id&&actual.employee_id!==input.employee_id))continue;
   const c=serviceCostFor(state,line,bill.id);rows.push({transaction_id:actual.id,bill_id:bill.id,session_id:bill.session_id,at:actual.at,employee_id:actual.employee_id,category:'service',kind:'cancelled-incurred-cost',netRevenueSatang:0,costSatang:c.costSatang,grossProfitSatang:-c.costSatang,estimated:false});
  }
 }
 const summarize=items=>{const netRevenueSatang=items.reduce((n,r)=>n+r.netRevenueSatang,0),knownCostSatang=items.reduce((n,r)=>n+(r.costSatang||0),0),complete=items.every(r=>r.costSatang!==null),grossProfitSatang=complete?netRevenueSatang-knownCostSatang:null;return {netRevenueSatang,costSatang:complete?knownCostSatang:null,knownCostSatang,grossProfitSatang,marginPercent:complete&&netRevenueSatang>0?grossProfitSatang/netRevenueSatang*100:null,complete,estimatedCount:items.filter(r=>r.estimated).length};};
 return {demo:true,range,generatedAt:now,policy:'รับรู้รายได้ตามวันรับ/คืนเงิน ต้นทุนบริการใช้ข้อมูลจริงล่าสุดแทนประมาณการในงวดขายเดิม ไม่หักค่าคอมซ้ำ ไม่รวมค่าใช้จ่ายดำเนินงาน',product:summarize(rows.filter(r=>r.category==='product')),service:summarize(rows.filter(r=>r.category==='service')),total:summarize(rows),unknownCostTransactionIds:unknown,rows};
}
export function profitCSV(report){
 const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return '\uFEFF'+[['ข้อมูลทดสอบ กำไรขั้นต้น ไม่ใช่กำไรสุทธิ',report.range.from,report.range.to],...['product','service','total'].map(k=>[k,'รายได้สุทธิ',report[k].netRevenueSatang/100,'ต้นทุน',report[k].costSatang===null?'ต้นทุนไม่ครบ':report[k].costSatang/100,'กำไรขั้นต้น',report[k].grossProfitSatang===null?'ต้นทุนไม่ครบ':report[k].grossProfitSatang/100,'อัตรากำไร %',report[k].marginPercent]),['Transaction','Bill','Session','เวลา Asia/Bangkok','พนักงาน','หมวด','รายได้สุทธิบาท','ต้นทุนบาท','กำไรขั้นต้นบาท','ประมาณการ'],...report.rows.map(r=>[r.transaction_id,r.bill_id,r.session_id,bangkokTimestamp(r.at),r.employee_id,r.category,r.netRevenueSatang/100,r.costSatang===null?'ต้นทุนไม่ครบ':r.costSatang/100,r.grossProfitSatang===null?'ต้นทุนไม่ครบ':r.grossProfitSatang/100,r.estimated?'ใช่':'ไม่'])].map(row=>row.map(quote).join(',')).join('\r\n');
}
