import {ensureShiftState,applyShiftCommand,assignNewTransactions,validateShifts} from './shifts.js';
export const STORAGE_KEY = 'neeb20:demo:v5';
export const PREVIOUS_KEY = 'neeb20:demo:v4';
export const OLDER_KEY = 'neeb20:demo:v3';
export const ANCIENT_KEY = 'neeb20:demo:v2';
export const LEGACY_KEY = 'neeb20:demo:v1';
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
export function createDemo() {
  const state={version:5,demo:true,shifts:[],shiftControl:{enabled:false},revision:0,stations:Array.from({length:12},(_,i)=>({id:i+1,session_id:null})),sessions:[],bills:[],transactions:[],audit:[],commands:[],
    employees:[{id:'staff-01',name:'พนักงานทดสอบ 01',role:'staff'},{id:'manager-01',name:'ผู้จัดการทดสอบ 01',role:'manager'}],
    stockMovements:[],products:[{id:'p1',sku:'DEMO001',category:'อุปกรณ์',active:true,name:'หวีทดสอบ',barcode:'885000000001',cost:15,price:29,stock:20},{id:'p2',sku:'DEMO002',category:'ดูแลผม',active:true,name:'เซรั่มทดสอบ',barcode:'885000000002',cost:45,price:79,stock:10}],cart:[],receipts:[]};
  state.stockMovements=openingMovements(state.products,0,'ยอดตัวอย่างเริ่มต้น — ไม่ใช่สต๊อกจริง');return state;
}
function openingMovements(products,at,reason){return products.map(p=>({id:newId(),product_id:p.id,quantityDelta:p.stock,before:0,after:p.stock,kind:'opening',reason,at,employee_id:'system-demo',command_id:'opening',transaction_id:null}));}
export function fail(message,code='INVALID') { const e=new Error(message);e.code=code;throw e; }
export function status(session,now=Date.now()) {
  if (!session) return 'idle';
  if(session.serviceStatus!=='active') return session.serviceStatus;
  return session.endsAt<=now?'expired':session.endsAt-now<=300000?'warning':'active';
}
export const sessionAt=(state,stationId)=>state.sessions.find(s=>s.session_id===state.stations.find(t=>t.id===stationId)?.session_id);
export function finance(state,billId) {
  const b=state.bills.find(b=>b.id===billId);if(!b)fail('ไม่พบบิล');
  const tx=state.transactions.filter(t=>t.bill_id===billId);
  const paid=tx.filter(t=>t.type==='payment').reduce((n,t)=>n+t.amountSatang,0);
  const refunded=tx.filter(t=>t.type==='refund').reduce((n,t)=>n+t.amountSatang,0);
  const charged=b.charges.filter(l=>!l.voided).reduce((n,l)=>n+l.amountSatang,0);
  return {charged,paid,refunded,net:paid-refunded,due:b.cancelled?0:Math.max(0,charged-paid),
    status:paid===0?(b.cancelled?'cancelled-before-payment':'unpaid'):refunded===paid?'refund-full':refunded>0?'refund-partial':paid>=charged?'paid':'unpaid'};
}
export function billLines(state,billId){
  const bill=state.bills.find(b=>b.id===billId);if(!bill)fail('ไม่พบบิล');
  return bill.charges.filter(c=>!c.voided).map(c=>({...c,name:c.name||(c.kind==='extension'?'ต่อเวลา 5 นาที':'ค่าบริการหนีบ20'),quantity:c.quantity||1,unitPriceSatang:c.unitPriceSatang??c.amountSatang}));
}
export function billStatus(state,billId){const b=state.bills.find(b=>b.id===billId),f=finance(state,billId);return f.refunded>0?'REFUNDED':b.cancelled?'CANCELLED':f.paid>0&&f.due===0?'PAID':'UNPAID';}
function refreshBills(state){for(const bill of state.bills)bill.status=billStatus(state,bill.id);}
export function recognizedTransactions(state){
  return state.transactions.filter(t=>!t.bill_id||state.bills.some(b=>b.id===t.bill_id&&(b.everPaid||finance(state,b.id).paid>0)));
}
export function salesSummary(state) {
  return recognizedTransactions(state).reduce((a,t)=>{a[t.type==='payment'?'received':'refunded']+=t.amountSatang;a.net=a.received-a.refunded;return a;},{received:0,refunded:0,net:0});
}
export function cartLines(state) {
  return state.cart.map(l=>l.kind==='service'?{...l,name:`บริการ ${l.session_id.slice(0,8)}`,price:finance(state,l.bill_id).due/100,quantity:1}:l).filter(l=>l.price>0);
}
export const total=cart=>Math.round(cart.reduce((sum,l)=>sum+l.price*l.quantity,0)*100)/100;
function needReason(reason){if(typeof reason!=='string'||!reason.trim()||reason.length>500)fail('ต้องระบุเหตุผล 1–500 ตัวอักษร');return reason.trim();}
function addToCart(state,s){if(finance(state,s.bill_id).due>0&&!state.cart.some(l=>l.bill_id===s.bill_id))state.cart.push({kind:'service',bill_id:s.bill_id,session_id:s.session_id});}
function validMoney(n,allowZero=true){return Number.isFinite(n)&&n>=(allowZero?0:0.01)&&n<=1000000&&Math.abs(n*100-Math.round(n*100))<0.000001;}
// All writes use the same command boundary in the browser and the server.
// Returns a new state: failures never partially change the caller's state.
export function execute(original,command,actorId,now=Date.now()) {
  if(!command||typeof command.id!=='string'||command.id.length<1||command.id.length>100)fail('ต้องมีรหัสคำสั่ง');
  const payload=command.payload||{};
  const fingerprint=JSON.stringify({type:command.type,payload,actorId});
  const previous=original.commands.find(c=>c.id===command.id);
  if(previous){if(previous.fingerprint!==fingerprint)fail('รหัสคำสั่งซ้ำแต่เนื้อหาต่างกัน','CONFLICT');return {state:original,result:previous.result,replayed:true};}
  if(command.expectedRevision!==original.revision)fail('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจสอบใหม่และยืนยันอีกครั้ง','CONFLICT');
  const state=structuredClone(original),actor=state.employees.find(e=>e.id===actorId);
  if(!actor)fail('ไม่พบพนักงาน','FORBIDDEN');
  const manager=()=>{if(actor.role!=='manager')fail('ต้องได้รับอนุมัติจากผู้จัดการ','FORBIDDEN');};
  const getSession=()=>{const s=state.sessions.find(s=>s.session_id===payload.session_id);if(!s)fail('ไม่พบ Session');return s;};
  const getStation=id=>{const t=state.stations.find(s=>s.id===id);if(!t)fail('ไม่พบ Station');return t;};
  const active=s=>{if(s.serviceStatus!=='active')fail('คิวไม่ได้กำลังใช้งาน');const station=getStation(s.station_id);if(station.session_id!==s.session_id||payload.expectedStationId!==s.station_id)fail('คิวถูกย้ายหรือจุดเปลี่ยนแล้ว กรุณาตรวจสอบ','CONFLICT');return station;};
  const log=(type,s,before,after,reason=null,extra={})=>{
    const event={id:newId(),command_id:command.id,type,at:now,employee_id:actor.id,role:actor.role,session_id:s?.session_id||null,before:structuredClone(before),after:structuredClone(after),reason,...extra};
    state.audit.push(event);if(s)s.history.push(event.id);return event;
  };
  const paymentMethod=()=>{if(!['cash','qr'].includes(payload.method))fail('เลือกเงินสดหรือ QR');return payload.method;};
  const received=()=>{paymentMethod();if(payload.paymentConfirmed!==true)fail('ต้องยืนยันว่าได้รับชำระแล้วก่อนเริ่ม/เพิ่มบริการหรือขายสินค้า');};
  const moveStock=(product,delta,kind,reason,transactionId=null)=>{
    const before=product.stock;if(!Number.isSafeInteger(delta)||product.stock+delta<0||product.stock+delta>1000000)fail('จำนวนสต๊อกไม่ถูกต้อง');product.stock+=delta;
    const movement={id:newId(),product_id:product.id,quantityDelta:delta,before,after:product.stock,kind,reason,at:now,employee_id:actor.id,command_id:command.id,transaction_id:transactionId};state.stockMovements.push(movement);log('stock:'+kind,null,{stock:before},{stock:product.stock},reason,{product_id:product.id,movement_id:movement.id});return movement;
  };
  const mutableBill=s=>{
    const bill=state.bills.find(b=>b.id===s.bill_id);if(bill.cancelled||finance(state,bill.id).paid>0)fail('บิลชำระแล้วหรือยกเลิกแล้ว ไม่สามารถเพิ่ม/แก้รายการได้');
    if(s.cancelRequest)fail('คิวอยู่ระหว่างรออนุมัติยกเลิก');return bill;
  };
  const settleBill=(bill,s)=>{
    received();const f=finance(state,bill.id);if(bill.cancelled||f.paid>0)fail('บิลชำระแล้วหรือมีประวัติรับเงินแล้ว ห้ามรับซ้ำ','CONFLICT');
    const lines=billLines(state,bill.id);if(!lines.length)fail('บิลไม่มีรายการ');
    const required=new Map();for(const line of lines.filter(l=>l.kind==='product'))required.set(line.product_id,(required.get(line.product_id)||0)+line.quantity);
    for(const [id,quantity] of required){const p=state.products.find(p=>p.id===id);if(!p||!p.active||p.stock<quantity)fail('สินค้าไม่เปิดขายหรือสต๊อกไม่เพียงพอ กรุณาจัดการรายการในบิล');}
    const receipt={id:newId(),payment_id:newId(),bill_id:bill.id,session_id:s?.session_id||null,createdAt:now,demo:true,total:f.charged/100,method:paymentMethod(),lines:lines.map(l=>({kind:l.kind==='product'?'product':'service',category:l.kind,name:l.name,quantity:l.quantity,price:l.unitPriceSatang/100,charge_id:l.id})),transaction_ids:[]};
    for(const line of lines){
      const before=finance(state,bill.id),tx={id:newId(),payment_id:receipt.payment_id,type:'payment',category:['base','extension','wash100','product'].includes(line.kind)?line.kind:'legacy',method:paymentMethod(),amountSatang:line.amountSatang,bill_id:bill.id,session_id:s?.session_id||null,station_id:s?.station_id||null,charge_id:line.id,receipt_id:receipt.id,command_id:command.id,at:now,employee_id:actor.id,demo:true,...(line.kind==='product'?{product_id:line.product_id,quantity:line.quantity,unitPriceSatang:line.unitPriceSatang,unitCostSatang:line.unitCostSatang}:{})};
      state.transactions.push(tx);receipt.transaction_ids.push(tx.id);
      if(line.kind==='product')moveStock(state.products.find(p=>p.id===line.product_id),-line.quantity,'sale','ชำระบิล '+bill.id,tx.id);
      log('payment',s,before,finance(state,bill.id),null,{transaction_id:tx.id,payment_id:receipt.payment_id,bill_id:bill.id,method:tx.method});
    }
    bill.everPaid=true;bill.paidAt=now;bill.paidBy=actor.id;bill.paymentMethod=paymentMethod();bill.payment_id=receipt.payment_id;bill.transaction_ids=receipt.transaction_ids.slice();state.receipts.push(receipt);
    return {bill_id:bill.id,session_id:s?.session_id||null,transaction_id:receipt.payment_id,transaction_ids:receipt.transaction_ids,receipt_id:receipt.id};
  };
  const refundSession=(s,amount,reason)=>{
    if(!Number.isSafeInteger(amount)||amount<=0||amount>finance(state,s.bill_id).net)fail('ยอดคืนต้องมากกว่า 0 และไม่เกินยอดที่รับสุทธิ');
    paymentMethod();if(payload.refundConfirmed!==true)fail('ต้องยืนยันการคืนเงินก่อนบันทึก');
    let remaining=amount;const ids=[];
    for(const originalTx of state.transactions.filter(t=>t.bill_id===s.bill_id&&t.type==='payment')){
      const returned=state.transactions.filter(t=>t.type==='refund'&&t.original_transaction_id===originalTx.id).reduce((n,t)=>n+t.amountSatang,0);
      // v2 refunds have no original reference: only allocate what the whole bill still permits.
      const part=Math.min(remaining,originalTx.amountSatang-returned);if(part<=0)continue;
      const before=finance(state,s.bill_id),tx={id:newId(),type:'refund',category:originalTx.category||'legacy',method:paymentMethod(),amountSatang:part,bill_id:s.bill_id,session_id:s.session_id,original_transaction_id:originalTx.id,...(originalTx.category==='product'?{product_id:originalTx.product_id,quantity:part===originalTx.amountSatang-returned?Math.max(0,originalTx.quantity-state.transactions.filter(r=>r.original_transaction_id===originalTx.id).reduce((n,r)=>n+(r.quantity||0),0)):0,restock:false}:{}),command_id:command.id,at:now,employee_id:actor.id,demo:true,reason};
      state.transactions.push(tx);ids.push(tx.id);log('refund',s,before,finance(state,s.bill_id),reason,{transaction_id:tx.id,approvedBy:actor.id});remaining-=part;if(!remaining)break;
    }
    if(remaining)fail('ไม่สามารถอ้างอิงรายการรับเงินเดิมได้');return ids;
  };
  const closeUsage=s=>{const open=s.usageIntervals?.find(i=>i.endedAt===null);if(open)open.endedAt=now;};
  let result={};
  const shiftOutcome=applyShiftCommand(state,command,actor,now,{newId,log});
  if(shiftOutcome.handled)result=shiftOutcome.result;
  else switch(command.type){
    case 'start':{
      const station=getStation(payload.station_id);if(station.session_id)fail('จุดนี้มีคิวอยู่แล้ว','CONFLICT');
      const id=newId(),billId=newId();
      const s={session_id:id,station_id:station.id,startedAt:now,endsAt:now+1500000,serviceStatus:'active',feeSatang:2000,extensions:0,bill_id:billId,history:[],cancelRequest:null,usageIntervals:[{startedAt:now,endedAt:null}],billingFlow:'session-bill'};
      state.sessions.push(s);state.bills.push({id:billId,session_id:id,status:'UNPAID',createdAt:now,cancelled:false,charges:[{id:newId(),kind:'base',name:'ค่าบริการหนีบ20',amountSatang:2000,at:now}]});station.session_id=id;
      log('start',s,null,s);result={session_id:id,bill_id:billId};break;
    }
    case 'markUsed':{
      const s=getSession();active(s);if(s.cancelRequest)fail('คิวรออนุมัติยกเลิก');
      if(s.usageIntervals.some(i=>i.endedAt===null))fail('ยืนยันเริ่มใช้จริงแล้ว');
      const before=structuredClone(s);s.usageIntervals.push({startedAt:now,endedAt:null});log('markUsed',s,before,s);break;
    }
    case 'move':{
      const s=getSession(),source=active(s),target=getStation(payload.targetStationId);const reason=needReason(payload.reason);
      if(source.id===target.id||target.session_id)fail('จุดปลายทางไม่ว่างหรือเป็นจุดเดิม','CONFLICT');
      const before=structuredClone(s);source.session_id=null;target.session_id=s.session_id;s.station_id=target.id;
      log('move',s,before,s,reason,{correction:payload.correction===true});break;
    }
    case 'extend':{
      const s=getSession();active(s);const bill=mutableBill(s);
      const before=structuredClone(s);s.endsAt+=300000;s.extensions++;s.feeSatang+=500;
      bill.charges.push({id:newId(),kind:'extension',name:'ต่อเวลา 5 นาที',amountSatang:500,at:now});log('extend',s,before,s);result={bill_id:bill.id};break;
    }
    case 'finish':{
      const s=getSession();if(s.serviceStatus==='finished'){result={session_id:s.session_id,alreadyFinished:true};break;}
      const station=active(s);if(finance(state,s.bill_id).due>0||finance(state,s.bill_id).paid===0)fail('บิลนี้ยังไม่ได้ชำระเงิน ต้องการไปหน้าคิดเงินหรือไม่?','PAYMENT_REQUIRED');const before=structuredClone(s);closeUsage(s);s.serviceStatus='finished';s.finishedAt=now;station.session_id=null;
      log('finish',s,before,s);break;
    }
    case 'addBillProduct':{
      const s=getSession();active(s);const bill=mutableBill(s),product=state.products.find(p=>p.id===payload.product_id),quantity=payload.quantity;
      if(!product||!product.active||!Number.isSafeInteger(quantity)||quantity<1)fail('สินค้า/จำนวนไม่ถูกต้อง');
      const current=billLines(state,bill.id).filter(l=>l.product_id===product.id).reduce((n,l)=>n+l.quantity,0);if(current+quantity>product.stock)fail('จำนวนเกินสต๊อกปัจจุบัน');
      const before=structuredClone(bill);bill.charges.push({id:newId(),kind:'product',product_id:product.id,sku:product.sku,name:product.name,quantity,unitPriceSatang:Math.round(product.price*100),unitCostSatang:Math.round(product.cost*100),amountSatang:Math.round(product.price*100)*quantity,at:now});
      log('addBillProduct',s,before,bill);break;
    }
    case 'removeBillProduct':{
      const s=getSession();active(s);const bill=mutableBill(s),line=bill.charges.find(c=>c.id===payload.charge_id&&c.kind==='product'&&!c.voided);if(!line)fail('ไม่พบรายการสินค้า');const before=structuredClone(line);line.voided=true;line.voidReason=needReason(payload.reason);log('removeBillProduct',s,before,line,line.voidReason);break;
    }
    case 'payBill':{
      const s=getSession();if(s.serviceStatus==='active')active(s);if(s.serviceStatus==='cancelled'||s.cancelRequest)fail('คิวถูกยกเลิกหรือรออนุมัติยกเลิก');result=settleBill(state.bills.find(b=>b.id===s.bill_id),s);break;
    }
    case 'cancelUnpaid':{
      const s=getSession(),reason=needReason(payload.reason),bill=state.bills.find(b=>b.id===s.bill_id);if(s.serviceStatus==='cancelled'){result={alreadyCancelled:true};break;}
      if(finance(state,bill.id).paid>0)fail('รับเงินแล้ว ต้องให้ผู้จัดการดำเนินการคืนเงิน/VOID','FORBIDDEN');
      const station=s.serviceStatus==='active'?active(s):getStation(s.station_id);if(!['active','finished'].includes(s.serviceStatus))fail('สถานะคิวไม่ถูกต้อง');const before=structuredClone(s);closeUsage(s);if(station.session_id===s.session_id)station.session_id=null;s.serviceStatus='cancelled';s.cancelledAt=now;bill.cancelled=true;s.cancelRequest=null;log('cancel',s,before,s,reason,{bill_id:bill.id});break;
    }
    case 'requestCancel':{
      const s=getSession(),reason=needReason(payload.reason);if(s.serviceStatus==='cancelled'||s.cancelRequest)fail('ยกเลิกแล้วหรือมีคำขออยู่แล้ว');
      if(s.serviceStatus==='active')active(s);
      const before=structuredClone(s);s.cancelRequest={id:newId(),reason,requestedBy:actor.id,at:now};log('requestCancel',s,before,s,reason);break;
    }
    case 'approveCancel':{
      manager();const s=getSession(),reason=needReason(payload.reason);
      if(s.serviceStatus==='cancelled'){result={alreadyCancelled:true};break;}
      if(!s.cancelRequest)fail('ไม่มีคำขอที่รออนุมัติ');
      const f=finance(state,s.bill_id),amount=payload.refundAmountSatang;
      if(typeof payload.unused!=='boolean'||!Number.isSafeInteger(amount)||amount<0||amount>f.net)fail('ระบุการใช้บริการและยอดคืนให้ถูกต้อง');
      if(payload.unused&&s.usageIntervals.length)fail('มีประวัติเริ่มใช้จริงแล้ว ให้ใช้การพิจารณาตามนโยบาย');
      if(payload.unused&&amount!==f.net)fail('ยังไม่ได้ใช้บริการต้องคืนเต็มจำนวนที่รับสุทธิ');
      const before=structuredClone(s),request=structuredClone(s.cancelRequest);const station=getStation(s.station_id);
      const refunds=amount?refundSession(s,amount,reason):[];
      if(station.session_id===s.session_id)station.session_id=null;
      closeUsage(s);s.serviceStatus='cancelled';s.cancelledAt=now;s.cancellation={...request,approvedBy:actor.id,approvedAt:now,approvalReason:reason,unused:payload.unused,refundAmountSatang:amount};s.cancelRequest=null;
      state.bills.find(b=>b.id===s.bill_id).cancelled=true;state.cart=state.cart.filter(l=>l.bill_id!==s.bill_id);
      log('cancel',s,before,s,reason,{request,refund_transaction_ids:refunds});result={refund_transaction_ids:refunds};break;
    }
    case 'restore':{
      manager();const s=getSession(),reason=needReason(payload.reason);if(s.serviceStatus!=='finished')fail('กู้คืนได้เฉพาะคิวที่จบแล้ว');if(finance(state,s.bill_id).due>0)fail('บิลเดิมยังไม่ชำระ');
      const station=getStation(payload.targetStationId);if(station.session_id)fail('จุดที่จะกู้คืนไม่ว่าง','CONFLICT');
      const before=structuredClone(s);s.station_id=station.id;s.serviceStatus='active';s.finishedAt=null;station.session_id=s.session_id;if(s.billingFlow==='session-bill')s.usageIntervals.push({startedAt:now,endedAt:null});
      log('restore',s,before,s,reason,{approvedBy:actor.id});break;
    }
    case 'addProduct':
    case 'editProduct':{
      manager();const p=payload,editing=command.type==='editProduct';
      if(typeof p.sku!=='string'||!p.sku.trim()||p.sku.length>64||typeof p.category!=='string'||!p.category.trim()||p.category.length>80||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.barcode!=='string'||p.barcode.length>80||!validMoney(p.cost)||!validMoney(p.price,false)||(!editing&&(!Number.isInteger(p.stock)||p.stock<0||p.stock>1000000)))fail('ข้อมูลสินค้าไม่ถูกต้อง');
      const product=editing?state.products.find(x=>x.id===p.product_id):{id:newId(),stock:0,active:true};if(!product)fail('ไม่พบสินค้า');
      if(state.products.some(x=>x.id!==product.id&&(x.sku.toLowerCase()===p.sku.trim().toLowerCase()||(p.barcode&&x.barcode.toLowerCase()===p.barcode.trim().toLowerCase()))))fail('รหัสสินค้าหรือบาร์โค้ดซ้ำ');
      const before=editing?structuredClone(product):null;Object.assign(product,{sku:p.sku.trim(),name:p.name.trim(),category:p.category.trim(),barcode:p.barcode.trim(),cost:p.cost,price:p.price});
      if(!editing){state.products.push(product);if(p.stock)moveStock(product,p.stock,'opening','ยอดตั้งต้นสินค้าทดสอบ');}
      log(command.type,null,before,product);break;
    }
    case 'setProductActive':{
      manager();const p=state.products.find(p=>p.id===payload.product_id);if(!p||typeof payload.active!=='boolean')fail('ไม่พบสินค้าหรือสถานะไม่ถูกต้อง');const before=structuredClone(p);p.active=payload.active;log('setProductActive',null,before,p,needReason(payload.reason));break;
    }
    case 'receiveStock':
    case 'adjustStock':{
      if(command.type==='adjustStock')manager();const p=state.products.find(p=>p.id===payload.product_id),delta=payload.quantityDelta,reason=needReason(payload.reason);
      if(!p||!Number.isSafeInteger(delta)||!delta||(command.type==='receiveStock'&&delta<0))fail('จำนวนรับ/ปรับสต๊อกไม่ถูกต้อง');moveStock(p,delta,command.type,reason);break;
    }
    case 'returnProduct':{
      manager();paymentMethod();if(payload.refundConfirmed!==true)fail('ต้องยืนยันคืนเงินแล้ว');
      const tx=state.transactions.find(t=>t.id===payload.transaction_id&&t.type==='payment'&&t.category==='product'),quantity=payload.quantity,reason=needReason(payload.reason);
      if(!tx||!Number.isSafeInteger(quantity)||quantity<=0||typeof payload.restock!=='boolean')fail('รายการคืนสินค้าไม่ถูกต้อง');
      const already=state.transactions.filter(t=>t.type==='refund'&&t.original_transaction_id===tx.id).reduce((n,t)=>n+(t.quantity||0),0);
      const refundedMoney=state.transactions.filter(t=>t.type==='refund'&&t.original_transaction_id===tx.id).reduce((n,t)=>n+t.amountSatang,0);
      if(already+quantity>tx.quantity||quantity*tx.unitPriceSatang>tx.amountSatang-refundedMoney)fail('จำนวนคืนเกินจำนวนที่ขายหรือคืนไปแล้ว');
      const product=state.products.find(p=>p.id===tx.product_id);if(!product)fail('ไม่พบสินค้า');
      const refund={id:newId(),type:'refund',category:'product',method:paymentMethod(),amountSatang:quantity*tx.unitPriceSatang,product_id:product.id,quantity,original_transaction_id:tx.id,receipt_id:tx.receipt_id,bill_id:tx.bill_id||null,session_id:tx.session_id||null,at:now,employee_id:actor.id,command_id:command.id,demo:true,reason,restock:payload.restock};
      state.transactions.push(refund);if(payload.restock)moveStock(product,quantity,'return',reason,refund.id);
      log('refundProduct',null,{sold:tx.quantity,returned:already},{returned:already+quantity,amountSatang:refund.amountSatang},reason,{transaction_id:refund.id,approvedBy:actor.id});result={transaction_id:refund.id};break;
    }
    case 'addCart':{
      const p=state.products.find(p=>p.id===payload.product_id);if(!p||!p.active)fail('สินค้าไม่เปิดขาย');const line=state.cart.find(l=>l.kind==='product'&&l.id===p.id);
      if((line?.quantity||0)>=p.stock)fail('จำนวนเกินสต๊อกทดสอบ');if(line)line.quantity++;else state.cart.push({kind:'product',id:p.id,name:p.name,cost:p.cost,price:p.price,quantity:1});
      log('addCart',null,null,{product_id:p.id});break;
    }
    case 'removeCart':{const before=structuredClone(state.cart);state.cart=state.cart.filter(l=>l.kind==='service'?l.bill_id!==payload.line_id:l.id!==payload.line_id);log('removeCart',null,before,state.cart);break;}
    case 'checkout':{
      const lines=cartLines(state);if(!lines.length)fail('ตะกร้ายังว่างหรือชำระแล้ว');if(lines.some(l=>l.kind!=='product'))fail('ชำระบิล Station ผ่านปุ่มคิดเงินของ Session');
      for(const line of lines){const p=state.products.find(p=>p.id===line.id);if(!p||p.price!==line.price)fail('ราคาสินค้าเปลี่ยน กรุณานำออกแล้วเพิ่มใหม่');}
      const bill={id:newId(),session_id:null,type:'pos',status:'UNPAID',createdAt:now,cancelled:false,charges:lines.map(l=>({id:newId(),kind:'product',product_id:l.id,name:l.name,quantity:l.quantity,unitPriceSatang:Math.round(l.price*100),unitCostSatang:Math.round(l.cost*100),amountSatang:Math.round(l.price*100)*l.quantity,at:now}))};
      state.bills.push(bill);result=settleBill(bill,null);state.cart=[];break;
    }
    case 'refund':{
      manager();const s=getSession(),reason=needReason(payload.reason);const ids=refundSession(s,payload.amountSatang,reason);result={transaction_ids:ids};break;
    }
    default:fail('ไม่รองรับคำสั่ง');
  }
  assignNewTransactions(state,original.transactions.length,actor,now);refreshBills(state);state.revision++;state.commands.push({id:command.id,fingerprint,result});validateState(state);
  return {state,result,replayed:false};
}
export function validateState(state){
  if(state.version!==5||state.stations.length!==12)fail('รูปแบบข้อมูลไม่ถูกต้อง');
  for(const key of ['sessions','bills','transactions','audit','commands','employees','products','cart','receipts','stockMovements'])if(!Array.isArray(state[key]))fail('ข้อมูลไม่ครบ');
  for(const [items,key] of [[state.stations,'id'],[state.sessions,'session_id'],[state.bills,'id'],[state.transactions,'id'],[state.commands,'id']])if(new Set(items.map(i=>i[key])).size!==items.length)fail('พบรหัสซ้ำ');
  for(const t of state.stations){const s=state.sessions.find(s=>s.session_id===t.session_id);if(t.session_id&&(!s||s.station_id!==t.id||s.serviceStatus!=='active'))fail('Station กับ Session ไม่ตรงกัน');}
  for(const s of state.sessions){if(state.bills.filter(b=>b.session_id===s.session_id).length!==1||!state.bills.some(b=>b.id===s.bill_id&&b.session_id===s.session_id))fail('Session ไม่มีบิล');if(s.serviceStatus==='active'&&state.stations.find(t=>t.id===s.station_id)?.session_id!==s.session_id)fail('Session ไม่มี Station');}
  validateShifts(state);return state;
}
// Keep the full original archive; old receipts are not invented as new payments.
export function migrateLegacy(old){
  const state=createDemo();state.legacyArchive=structuredClone(old);
  const importSession=(raw,stationId,finished=false)=>{
    if(state.sessions.some(s=>s.session_id===raw.id))return;
    const billId=`legacy-bill-${raw.id}`,fee=finished?Math.round(raw.price*100):2000+(raw.extensions||0)*500;
    const s={session_id:raw.id,station_id:stationId,startedAt:raw.startedAt,endsAt:raw.endsAt,serviceStatus:finished?'finished':'active',finishedAt:raw.finishedAt||null,feeSatang:fee,extensions:finished?Math.max(0,(fee-2000)/500):raw.extensions||0,bill_id:billId,history:[],cancelRequest:null,usageIntervals:[],legacyPostpaid:true};
    const event={id:newId(),command_id:'migration-v1',type:'importLegacy',at:Date.now(),employee_id:'system-migration',session_id:s.session_id,before:structuredClone(raw),after:structuredClone(s),reason:'นำเข้าข้อมูลทดสอบ v1; เก็บต้นฉบับครบใน legacyArchive'};
    state.sessions.push(s);state.bills.push({id:billId,session_id:s.session_id,cancelled:false,charges:[{id:newId(),kind:'legacy-base',amountSatang:fee,at:s.startedAt}]});state.audit.push(event);s.history.push(event.id);
    if(!finished)state.stations.find(t=>t.id===stationId).session_id=s.session_id;else addToCart(state,s);
  };
  if(old.version!==1||!Array.isArray(old.stations)||old.stations.length!==12)fail('ไม่สามารถนำเข้าข้อมูลเก่าได้');
  old.stations.forEach(t=>{if(t.session)importSession(t.session,t.id);});
  for(const l of old.cart||[]){if(l.kind==='service')importSession(l,Number(l.name.match(/\d+/)?.[0])||1,true);else state.cart.push(structuredClone(l));}
  state.products=old.products.map((p,i)=>({...structuredClone(p),sku:p.sku||`LEGACY${i+1}`,category:p.category||'ข้อมูลเก่า',active:p.active!==false}));state.stockMovements=openingMovements(state.products,Date.now(),'นำเข้าสินค้าทดสอบ v1');refreshBills(state);validateState(state);return state;
}

