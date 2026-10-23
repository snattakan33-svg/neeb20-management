// Integer satang only. Commission is a component of labor, never an extra deduction twice.
export const COST_FIELDS=['materialsSatang','electricitySatang','waterSatang','laborSatang','otherSatang'];
export function costError(message,code='INVALID'){const e=new Error(message);e.code=code;throw e;}
export function requireCostManager(state,actorId){if(state.employees.find(e=>e.id===actorId)?.role!=='manager')costError('ต้นทุนและกำไรสำหรับผู้จัดการเท่านั้น','FORBIDDEN');}
export function validServiceCost(cost){
 if(!cost||!COST_FIELDS.every(k=>Number.isSafeInteger(cost[k])&&cost[k]>=0&&cost[k]<=100000000)||!Number.isSafeInteger(cost.commissionIncludedSatang)||cost.commissionIncludedSatang<0||cost.commissionIncludedSatang>cost.laborSatang)costError('ต้นทุนไม่ถูกต้อง ค่าคอมที่รวมแล้วต้องไม่เกินค่าแรง');return structuredClone(cost);
}
export function estimatedCost(snapshot){return COST_FIELDS.reduce((n,k)=>n+snapshot[k],0);}
export function ensureCostState(state){
 state.services ||= [{id:'base',name:'ค่าบริการหนีบ20',priceSatang:2000},{id:'extension',name:'ต่อเวลา 5 นาที',priceSatang:500},{id:'wash100',name:'บริการสระ100',priceSatang:10000}].map(s=>({...s,cost:null}));
 state.costAdjustments ||= [];state.catalogHistory ||= [];state.operatingExpenses ||= [];state.operatingExpenseCategories ||= ['rent','fixedSalary','other'];state.costSchema=1;return state;
}
export function serviceCharge(state,kind,at,id){const s=state.services.find(s=>s.id===kind);if(!s)costError('ไม่พบบริการ');return {id,kind,name:s.name,service_id:s.id,amountSatang:s.priceSatang,at,costSnapshot:s.cost?{...structuredClone(s.cost),capturedAt:at,basis:'estimated-service-time'}:null};}
export function applyCostCommand(state,command,actor,now,{newId,log}){
 const p=command.payload||{};
 if(!['editService','recordServiceCost'].includes(command.type))return false;
 requireCostManager(state,actor.id);
 if(command.type==='editService'){
  const s=state.services.find(s=>s.id===p.service_id);if(!s||!Number.isSafeInteger(p.priceSatang)||p.priceSatang<=0||p.priceSatang>100000000)costError('บริการหรือราคาขายไม่ถูกต้อง');
  const before=structuredClone(s);s.cost=validServiceCost(p.cost);s.priceSatang=p.priceSatang;
  const event=log('editService',null,before,s);state.catalogHistory.push(structuredClone(event));
 }else{
  const bill=state.bills.find(b=>b.id===p.bill_id),line=bill?.charges.find(l=>l.id===p.charge_id&&l.kind!=='product'&&!l.voided);
  if(!line||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>500)costError('ต้องเลือกรายการบริการและระบุเหตุผล');
  if(p.actualCommissionSatang!==null&&(!Number.isSafeInteger(p.actualCommissionSatang)||p.actualCommissionSatang<0||p.actualCommissionSatang>100000000))costError('ค่าคอมจริงไม่ถูกต้อง');
  // Actual incurred cost permits zero for an unused cancellation. This is explicit, never automatic on refunds.
  const actualCost=p.actualCost===null?null:validServiceCost(p.actualCost);
  if(!actualCost&&p.actualCommissionSatang===null)costError('ระบุต้นทุนจริงหรือค่าคอมจริง');
  const entry={id:newId(),bill_id:bill.id,charge_id:line.id,actualCost,actualCommissionSatang:p.actualCommissionSatang,at:now,employee_id:actor.id,reason:p.reason.trim(),command_id:command.id};
  state.costAdjustments.push(entry);log('recordServiceCost',state.sessions.find(s=>s.bill_id===bill.id),null,entry,entry.reason);
 }
 return true;
}
export function serviceCostFor(state,line,billId){
 const adjustments=(state.costAdjustments||[]).filter(a=>a.bill_id===billId&&a.charge_id===line.id);
 const actual=adjustments.filter(a=>a.actualCost!==null).at(-1),commission=adjustments.filter(a=>a.actualCommissionSatang!==null).at(-1);
 const snapshot=actual?.actualCost||line.costSnapshot;if(!snapshot)return {costSatang:null,estimated:true};
 return {costSatang:estimatedCost(snapshot)-(commission?snapshot.commissionIncludedSatang:0)+(commission?.actualCommissionSatang||0),estimated:!actual,commissionActual:commission?.actualCommissionSatang??null};
}
// Demo identity selection is NOT authentication. Strip all sensitive historical copies too.
export function costVisibleState(state,actorId='staff-01'){
 if(!state.employees.some(e=>e.id===actorId))costError('ไม่พบพนักงาน','FORBIDDEN');
 if(state.employees.find(e=>e.id===actorId).role==='manager')return state;
 const redact=value=>{
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(cost|commission|profit|catalogHistory|schemaArchives|legacyArchive|fingerprint|operatingExpense)/i.test(k)).map(([k,v])=>[k,redact(v)]));
  return value;
 };return redact(state);
}
