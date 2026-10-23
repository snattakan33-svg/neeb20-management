export const STORAGE_KEY = 'neeb20:demo:v2';
export const LEGACY_KEY = 'neeb20:demo:v1';
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
export function createDemo() {
  return {version:2,demo:true,revision:0,stations:Array.from({length:12},(_,i)=>({id:i+1,session_id:null})),sessions:[],bills:[],transactions:[],audit:[],commands:[],
    employees:[{id:'staff-01',name:'พนักงานทดสอบ 01',role:'staff'},{id:'manager-01',name:'ผู้จัดการทดสอบ 01',role:'manager'}],
    products:[{id:'p1',name:'หวีทดสอบ',barcode:'885000000001',cost:15,price:29,stock:20},{id:'p2',name:'เซรั่มทดสอบ',barcode:'885000000002',cost:45,price:79,stock:10}],cart:[],receipts:[]};
}
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
  const charged=b.charges.reduce((n,l)=>n+l.amountSatang,0);
  return {charged,paid,refunded,net:paid-refunded,due:b.cancelled?0:Math.max(0,charged-paid),
    status:paid===0?(b.cancelled?'cancelled-before-payment':'unpaid'):refunded===paid?'refund-full':refunded>0?'refund-partial':paid>=charged?'paid':'unpaid'};
}
export function salesSummary(state) {
  return state.transactions.reduce((a,t)=>{a[t.type==='payment'?'received':'refunded']+=t.amountSatang;a.net=a.received-a.refunded;return a;},{received:0,refunded:0,net:0});
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
  let result={};
  switch(command.type){
    case 'start':{
      const station=getStation(payload.station_id);if(station.session_id)fail('จุดนี้มีคิวอยู่แล้ว','CONFLICT');
      const id=newId(),billId=newId();
      const s={session_id:id,station_id:station.id,startedAt:now,endsAt:now+1500000,serviceStatus:'active',feeSatang:2000,extensions:0,bill_id:billId,history:[],cancelRequest:null};
      state.sessions.push(s);state.bills.push({id:billId,session_id:id,cancelled:false,charges:[{id:newId(),kind:'base',amountSatang:2000,at:now}]});station.session_id=id;
      log('start',s,null,s);result={session_id:id,bill_id:billId};break;
    }
    case 'move':{
      const s=getSession(),source=active(s),target=getStation(payload.targetStationId);const reason=needReason(payload.reason);
      if(source.id===target.id||target.session_id)fail('จุดปลายทางไม่ว่างหรือเป็นจุดเดิม','CONFLICT');
      const before=structuredClone(s);source.session_id=null;target.session_id=s.session_id;s.station_id=target.id;
      log('move',s,before,s,reason,{correction:payload.correction===true});break;
    }
    case 'extend':{
      const s=getSession();active(s);if(s.cancelRequest)fail('คิวอยู่ระหว่างรออนุมัติยกเลิก');
      const before=structuredClone(s);const wasPaid=finance(state,s.bill_id).due===0;s.endsAt+=300000;s.extensions++;s.feeSatang+=500;
      state.bills.find(b=>b.id===s.bill_id).charges.push({id:newId(),kind:'extension',amountSatang:500,at:now,supplemental:wasPaid});
      if(state.cart.some(l=>l.bill_id===s.bill_id))addToCart(state,s);
      log('extend',s,before,s,null,{supplemental:wasPaid});break;
    }
    case 'finish':{
      const s=getSession();if(s.serviceStatus==='finished'){result={session_id:s.session_id,alreadyFinished:true};break;}
      const station=active(s);const before=structuredClone(s);s.serviceStatus='finished';s.finishedAt=now;station.session_id=null;
      addToCart(state,s);log('finish',s,before,s);break;
    }
    case 'selectBill':{const s=getSession();if(s.serviceStatus==='cancelled')fail('คิวถูกยกเลิก');addToCart(state,s);log('selectBill',s,null,{bill_id:s.bill_id});break;}
    case 'requestCancel':{
      const s=getSession(),reason=needReason(payload.reason);if(s.serviceStatus==='cancelled'||s.cancelRequest)fail('ยกเลิกแล้วหรือมีคำขออยู่แล้ว');
      if(s.serviceStatus==='active')active(s);
      const before=structuredClone(s);s.cancelRequest={id:newId(),reason,requestedBy:actor.id,at:now};log('requestCancel',s,before,s,reason);break;
    }
    case 'approveCancel':{
      manager();const s=getSession(),reason=needReason(payload.reason);if(!s.cancelRequest||s.serviceStatus==='cancelled')fail('ไม่มีคำขอที่รออนุมัติ');
      const before=structuredClone(s),request=structuredClone(s.cancelRequest);const station=getStation(s.station_id);
      if(station.session_id===s.session_id)station.session_id=null;
      s.serviceStatus='cancelled';s.cancelledAt=now;s.cancellation={...request,approvedBy:actor.id,approvedAt:now,approvalReason:reason};s.cancelRequest=null;
      state.bills.find(b=>b.id===s.bill_id).cancelled=true;state.cart=state.cart.filter(l=>l.bill_id!==s.bill_id);
      log('cancel',s,before,s,reason,{request});result={refundRequired:finance(state,s.bill_id).net>0};break;
    }
    case 'restore':{
      manager();const s=getSession(),reason=needReason(payload.reason);if(s.serviceStatus!=='finished')fail('กู้คืนได้เฉพาะคิวที่จบแล้ว');
      const station=getStation(payload.targetStationId);if(station.session_id)fail('จุดที่จะกู้คืนไม่ว่าง','CONFLICT');
      const before=structuredClone(s);s.station_id=station.id;s.serviceStatus='active';s.finishedAt=null;station.session_id=s.session_id;
      log('restore',s,before,s,reason,{approvedBy:actor.id});break;
    }
    case 'addProduct':{
      const p=payload;if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.barcode!=='string'||p.barcode.length>80||!validMoney(p.cost)||!validMoney(p.price,false)||!Number.isInteger(p.stock)||p.stock<0||p.stock>1000000)fail('ข้อมูลสินค้าไม่ถูกต้อง');
      if(p.barcode&&state.products.some(x=>x.barcode.toLowerCase()===p.barcode.toLowerCase()))fail('บาร์โค้ดซ้ำ');
      const product={id:newId(),name:p.name.trim(),barcode:p.barcode,cost:p.cost,price:p.price,stock:p.stock};state.products.push(product);log('addProduct',null,null,product);break;
    }
    case 'addCart':{
      const p=state.products.find(p=>p.id===payload.product_id);if(!p)fail('ไม่พบสินค้า');const line=state.cart.find(l=>l.kind==='product'&&l.id===p.id);
      if((line?.quantity||0)>=p.stock)fail('จำนวนเกินสต๊อกทดสอบ');if(line)line.quantity++;else state.cart.push({kind:'product',id:p.id,name:p.name,cost:p.cost,price:p.price,quantity:1});
      log('addCart',null,null,{product_id:p.id});break;
    }
    case 'removeCart':{const before=structuredClone(state.cart);state.cart=state.cart.filter(l=>l.kind==='service'?l.bill_id!==payload.line_id:l.id!==payload.line_id);log('removeCart',null,before,state.cart);break;}
    case 'checkout':{
      const lines=cartLines(state);if(!lines.length)fail('ตะกร้ายังว่างหรือชำระแล้ว');
      for(const line of lines.filter(l=>l.kind==='product')){const p=state.products.find(p=>p.id===line.id);if(!p||p.stock<line.quantity||!Number.isInteger(line.quantity)||line.quantity<1)fail('สต๊อกทดสอบไม่เพียงพอ');}
      const receipt={id:newId(),createdAt:now,demo:true,total:total(lines),lines:structuredClone(lines),transaction_ids:[]};
      for(const line of lines){
        if(line.kind==='product')state.products.find(p=>p.id===line.id).stock-=line.quantity;
        const s=line.kind==='service'?state.sessions.find(s=>s.session_id===line.session_id):null;
        const before=s?finance(state,s.bill_id):null;
        const tx={id:newId(),type:'payment',amountSatang:Math.round(line.price*line.quantity*100),bill_id:s?.bill_id||null,session_id:s?.session_id||null,receipt_id:receipt.id,command_id:command.id,at:now,employee_id:actor.id,demo:true};
        state.transactions.push(tx);receipt.transaction_ids.push(tx.id);log('payment',s,before,s?finance(state,s.bill_id):{amountSatang:tx.amountSatang},null,{transaction_id:tx.id});
      }
      state.receipts.push(receipt);state.cart=[];result={receipt_id:receipt.id};break;
    }
    case 'refund':{
      manager();const s=getSession(),reason=needReason(payload.reason),f=finance(state,s.bill_id),amount=payload.amountSatang;
      if(!Number.isSafeInteger(amount)||amount<=0||amount>f.net)fail('ยอดคืนต้องมากกว่า 0 และไม่เกินยอดที่รับสุทธิ');
      const tx={id:newId(),type:'refund',amountSatang:amount,bill_id:s.bill_id,session_id:s.session_id,command_id:command.id,at:now,employee_id:actor.id,demo:true,reason};state.transactions.push(tx);
      log('refund',s,f,finance(state,s.bill_id),reason,{transaction_id:tx.id,approvedBy:actor.id});result={transaction_id:tx.id};break;
    }
    default:fail('ไม่รองรับคำสั่ง');
  }
  state.revision++;state.commands.push({id:command.id,fingerprint,result});validateState(state);
  return {state,result,replayed:false};
}
export function validateState(state){
  if(state.version!==2||state.stations.length!==12)fail('รูปแบบข้อมูลไม่ถูกต้อง');
  for(const key of ['sessions','bills','transactions','audit','commands','employees','products','cart','receipts'])if(!Array.isArray(state[key]))fail('ข้อมูลไม่ครบ');
  for(const [items,key] of [[state.stations,'id'],[state.sessions,'session_id'],[state.bills,'id'],[state.transactions,'id'],[state.commands,'id']])if(new Set(items.map(i=>i[key])).size!==items.length)fail('พบรหัสซ้ำ');
  for(const t of state.stations){const s=state.sessions.find(s=>s.session_id===t.session_id);if(t.session_id&&(!s||s.station_id!==t.id||s.serviceStatus!=='active'))fail('Station กับ Session ไม่ตรงกัน');}
  for(const s of state.sessions){if(!state.bills.some(b=>b.id===s.bill_id&&b.session_id===s.session_id))fail('Session ไม่มีบิล');if(s.serviceStatus==='active'&&state.stations.find(t=>t.id===s.station_id)?.session_id!==s.session_id)fail('Session ไม่มี Station');}
  return state;
}
// Keep the full original archive; old receipts are not invented as new payments.
export function migrateLegacy(old){
  const state=createDemo();state.legacyArchive=structuredClone(old);
  const importSession=(raw,stationId,finished=false)=>{
    if(state.sessions.some(s=>s.session_id===raw.id))return;
    const billId=`legacy-bill-${raw.id}`,fee=finished?Math.round(raw.price*100):2000+(raw.extensions||0)*500;
    const s={session_id:raw.id,station_id:stationId,startedAt:raw.startedAt,endsAt:raw.endsAt,serviceStatus:finished?'finished':'active',finishedAt:raw.finishedAt||null,feeSatang:fee,extensions:finished?Math.max(0,(fee-2000)/500):raw.extensions||0,bill_id:billId,history:[],cancelRequest:null};
    const event={id:newId(),command_id:'migration-v1',type:'importLegacy',at:Date.now(),employee_id:'system-migration',session_id:s.session_id,before:structuredClone(raw),after:structuredClone(s),reason:'นำเข้าข้อมูลทดสอบ v1; เก็บต้นฉบับครบใน legacyArchive'};
    state.sessions.push(s);state.bills.push({id:billId,session_id:s.session_id,cancelled:false,charges:[{id:newId(),kind:'legacy-base',amountSatang:fee,at:s.startedAt}]});state.audit.push(event);s.history.push(event.id);
    if(!finished)state.stations.find(t=>t.id===stationId).session_id=s.session_id;else addToCart(state,s);
  };
  if(old.version!==1||!Array.isArray(old.stations)||old.stations.length!==12)fail('ไม่สามารถนำเข้าข้อมูลเก่าได้');
  old.stations.forEach(t=>{if(t.session)importSession(t.session,t.id);});
  for(const l of old.cart||[]){if(l.kind==='service')importSession(l,Number(l.name.match(/\d+/)?.[0])||1,true);else state.cart.push(structuredClone(l));}
  state.products=structuredClone(old.products);validateState(state);return state;
}