// Upgrade without rewriting old transaction/audit records or inventing payment methods.
export function upgradeState(old){
  if(old.version===5)return validateState(old);
  if(old.version===1)return migrateLegacy(old);
  if(![2,3,4].includes(old.version))fail('ไม่รองรับรุ่นฐานข้อมูล');
  const state=structuredClone(old);state.schemaArchives=[...(state.schemaArchives||[]),{version:old.version,savedAt:Date.now(),state:structuredClone(old)}];state.version=5;ensureShiftState(state);state.revision++;
  state.products=state.products.map((p,i)=>({...p,sku:p.sku||`LEGACY${i+1}`,category:p.category||'ข้อมูลเก่า',active:p.active!==false}));
  state.stockMovements ||= openingMovements(state.products,Date.now(),'ยอดยกมาจากข้อมูลทดสอบเก่า');
  state.sessions=state.sessions.map(s=>({...s,usageIntervals:s.usageIntervals||[],legacyPostpaid:s.legacyPostpaid??old.version===2}));
  for(const b of state.bills){const payments=state.transactions.filter(t=>t.bill_id===b.id&&t.type==='payment');b.everPaid=payments.length>0;b.createdAt??=state.sessions.find(s=>s.session_id===b.session_id)?.startedAt||0;if(payments.length){b.paidAt=payments.at(-1).at;b.paidBy=payments.at(-1).employee_id;b.paymentMethod=new Set(payments.map(t=>t.method||'unknown')).size===1?(payments[0].method||'unknown'):'mixed';b.transaction_ids=payments.map(t=>t.id);}}
  state.cart=state.cart.filter(l=>l.kind==='product');
  state.audit.push({id:newId(),command_id:'schema-v5',type:'schemaUpgrade',at:Date.now(),employee_id:'system-migration',session_id:null,before:{version:old.version},after:{version:5},reason:'เพิ่มระบบกะโดยไม่จัดเงินเก่าเข้ากะหรือสร้างยอดย้อนหลัง'});
  refreshBills(state);return validateState(state);
}
