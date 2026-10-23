import {STORAGE_KEY,PREVIOUS_KEY,OLDER_KEY,ANCIENT_KEY,LEGACY_KEY,newId,createDemo,migrateLegacy,upgradeState,validateState,execute,status,sessionAt,finance,billLines,billStatus,salesSummary,cartLines,total} from './domain.js';
import {makeReport,reportCSV,billsCSV,shiftsCSV,incomeSummaryCSV,bangkokDay,isoWeek} from './reports.js';
import {reconciliation,shiftTotals} from './shifts.js';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n);
const cash=satang=>money(satang/100);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=ms=>ms==null?'—':new Date(ms).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
const labels={idle:'ว่าง พร้อมให้บริการ',active:'กำลังใช้งาน',warning:'ใกล้หมดเวลา',expired:'หมดเวลา รอพนักงานปิดจุด',finished:'จบคิว',cancelled:'ยกเลิก'};
const financialLabels={unpaid:'ยังไม่ชำระ',paid:'ชำระแล้ว','refund-partial':'คืนเงินบางส่วน','refund-full':'คืนเงินเต็มจำนวน','cancelled-before-payment':'ยกเลิกก่อนรับเงิน'};
let serverOffset=0;
const appNow=()=>Date.now()+serverOffset;
const PENDING_KEY='neeb20:pending:v5';
let state,mode=(location.protocol==='file:'||typeof NEEB20_STANDALONE!=='undefined')?'local-demo':'server-demo',busy=false,modal=null,activeActor='staff-01';
const notified=new Map();
function localRead(){
  const saved=localStorage.getItem(STORAGE_KEY);
  if(saved)return validateState(JSON.parse(saved));
  const previous=localStorage.getItem(PREVIOUS_KEY)||localStorage.getItem(OLDER_KEY)||localStorage.getItem(ANCIENT_KEY),legacy=localStorage.getItem(LEGACY_KEY),initial=previous?upgradeState(JSON.parse(previous)):legacy?migrateLegacy(JSON.parse(legacy)):createDemo();
  localStorage.setItem(STORAGE_KEY,JSON.stringify(initial));return initial;
}
async function readState(){
  if(mode==='local-demo')return localRead();
  const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ยังไม่บันทึกคำสั่ง');const body=await r.json();serverOffset=body.serverNow-Date.now();return validateState(body.state);
}
async function dispatch(command,actorId){
  if(mode==='local-demo'){
    const write=()=>{const result=execute(localRead(),command,actorId);localStorage.setItem(STORAGE_KEY,JSON.stringify(result.state));return result;};
    return navigator.locks? navigator.locks.request('neeb20-demo-writes',write):write();
  }
  let response;try{response=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,actorId})});}
  catch{const e=Error('ยังไม่ทราบผลจากเซิร์ฟเวอร์ กดยืนยันซ้ำเพื่อลองคำสั่งเดิม ห้ามทำรายการใหม่แทน');e.uncertain=true;throw e;}
  let body;try{body=await response.json();}catch{const e=Error('อ่านผลไม่สำเร็จ กดยืนยันเพื่อลองคำสั่งเดิม');e.uncertain=true;throw e;}
  if(!response.ok){const e=Error(body.error||'บันทึกไม่สำเร็จ');e.code=body.code;if(response.status>=500)e.uncertain=true;throw e;}return body;
}
function setMessage(text){$('#message').textContent=text;}
function command(type,payload,revision=state.revision){return {id:newId(),type,payload,expectedRevision:revision};}
async function commit(cmd,actorId=activeActor){const result=await dispatch(cmd,actorId);state=result.state;if(result.serverNow)serverOffset=result.serverNow-Date.now();render();return result;}
function showDialog(title,body,type,getPayload){
  if(busy||modal)return;
  modal={type,getPayload,revision:state.revision,id:newId(),actorId:activeActor,pending:null};
  $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;$('#dialog-error').textContent='';$('#confirm-command').hidden=false;$('#confirm-command').disabled=false;$('#confirm-command').textContent='ยืนยัน';$('#cancel-dialog').disabled=false;$('#confirm-dialog').showModal();if(state.shiftControl.enabled&&!state.shifts.some(s=>s.status==='OPEN')&&['payBill','checkout','refund','returnProduct'].includes(type)){$('#confirm-command').disabled=true;$('#dialog-error').textContent='ต้องเปิดกะก่อนรับ/คืนเงิน ปิดหน้าต่างนี้แล้วไปเมนูปิดกะ';}
}
function closeDialog(){if(busy)return;$('#confirm-dialog').close();modal=null;}
$('#cancel-dialog').onclick=closeDialog;
$('#confirm-dialog').addEventListener('cancel',e=>{if(busy||modal?.pending){e.preventDefault();return;}modal=null;});
$('#confirm-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!modal)return;busy=true;$('#confirm-command').disabled=true;$('#cancel-dialog').disabled=true;
  try{
    if(!modal.pending)modal.pending={id:modal.id,type:modal.type,payload:modal.getPayload(),expectedRevision:modal.revision};
    sessionStorage.setItem(PENDING_KEY,JSON.stringify({command:modal.pending,actorId:modal.actorId}));
    await commit(modal.pending,modal.actorId);sessionStorage.removeItem(PENDING_KEY);setMessage('บันทึกคำสั่งทดสอบสำเร็จ ไม่ได้รับ/คืนเงินจริง');busy=false;closeDialog();
  }catch(error){
    $('#dialog-error').textContent=error.message;
    if(!error.uncertain){sessionStorage.removeItem(PENDING_KEY);modal.pending=null;if(error.code==='CONFLICT'){try{state=await readState();render();}catch{}$('#dialog-error').textContent+=' · กรุณายกเลิกหน้าต่างนี้ แล้วเปิดตรวจสอบใหม่';$('#confirm-command').hidden=true;}}
    else {$('#confirm-command').textContent='ลองคำสั่งเดิมอีกครั้ง';$('#dialog-body').querySelectorAll('input,select').forEach(el=>el.disabled=true);}
  }finally{busy=false;$('#confirm-command').disabled=false;$('#cancel-dialog').disabled=!!modal?.pending;}
});
$('#confirm-dialog').addEventListener('close',()=>{$('#confirm-command').type='submit';$('#confirm-command').onclick=null;});
function sessionInfo(s){const f=finance(state,s.bill_id);return `<p><b>จุด ${s.station_id} · Session ${escape(s.session_id)}</b></p><p>เริ่ม ${date(s.startedAt)}<br>สิ้นสุด ${date(s.endsAt)}<br>เหลือ ${Math.max(0,Math.ceil((s.endsAt-appNow())/60000))} นาที (คำนวณจากเวลาสิ้นสุดเดิม)</p><p>Bill ${escape(s.bill_id)}<br>ค่าบริการ ${cash(s.feeSatang)} · ยอดบิลรวม ${cash(f.charged)}<br>${financialLabels[f.status]} · รับแล้ว ${cash(f.paid)} · คืนแล้ว ${cash(f.refunded)} · ต้องชำระ ${cash(f.due)}</p>`;}
function billMarkup(s){
 const f=finance(state,s.bill_id),bill=state.bills.find(b=>b.id===s.bill_id),mutable=f.paid===0&&!bill.cancelled;
 return `<p>Bill ID: <b>${escape(s.bill_id)}</b> · ${billStatus(state,s.bill_id)}</p><div class="bill-items">${billLines(state,s.bill_id).map(l=>`<div class="cart-line"><div>${escape(l.name)} × ${l.quantity}<small>${cash(l.unitPriceSatang)} / ชิ้น</small></div><strong>${cash(l.amountSatang)}</strong>${mutable&&l.kind==='product'?`<button type="button" class="secondary" data-remove-charge="${escape(l.id)}" data-session="${escape(s.session_id)}">นำออก</button>`:''}</div>`).join('')}</div><p class="total">รวมทั้งสิ้น <b>${cash(f.charged)}</b></p><p>ชำระแล้ว ${cash(f.paid)} · ค้าง ${cash(f.due)} · คืนแล้ว ${cash(f.refunded)}</p>`;
}
const quickActions=new Map();
function quickCommand(key,title,body,type,payload){
 if(busy||modal)return;if(Date.now()-(quickActions.get(key)||0)<1500){setMessage('เพิ่งส่งคำสั่งนี้ กรุณารอสักครู่ก่อนกดอีกครั้ง');return;}quickActions.set(key,Date.now());showDialog(title,body,type,()=>payload);$('#confirm-form').requestSubmit();
}
function targetOptions(s){return state.stations.filter(t=>!t.session_id&&t.id!==s?.station_id).map(t=>`<option value="${t.id}">จุด ${t.id}</option>`).join('');}
const reasonField='<label>เหตุผล (จำเป็น)<input id="reason" required maxlength="500"></label>';
const reason=()=>$('#reason').value.trim();
function paymentFields(refund=false){return `<label>${refund?'ช่องทางคืนเงิน':'วิธีรับชำระ'}<select id="payment-method"><option value="cash">เงินสด</option><option value="qr">QR (พนักงานตรวจเอง ไม่เชื่อมธนาคาร)</option></select></label><label class="check"><input type="checkbox" id="payment-confirmed" required> ${refund?'ยืนยันว่าได้คืนเงินแล้ว':'ยืนยันว่าได้ตรวจรับเงินแล้ว'} — ใน Demo เป็นการจำลองเท่านั้น</label>`;}
const paymentPayload=(refund=false)=>({method:$('#payment-method').value,[refund?'refundConfirmed':'paymentConfirmed']:$('#payment-confirmed').checked});
function openSessionAction(type,s){
  const base={session_id:s.session_id,expectedStationId:s.station_id};
  if(type==='move'||type==='correct'){
    const options=targetOptions(s);if(!options){setMessage('ไม่มีจุดว่างสำหรับย้าย');return;}
    showDialog(type==='correct'?'แก้ไขจุดที่เริ่มผิด':'ย้ายจุด',sessionInfo(s)+`<label>จุดปลายทางที่ว่าง<select id="target">${options}</select></label>`+reasonField,'move',()=>({...base,targetStationId:Number($('#target').value),reason:reason(),correction:type==='correct'}));
  }else if(type==='finish'){
    const f=finance(state,s.bill_id);if(f.due>0||f.paid===0){showDialog('บิลนี้ยังไม่ได้ชำระเงิน ต้องการไปหน้าคิดเงินหรือไม่?',sessionInfo(s)+billMarkup(s),'payBill',()=>({...base,...paymentPayload()}));$('#confirm-command').type='button';$('#confirm-command').textContent='ไปหน้าคิดเงิน';$('#confirm-command').onclick=event=>{event.preventDefault();closeDialog();$('#confirm-command').onclick=null;$('#confirm-command').type='submit';openSessionAction('payBill',s);};return;}
    showDialog('ยืนยันจบคิว · ตรวจจุดและ Session',sessionInfo(s)+'<p>ปิดจุดเท่านั้น ไม่รับเงินหรือสร้างรายการขายใหม่</p>','finish',()=>base);
  }
  else if(type==='extend')quickCommand('extend:'+s.session_id,'กำลังต่อเวลา',sessionInfo(s),'extend',base);
  else if(type==='addBillProduct'){
    const products=state.products.filter(p=>p.active&&p.stock>0);if(!products.length){setMessage('ไม่มีสินค้าที่เปิดขายและมีสต๊อก');return;}
    showDialog('เพิ่มสินค้าในบิล Station '+s.station_id,billMarkup(s)+`<label>เลือกสินค้าจาก POS<select id="bill-product">${products.map(p=>`<option value="${escape(p.id)}">${escape(p.sku)} · ${escape(p.name)} · ${money(p.price)} · เหลือ ${p.stock}</option>`).join('')}</select></label><label>จำนวน<input id="bill-quantity" type="number" min="1" step="1" value="1" required></label><p id="bill-preview"></p><p>ยังไม่ตัดสต๊อก/บันทึกรายรับ ตรวจสต๊อกซ้ำเมื่อชำระเงิน</p>`,'addBillProduct',()=>({...base,product_id:$('#bill-product').value,quantity:Number($('#bill-quantity').value)}));
    const update=()=>{const p=products.find(p=>p.id===$('#bill-product').value),quantity=Number($('#bill-quantity').value);$('#bill-preview').textContent=`เพิ่ม ${money(p.price*quantity)} · รวมหลังเพิ่ม ${cash(finance(state,s.bill_id).charged+Math.round(p.price*100)*quantity)}`;};$('#bill-product').onchange=update;$('#bill-quantity').oninput=update;update();
  }else if(type==='payBill'||type==='selectBill'){
    const f=finance(state,s.bill_id),canPay=f.paid===0&&!state.bills.find(b=>b.id===s.bill_id).cancelled;
    showDialog(canPay?'คิดเงิน / ชำระเงิน':'รายละเอียดบิล',sessionInfo(s)+billMarkup(s)+(canPay?paymentFields():''),'payBill',()=>({...base,...paymentPayload()}));if(!canPay)$('#confirm-command').hidden=true;
  }
  else if(type==='requestCancel'){const unpaid=finance(state,s.bill_id).paid===0;showDialog(unpaid?'ยกเลิกบริการและบิลที่ยังไม่ชำระ':'ส่งคำขอยกเลิก · รอผู้จัดการอนุมัติ',sessionInfo(s)+reasonField,unpaid?'cancelUnpaid':'requestCancel',()=>({...base,reason:reason()}));}
  else if(type==='approveCancel'){
    const f=finance(state,s.bill_id),used=s.usageIntervals?.length>0;
    showDialog('ผู้จัดการอนุมัติยกเลิกและพิจารณาคืนเงิน',sessionInfo(s)+`<p>คำขอจาก ${escape(s.cancelRequest.requestedBy)}: ${escape(s.cancelRequest.reason)}</p><label>การใช้บริการ<select id="unused">${used?'':'<option value="true">ยังไม่ได้ใช้จริง — ต้องคืนเต็มจำนวน</option>'}<option value="false">ใช้แล้ว — พิจารณาตามนโยบาย</option></select></label><label>ยอดคืน (บาท)<input id="refund-amount" type="number" min="0" max="${f.net/100}" step="0.01" value="${f.net/100}" required></label><p>ถ้าไม่คืนเงิน (0 บาท) ไม่ต้องเลือกช่องยืนยันคืนเงิน</p>`+reasonField+paymentFields(true),'approveCancel',()=>({...base,reason:reason(),unused:$('#unused').value==='true',refundAmountSatang:Math.round(Number($('#refund-amount').value)*100),...paymentPayload(true)}));
    $('#payment-confirmed').required=false;
  }
  else if(type==='restore'){
    const options=state.stations.filter(t=>!t.session_id).map(t=>`<option value="${t.id}" ${t.id===s.station_id?'selected':''}>จุด ${t.id}</option>`).join('');
    if(!options){setMessage('ไม่มีจุดว่างสำหรับกู้คืน');return;}
    showDialog('ผู้จัดการกู้คืนคิวเดิม',sessionInfo(s)+`<label>จุดที่ว่าง<select id="target">${options}</select></label><p>ไม่เปลี่ยนเวลาสิ้นสุด ไม่สร้าง Session หรือบิลใหม่ เวลาหมดแล้วจะแสดงหมดเวลา</p>`+reasonField,'restore',()=>({...base,targetStationId:Number($('#target').value),reason:reason()}));
  }else if(type==='refund'){
    const f=finance(state,s.bill_id);showDialog('ผู้จัดการบันทึกคืนเงินทดสอบ',sessionInfo(s)+`<label>ยอดคืน (บาท)<input id="refund-amount" type="number" min="0.01" max="${f.net/100}" step="0.01" value="${f.net/100}" required></label>`+reasonField+paymentFields(true),'refund',()=>({...base,amountSatang:Math.round(Number($('#refund-amount').value)*100),reason:reason(),...paymentPayload(true)}));
  }else if(type==='selectBill')showDialog('เพิ่มยอดค้างชำระในตะกร้า',sessionInfo(s),'selectBill',()=>base);
}
function tick(){
  if(!state)return;const now=appNow();
  for(const station of state.stations){const card=$(`#station-${station.id}`);if(!card)continue;const s=sessionAt(state,station.id),kind=status(s,now),left=s?Math.max(0,Math.ceil((s.endsAt-now)/1000)):1500;
    card.className=`station ${kind}`;card.querySelector('.badge').textContent=labels[kind];card.querySelector('.timer').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;
    if(s&&['warning','expired'].includes(kind)&&notified.get(s.session_id)!==kind){setMessage(`จุด ${station.id}: ${labels[kind]} กรุณาตรวจสอบและเปิด–ปิดไฟด้วยมือ`);notified.set(s.session_id,kind);}
  }
}
function stations(){
 $('#summary').textContent=`ว่าง ${state.stations.filter(s=>!s.session_id).length} / 12 จุด`;
 $('#stations').innerHTML=state.stations.map(t=>{const s=sessionAt(state,t.id),f=s?finance(state,s.bill_id):null;
  const btn=(action,label)=>`<button data-action="${action}" data-session="${escape(s.session_id)}" ${f.paid>0&&['extend','addBillProduct'].includes(action)?'disabled title="บิลชำระแล้ว ล็อกรายการเพื่อไม่เปลี่ยนยอดรับ"':''} class="${action==='payBill'?'':'secondary'}">${label}</button>`;
  return `<article id="station-${t.id}" class="station"><h2>จุด ${String(t.id).padStart(2,'0')}</h2><span class="badge"></span><div class="timer" aria-label="เวลาคงเหลือ"></div><p>${s?`ยอดปัจจุบัน <b>${cash(f.charged)}</b><br>${billStatus(state,s.bill_id)} · Session ${escape(s.session_id.slice(0,8))}`:'25 นาที · 20 บาท'}</p><div class="actions">${s?btn('extend','+5 นาที / 5฿')+btn('addBillProduct','เพิ่มสินค้า')+btn('move','ย้ายจุด')+btn('payBill',f.paid>0?'ดูบิล · ชำระแล้ว':'คิดเงิน / ชำระเงิน')+btn('finish','จบคิว')+btn('requestCancel','ยกเลิก'):`<button data-start="${t.id}">เริ่มคิว 20฿</button>`}</div></article>`;
 }).join('');tick();
}
function products(){
 const query=$('#search').value.trim().toLowerCase(),manager=state.employees.find(e=>e.id===activeActor)?.role==='manager';
 $('#products').innerHTML=state.products.filter(p=>[p.name,p.barcode,p.sku,p.category].some(x=>x.toLowerCase().includes(query))).map(p=>`<div class="product"><div><b>${escape(p.name)}</b><small>${escape(p.sku)} · ${escape(p.category)} · ${p.active?'เปิดขาย':'ปิดขาย'}<br>ทุน ${money(p.cost)} · ขาย ${money(p.price)} · คงเหลือ ${p.stock}</small><div class="actions"><button class="secondary" data-product-action="receiveStock" data-product-id="${escape(p.id)}">รับเข้า</button>${manager?`<button class="secondary" data-product-action="editProduct" data-product-id="${escape(p.id)}">แก้ไข</button><button class="secondary" data-product-action="adjustStock" data-product-id="${escape(p.id)}">ปรับสต๊อก</button><button class="secondary" data-product-action="setProductActive" data-product-id="${escape(p.id)}">${p.active?'ปิดขาย':'เปิดขาย'}</button>`:''}</div></div><button data-product="${escape(p.id)}" ${p.stock<=0||!p.active?'disabled':''}>ใส่ตะกร้า</button></div>`).join('')||'<p>ไม่พบสินค้า</p>';
 $('#product-form').closest('details').hidden=!manager;
 $('#inventory-log').innerHTML=state.stockMovements.slice(-50).reverse().map(m=>`<p>${date(m.at)} · ${escape(state.products.find(p=>p.id===m.product_id)?.name||m.product_id)} · ${escape(m.kind)} ${m.quantityDelta>0?'+':''}${m.quantityDelta} · ${m.before} → ${m.after}<br>${escape(m.employee_id)} · ${escape(m.reason)} · ${escape(m.transaction_id||'')}</p>`).join('')||'<p>ยังไม่มีรายการเคลื่อนไหว</p>';
 $('#sales-history').innerHTML=state.transactions.filter(t=>t.type==='payment'&&t.category==='product').slice(-30).reverse().map(t=>{
   const returned=state.transactions.filter(r=>r.type==='refund'&&r.original_transaction_id===t.id).reduce((n,r)=>n+(r.quantity||0),0);
   return `<div class="session-record">${escape(state.products.find(p=>p.id===t.product_id)?.name||t.product_id)} · ขาย ${t.quantity} · คืนแล้ว ${returned}<p>${date(t.at)} · ${escape(t.id)} · ${cash(t.amountSatang)} · ${escape(t.method)}</p>${manager&&returned<t.quantity?`<button data-return="${escape(t.id)}">คืนสินค้าทดสอบ</button>`:''}</div>`;
 }).join('')||'<p>ยังไม่มีรายการขายสินค้าทดสอบ</p>';
}
function productAction(type,p){
 if(type==='editProduct'){
  showDialog('แก้ไขสินค้า',`<label>รหัสสินค้า<input id="edit-sku" value="${escape(p.sku)}" required maxlength="64"></label><label>ชื่อ<input id="edit-name" value="${escape(p.name)}" required maxlength="100"></label><label>หมวดหมู่<input id="edit-category" value="${escape(p.category)}" required maxlength="80"></label><label>บาร์โค้ด<input id="edit-barcode" value="${escape(p.barcode)}" maxlength="80"></label><label>ทุน<input id="edit-cost" type="number" min="0" step="0.01" value="${p.cost}" required></label><label>ขาย<input id="edit-price" type="number" min="0.01" step="0.01" value="${p.price}" required></label>`,'editProduct',()=>({product_id:p.id,sku:$('#edit-sku').value.trim(),name:$('#edit-name').value.trim(),category:$('#edit-category').value.trim(),barcode:$('#edit-barcode').value.trim(),cost:Number($('#edit-cost').value),price:Number($('#edit-price').value)}));
 }else if(type==='setProductActive')showDialog(p.active?'ปิดการขายสินค้า':'เปิดการขายสินค้า',`<p>${escape(p.name)}</p>`+reasonField,type,()=>({product_id:p.id,active:!p.active,reason:reason()}));
 else showDialog(type==='receiveStock'?'รับสินค้าเข้า':'ปรับสต๊อก',`<p>${escape(p.name)} · คงเหลือ ${p.stock}</p><label>จำนวน${type==='adjustStock'?'เพิ่ม/ลด (ลดใช้จำนวนติดลบ)':'รับเข้า'}<input id="quantity" type="number" ${type==='receiveStock'?'min="1"':''} step="1" required></label>`+reasonField,type,()=>({product_id:p.id,quantityDelta:Number($('#quantity').value),reason:reason()}));
}
function reports(){
 try{
  const report=makeReport(state,{mode:$('#report-mode').value,week:$('#report-week').value,employee_id:$('#report-employee').value,day:$('#report-day').value,month:$('#report-month').value,from:$('#report-from').value,to:$('#report-to').value},appNow()),s=report.summary;
  $('#report-error').textContent='';$('#report-summary').innerHTML=`<p>ข้อมูลทดสอบ · ${report.range.from} ถึง ${report.range.to} (Asia/Bangkok)</p><div class="report-grid">${[['บริการหนีบ20',s.base],['ต่อเวลา',s.extension],['สระ100 (เฉพาะรายการรับแล้ว)',s.wash100],['สินค้า',s.product],['ข้อมูลเก่าไม่ระบุหมวด',s.legacy],['รับเงินรวม',s.received],['คืนเงินรวม',s.refunded],['รายได้สุทธิ',s.net],['เงินสดสุทธิ',s.cash.net],['QR สุทธิ (พนักงานยืนยัน)',s.qr.net],['ช่องทางเก่าไม่ระบุสุทธิ',s.unknown.net]].map(([label,n])=>`<div><small>${label}</small><strong>${cash(n)}</strong></div>`).join('')}</div><p>สระ100 จะแสดงเมื่อมีธุรกรรมรับเงินที่รองรับ รุ่นนี้ยังไม่มีหน้าขาย/จองสระ100</p><p>บิลรับเงินในช่วงนี้ ${report.paidBillCount} · บิลค้างปัจจุบัน ${report.unpaidCurrentCount} / ${cash(report.unpaidCurrentSatang)} (ไม่รวมรายได้)</p><p>เงินสด: รับ ${cash(s.cash.received)} / คืน ${cash(s.cash.refunded)} · QR: รับ ${cash(s.qr.received)} / คืน ${cash(s.qr.refunded)}</p><p>คิวเริ่มในช่วงนี้ ${report.sessionCount} · ในกลุ่มนี้จบ ${report.finishedCount} / ยกเลิก ${report.cancelledCount}<br>เหตุการณ์จบในช่วงวันที่ ${report.finishedInRange} / ยกเลิก ${report.cancelledInRange} (อาจเป็นคิวเริ่มก่อนช่วงวันที่)</p>`;
  $('#report-sessions').innerHTML=report.sessions.map(s=>`<div class="session-record"><b>${escape(s.session_id)}</b><p>จุด ${s.stationHistory.join(' → ')} · ย้าย ${s.moves} ครั้ง · ${labels[s.status]}<br>เริ่มจับเวลา ${date(s.startedAt)} · กำหนดสิ้นสุด ${date(s.endsAt)}<br>จบจริง ${date(s.finishedAt)} · ยกเลิก ${date(s.cancelledAt)}<br>ใช้งานจริงตามการยืนยัน ${s.usageMilliseconds===null?'ยังไม่ยืนยัน / ข้อมูลเก่าไม่ทราบ':Math.floor(s.usageMilliseconds/60000)+' นาที '+Math.floor(s.usageMilliseconds/1000)%60+' วินาที'}</p></div>`).join('')||'<p>ไม่มี Session ที่เริ่มในช่วงนี้</p>';
  $('#report-bills').innerHTML=report.bills.map(b=>`<details class="session-record"><summary>Bill ${escape(b.bill_id.slice(0,8))} · ${b.status} · ${cash(b.totalSatang)}</summary><b>Bill ${escape(b.bill_id)} · ${b.status}</b><p>Session ${escape(b.session_id||'ขายสินค้า POS')} · Station ${b.station_id??'—'}<br>เริ่ม ${date(b.startedAt)} · จบ ${date(b.finishedAt)} · ใช้งาน ${b.usageMilliseconds===null?'ไม่ทราบ':Math.floor(b.usageMilliseconds/1000)+' วินาที'}<br>${b.lines.map(l=>`${escape(l.name)} × ${l.quantity} = ${cash(l.amountSatang)}`).join('<br>')}<br>บริการ ${cash(b.serviceSatang)} · สินค้า ${cash(b.productSatang)} · รวม ${cash(b.totalSatang)}<br>รับสด ${cash(b.cashSatang)} · รับ QR ${cash(b.qrSatang)} · คืน ${cash(b.refundedSatang)}<br>ชำระ ${date(b.paidAt)} · ${escape(b.paidBy||'—')} · ${escape(b.paymentMethod||'—')}<br>Payment ${escape(b.payment_id||'—')}<br>Transaction ${b.transaction_ids.map(escape).join(', ')}</p></details>`).join('')||'<p>ไม่มีบิลในช่วงนี้</p>';
  $('#report-transactions').innerHTML=report.transactions.slice().reverse().map(t=>`<div class="session-record"><b>${t.type==='refund'?'คืนเงิน':'รับเงิน'} ${cash(t.amountSatang)} · ${escape(t.category||'legacy')} · ${escape(t.method||'unknown')}</b><p>${date(t.at)} · ${escape(t.employee_id)}<br>Transaction ${escape(t.id)}<br>Session ${escape(t.session_id||'—')} · บิล ${escape(t.bill_id||'—')}<br>อ้างอิงเดิม ${escape(t.original_transaction_id||'—')}<br>${escape(t.reason||'')}</p></div>`).join('')||'<p>ไม่มีธุรกรรมในช่วงนี้</p>';
  renderReconciliation(report);$('#report-refunds').textContent=`รายการคืนเงิน ${report.refunds.length} รายการ · ${cash(s.refunded)} (ดูรหัสอ้างอิงในประวัติธุรกรรมด้านล่าง)`;return report;
 }catch(e){$('#report-error').textContent=e.message;$('#report-summary').textContent='';$('#report-sessions').textContent='';$('#report-transactions').textContent='';$('#report-refunds').textContent='';$('#report-bills').textContent='';$('#shift-list').textContent='';$('#income-chart').textContent='';return null;}
}
function records(){
  const manager=state.employees.find(e=>e.id===activeActor)?.role==='manager';
  $('#sessions').innerHTML=state.sessions.slice().reverse().map(s=>{const f=finance(state,s.bill_id);const btn=(action,label)=>`<button class="secondary" data-record="${action}" data-session="${escape(s.session_id)}">${label}</button>`;
    return `<article class="session-record"><b>จุด ${s.station_id} · ${escape(s.session_id)}</b><p>${labels[status(s,appNow())]} · ${financialLabels[f.status]}<br>บิล ${escape(s.bill_id)} · ${billStatus(state,s.bill_id)} · รวม ${cash(f.charged)} · รับแล้ว ${cash(f.paid)} · คืนแล้ว ${cash(f.refunded)} · ค้าง ${cash(f.due)}</p><div class="actions">${f.due?btn('payBill','คิดเงิน / ชำระเงิน'):''}${s.serviceStatus!=='cancelled'&&!s.cancelRequest?btn('requestCancel','ขอยกเลิก'):''}${s.cancelRequest?(manager?btn('approveCancel','อนุมัติยกเลิก'):'<span>รอผู้จัดการอนุมัติยกเลิก</span>'):''}${manager&&s.serviceStatus==='finished'?btn('restore','กู้คืนคิว'):''}${manager&&f.net>0?btn('refund','คืนเงินทดสอบ'):''}</div><details><summary>ประวัติคิว ${s.history.length} เหตุการณ์</summary><pre>${escape(JSON.stringify(state.audit.filter(a=>a.session_id===s.session_id),null,2))}</pre></details></article>`;
  }).join('')||'<p>ยังไม่มีคิวทดสอบ</p>';
  const summary=salesSummary(state);$('#financial-summary').textContent=`รับเงินทดสอบ ${cash(summary.received)} · คืนเงินทดสอบ ${cash(summary.refunded)} · สุทธิ ${cash(summary.net)}`;
  $('#audit').innerHTML=state.audit.slice(-50).reverse().map(a=>`<details><summary>${escape(a.type)} · ${escape(a.employee_id)} · ${date(a.at)}</summary><pre>${escape(JSON.stringify(a,null,2))}</pre></details>`).join('')||'<p>ยังไม่มีเหตุการณ์</p>';
  $('#legacy').textContent=state.legacyArchive?'นำเข้าคิวและตะกร้า v1 แล้ว เก็บข้อมูลต้นฉบับทั้งหมดใน legacyArchive; บิลเก่าที่รับแล้วไม่ถูกสร้างเป็นยอดรับเงินใหม่ ดูต้นฉบับได้ในไฟล์สำรอง':'';
}
function render(){
  stations();products();records();reports();const lines=cartLines(state);
  $('#cart').innerHTML=lines.map(l=>`<div class="cart-line"><div>${escape(l.name)} × ${l.quantity}<small>${money(l.price*l.quantity)}${l.bill_id?` · บิล ${escape(l.bill_id)}`:''}</small></div><button class="secondary" data-remove="${escape(l.bill_id||l.id)}">นำออกจากตะกร้า</button></div>`).join('')||'<p>ยังไม่มีรายการค้างในตะกร้า</p>';
  $('#total').textContent=money(total(lines));$('#checkout').disabled=!lines.length;
  const last=state.receipts.at(-1);$('#receipt').innerHTML=last?`<b>บิลทดสอบล่าสุด · ไม่ใช่หลักฐานรับเงินจริง</b><br>${escape(last.id)}<br>${date(last.createdAt)}<br>${last.lines.map(l=>`${escape(l.name)} × ${l.quantity} — ${money(l.price*l.quantity)}`).join('<br>')}<br><b>รวม ${money(last.total)}</b>`:'';
}
// Small cart mutations are also confirmed, revision-checked commands.
$('#stations').onclick=e=>{const start=e.target.closest('[data-start]'),b=e.target.closest('[data-action]');if(start)quickCommand('start:'+start.dataset.start,'กำลังเริ่มคิว',`<p>จุด ${Number(start.dataset.start)} · 25 นาที / 20 บาท · บิลยังไม่ชำระ</p>`,'start',{station_id:Number(start.dataset.start)});else if(b){const s=state.sessions.find(s=>s.session_id===b.dataset.session);if(s)openSessionAction(b.dataset.action,s);}};
$('#dialog-body').addEventListener('click',e=>{const b=e.target.closest('[data-remove-charge]');if(!b||busy||modal?.pending)return;const s=state.sessions.find(s=>s.session_id===b.dataset.session);closeDialog();showDialog('นำสินค้าออกจากบิลที่ยังไม่ชำระ',reasonField,'removeBillProduct',()=>({session_id:s.session_id,expectedStationId:s.station_id,charge_id:b.dataset.removeCharge,reason:reason()}));});
$('#sessions').onclick=e=>{const b=e.target.closest('[data-record]');if(b){const s=state.sessions.find(s=>s.session_id===b.dataset.session);if(s)openSessionAction(b.dataset.record,s);}};
$('#products').onclick=e=>{const action=e.target.closest('[data-product-action]'),b=e.target.closest('[data-product]');if(action){productAction(action.dataset.productAction,state.products.find(p=>p.id===action.dataset.productId));return;}if(b)showDialog('เพิ่มสินค้าทดสอบในตะกร้า',`<p>${escape(state.products.find(p=>p.id===b.dataset.product).name)} × 1</p>`,'addCart',()=>({product_id:b.dataset.product}));};
$('#sales-history').onclick=e=>{const b=e.target.closest('[data-return]');if(!b)return;const tx=state.transactions.find(t=>t.id===b.dataset.return),returned=state.transactions.filter(t=>t.type==='refund'&&t.original_transaction_id===tx.id).reduce((n,t)=>n+(t.quantity||0),0);showDialog('ผู้จัดการคืนสินค้าและคืนเงิน',`<p>อ้างอิง ${escape(tx.id)} · คืนได้ ${tx.quantity-returned} ชิ้น · ราคาต่อชิ้น ${cash(tx.unitPriceSatang)}</p><label>จำนวนคืน<input id="return-quantity" type="number" min="1" max="${tx.quantity-returned}" step="1" value="1" required></label><label class="check"><input id="restock" type="checkbox" checked>รับสินค้าคืนเข้าสต๊อก</label>`+reasonField+paymentFields(true),'returnProduct',()=>({transaction_id:tx.id,quantity:Number($('#return-quantity').value),restock:$('#restock').checked,reason:reason(),...paymentPayload(true)}));};
$('#cart').onclick=e=>{const b=e.target.closest('[data-remove]');if(b)showDialog('นำออกจากตะกร้า','<p>นำออกจากตะกร้าเท่านั้น ไม่ยกเลิกบริการ ไม่ลบหนี้หรือประวัติ</p>','removeCart',()=>({line_id:b.dataset.remove}));};
$('#search').addEventListener('input',()=>{if(state)products();});
$('#product-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),payload={sku:f.get('sku').trim(),category:f.get('category').trim(),name:f.get('name').trim(),barcode:f.get('barcode').trim(),cost:Number(f.get('cost')),price:Number(f.get('price')),stock:Number(f.get('stock'))};showDialog('ยืนยันเพิ่มสินค้าทดสอบ',`<p>${escape(payload.name)} · ขาย ${money(payload.price)} · สต๊อก ${payload.stock}</p>`,'addProduct',()=>payload);};
$('#checkout').onclick=()=>showDialog('ยืนยันรับเงินทดสอบ',`<p>รวม ${money(total(cartLines(state)))}</p><p>จำลองรับเงินเท่านั้น ไม่เชื่อมธนาคาร คำสั่งเดิมบันทึกได้ครั้งเดียว</p>`+paymentFields(),'checkout',()=>paymentPayload());
$('#actor').onchange=()=>{activeActor=$('#actor').value;if(state){records();products();reports();}};
$('#export').onclick=async()=>{try{const latest=await readState(),blob=new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-backup-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setMessage(e.message);}};
$('#report-controls').onchange=()=>{if(state)reports();};
$('#export-csv').onclick=()=>{const report=reports();if(!report)return;const url=URL.createObjectURL(new Blob([reportCSV(report)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-report-${report.range.from}-${report.range.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const reconcileLabels={MATCH:'ยอดตรง',SHORT:'เงินขาด',OVER:'เงินเกิน',PENDING:'รอตรวจสอบ'};
function renderChart(report){
 const group=$('#chart-group').value,rows=report.charts[group],width=720,height=200,pad=26,values=rows.map(r=>r.net),low=values.reduce((a,b)=>Math.min(a,b),0),high=values.reduce((a,b)=>Math.max(a,b),1),y=v=>height-pad-(v-low)/(high-low)*(height-2*pad),x=i=>pad+i/Math.max(1,rows.length-1)*(width-2*pad);
 const points=rows.map((r,i)=>`${x(i)},${y(r.net)}`).join(' ');
 $('#income-chart').innerHTML=rows.length?`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="กราฟรายได้สุทธิข้อมูลทดสอบ"><title>รายได้สุทธิจากรายการยืนยันรับเงินทดสอบหักคืนเงิน</title><line x1="${pad}" y1="${y(0)}" x2="${width-pad}" y2="${y(0)}" stroke="#bbc8bb"/>${rows.map((row,i)=>{const step=(width-2*pad)/rows.length,barWidth=step*.6;return `<rect x="${pad+i*step+(step-barWidth)/2}" y="${Math.min(y(row.net),y(0))}" width="${barWidth}" height="${Math.max(1,Math.abs(y(row.net)-y(0)))}" fill="${row.net<0?'#bc5b35':'#235e49'}"><title>${escape(row.key)} · ${cash(row.net)}</title></rect>`;}).join('')}</svg><p>${escape(rows[0].key)} → ${escape(rows.at(-1).key)} · ต่ำสุด ${cash(low)} / สูงสุด ${cash(high)} · แสดงแท่งเฉพาะช่วงที่มีธุรกรรม</p><details><summary>ตัวเลขกราฟทั้งหมด ${rows.length} ช่วง</summary>${rows.map(r=>`<p>${escape(r.key)} · รับ ${cash(r.received)} / คืน ${cash(r.refunded)} / สุทธิ ${cash(r.net)}</p>`).join('')}</details>`:'<p>ไม่มีธุรกรรมรับ–คืนเงินในช่วงนี้</p>';
}
function shiftMarkup(s,r){
 const owner=state.employees.find(e=>e.id===s.employee_id)?.name||s.employee_id;
 return `<p>กะ ${escape(s.id)} · ${escape(owner)}<br>${date(s.openedAt)} → ${s.endedAt===null?'ยังเปิดอยู่':date(s.endedAt)} (Asia/Bangkok)<br>${s.status} · <b>${reconcileLabels[r.status]}</b></p><p>เงินทอนตั้งต้น ${cash(s.openingFloatSatang)}<br>สดตามระบบ: รับ ${cash(r.cashReceived)} − คืน ${cash(r.cashRefunded)} = ${cash(r.cashNet)}<br>QR ตามระบบ: รับ ${cash(r.qrReceived)} − คืน ${cash(r.qrRefunded)} = ${cash(r.qrNet)}<br>เติมสด ${cash(r.cashIn)} · นำสดออก ${cash(r.cashOut)}<br>สดควรอยู่ในลิ้นชัก ${cash(r.expectedCash)}</p>${r.actual?`<p>นับจริง ${cash(r.actual.countedCashSatang)} · ผลต่างสด ${cash(r.cashDifference)}<br>QR สุทธิที่ตรวจจากหลักฐาน ${cash(r.actual.verifiedQRSatang)} · ผลต่าง QR ${cash(r.qrDifference)}<br><b>ผลต่างรวม ${cash(r.totalDifference)}</b> · ผลต่างการส่งมอบกับยอดนับ ${cash(r.handoverDifference)}<br>เงินทอนเก็บไว้ ${cash(r.actual.retainedFloatSatang)} · ควรส่ง ${cash(r.expectedHandover)} · ส่งจริง ${cash(r.actual.handedOverSatang)}<br>ส่งจริงเทียบยอดคาด ${cash(r.handoverAgainstExpected)}</p><p>หลักฐาน QR ที่พนักงานระบุ: ${escape(s.qrEvidence||'ไม่มี QR')}<br>เหตุผล: ${escape(s.reason||'—')} · หมายเหตุ ${escape(s.note||'—')}<br>ผู้อนุมัติ ${escape(s.approvedBy||'ยังไม่อนุมัติ')} · ${date(s.approvedAt)}<br>ตรวจบัญชี: ${escape(s.bankVerification?.status||'รอตรวจ')} (ตรวจมือ ไม่ใช่ธนาคารยืนยันอัตโนมัติ)</p>${s.approvedSnapshot?`<p><b>ยอดที่อนุมัติเดิม: ${reconcileLabels[s.approvedSnapshot.status]}</b><br>นับสดเดิม ${cash(s.approvedSnapshot.actual.countedCashSatang)} · ผลต่างสดเดิม ${cash(s.approvedSnapshot.cashDifference)} · QR เดิม ${cash(s.approvedSnapshot.qrDifference)}</p>`:''}${s.corrections.map(c=>`<p>แก้ไข ${date(c.at)} โดย ${escape(c.employee_id)}: นับสด ${cash(c.countedCashDelta)} / QR ${cash(c.verifiedQRDelta)} / ส่งมอบ ${cash(c.handedOverDelta)} · ${escape(c.reason)}</p>`).join('')}`:''}`;
}
function renderReconciliation(report){
 renderChart(report);const manager=state.employees.find(e=>e.id===activeActor)?.role==='manager',active=state.shifts.find(s=>s.status==='OPEN');
 $('#active-shift').innerHTML=active?shiftMarkup(active,reconciliation(state,active))+`<div class="actions"><button data-shift-action="drawer-in" data-shift="${active.id}">เติมเงินเข้าลิ้นชัก</button><button data-shift-action="drawer-out" data-shift="${active.id}">นำเงินออก</button><button data-shift-action="submit" data-shift="${active.id}">ส่งยอดปิดกะ</button></div>`:`<p>${state.shiftControl.enabled?'ยังไม่มีกะเปิด ต้องเปิดกะใหม่ก่อนรับ/คืนเงิน':'ยังไม่เปิดใช้การผูกกะ รายการเงินเดิมจะแสดงว่ายังไม่ผูกกะ เปิดกะเพื่อควบคุมรายการใหม่'}</p>`;
 $('#open-shift').disabled=!!active;$('#historical-shift').hidden=!manager;
 $('#shift-list').innerHTML=report.shifts.map(s=>`<details class="session-record"><summary>${date(s.openedAt)} · ${escape(state.employees.find(e=>e.id===s.employee_id)?.name||s.employee_id)} · ${s.status} · ${reconcileLabels[s.reconciliation.status]}</summary>${shiftMarkup(s,s.reconciliation)}${s.status==='SUBMITTED'&&manager?`<button data-shift-action="approve" data-shift="${s.id}">ตรวจสอบและอนุมัติปิดกะ</button>`:''}${s.status==='APPROVED'&&manager?`<button data-shift-action="correct" data-shift="${s.id}">สร้างรายการแก้ไขหลังปิดกะ</button>`:''}<p>ผูกรายการเงิน ${s.transaction_ids.length} รายการ · แก้ไข ${s.corrections.length} รายการ</p><details><summary>รายการเงิน / เงินเข้าออก / ยอดอนุมัติเดิม / รายการแก้ไข</summary><pre>${escape(JSON.stringify({transactions:state.transactions.filter(t=>s.transaction_ids.includes(t.id)),cashMovements:s.cashMovements,approvedSnapshot:s.approvedSnapshot,corrections:s.corrections},null,2))}</pre></details></details>`).join('')||'<p>ไม่มีกะในช่วงวันที่เลือก เลือกย้อนหลังทั้งหมดเพื่อดูกะก่อนหน้า</p>';
 $('#employee-report').innerHTML=report.employees.map(e=>`<p>${escape(e.name)} · รับ ${cash(e.received)} / คืน ${cash(e.refunded)} / สุทธิ ${cash(e.net)} · ${e.count} รายการเงิน (ตามผู้ทำรายการ ไม่ใช่ผู้รับผิดชอบกะ)</p>`).join('');
 $('#anomalies').innerHTML=report.anomalies.map(a=>`<details><summary>${escape(a.type)} · ${date(a.at)} · ${escape(a.employee_id||'—')}</summary><p>${escape(a.reason||'ตรวจรายละเอียด')} · ${escape(a.id)}</p><pre>${escape(JSON.stringify(a.details,null,2))}</pre></details>`).join('')||'<p>ไม่พบรายการต้องตรวจในช่วงนี้</p>';
 $('#unassigned').innerHTML=`<p>รายการเงินในช่วงวันที่ที่ยังไม่ผูกกะ ${report.unassignedTransactions.length} รายการ — ไม่ถูกนับซ้ำเข้ากะใหม่อัตโนมัติ</p><details><summary>รหัสรายการยังไม่ผูกกะ</summary><pre>${escape(JSON.stringify(report.unassignedTransactions,null,2))}</pre></details>`;
}
const moneyInput=(id,label,value='',signed=false)=>`<label>${label}<input id="${id}" type="number" ${signed?'':'min="0"'} step="0.01" value="${value}" required></label>`;
const satang=id=>Math.round(Number($('#'+id).value)*100);
function actualFields(retained=0){return moneyInput('counted-cash','เงินสดที่นับจริง (รวมเงินทอนตั้งต้น)')+moneyInput('verified-qr','QR สุทธิที่ตรวจบัญชี/หลักฐานจริง (ติดลบได้เมื่อมีคืนเงิน)','',true)+moneyInput('retained-float','เงินทอนเก็บไว้ ไม่ส่งมอบ',retained/100)+moneyInput('handed-over','เงินสดที่ส่งมอบจริง')+'<label>หลักฐาน QR ที่ตรวจ (อ้างอิงทดสอบ ไม่ใส่รหัสลับ)<input id="qr-evidence" maxlength="2000"></label><label>เหตุผลเมื่อยอดต่าง/รอตรวจสอบ<input id="shift-reason" maxlength="2000"></label><label>หมายเหตุ<input id="shift-note" maxlength="2000"></label>';}
const actualPayload=()=>({countedCashSatang:satang('counted-cash'),verifiedQRSatang:satang('verified-qr'),retainedFloatSatang:satang('retained-float'),handedOverSatang:satang('handed-over'),qrEvidence:$('#qr-evidence').value.trim(),reason:$('#shift-reason').value.trim(),note:$('#shift-note').value.trim()});
function shiftAction(type,s){
 if(type==='drawer-in'||type==='drawer-out')showDialog(type==='drawer-in'?'เติมเงินเข้าลิ้นชัก ไม่ใช่รายได้':'นำเงินออก ไม่ลดรายได้',shiftMarkup(s,reconciliation(state,s))+moneyInput('drawer-amount','จำนวนเงิน')+reasonField,'drawerMovement',()=>({shift_id:s.id,direction:type==='drawer-in'?'in':'out',amountSatang:satang('drawer-amount'),reason:reason()}));
 else if(type==='submit'){
  const r=reconciliation(state,s);showDialog('ส่งยอดปิดกะ — ยังไม่ใช่อนุมัติ',shiftMarkup(s,r)+actualFields(Math.min(s.openingFloatSatang,r.expectedCash))+'<p>หลังส่งจะล็อกยอดเพื่อรอผู้จัดการ หากยังขายต่อให้เปิดกะใหม่</p>','submitShift',()=>({shift_id:s.id,...actualPayload()}));
 }else if(type==='approve')showDialog('ผู้จัดการตรวจสอบและอนุมัติปิดกะ',shiftMarkup(s,reconciliation(state,s))+'<p>ยอดอนุมัติจะถูกเก็บและล็อก การตรวจ QR นี้เป็นการตรวจหลักฐานด้วยมือ</p>'+reasonField,'approveShift',()=>({shift_id:s.id,reason:reason()}));
 else if(type==='correct')showDialog('สร้างรายการแก้ไข — ไม่ทับยอดอนุมัติเดิม',shiftMarkup(s,reconciliation(state,s))+moneyInput('count-delta','ปรับยอดนับจริง +/− บาท','0',true)+moneyInput('qr-delta','ปรับยอด QR ที่ตรวจ +/− บาท','0',true)+moneyInput('handover-delta','ปรับยอดส่งจริง +/− บาท','0',true)+reasonField+'<label>หลักฐานใหม่เมื่อแก้ QR<input id="new-qr-evidence" maxlength="2000"></label>','correctShift',()=>({shift_id:s.id,countedCashDelta:satang('count-delta'),verifiedQRDelta:satang('qr-delta'),handedOverDelta:satang('handover-delta'),reason:reason(),qrEvidence:$('#new-qr-evidence').value.trim()}));
}
$('#shift-list').onclick=e=>{const b=e.target.closest('[data-shift-action]');if(b)shiftAction(b.dataset.shiftAction,state.shifts.find(s=>s.id===b.dataset.shift));};
$('#active-shift').onclick=e=>{const b=e.target.closest('[data-shift-action]');if(b)shiftAction(b.dataset.shiftAction,state.shifts.find(s=>s.id===b.dataset.shift));};
function employeeOptions(){return state.employees.filter(e=>activeActor===e.id||state.employees.find(a=>a.id===activeActor)?.role==='manager').map(e=>`<option value="${escape(e.id)}">${escape(e.name)}</option>`).join('');}
$('#open-shift').onclick=()=>showDialog('เปิดกะใหม่ (ลิ้นชักกลางหนึ่งกะต่อเวลา)',`<label>ผู้รับผิดชอบ<select id="shift-employee">${employeeOptions()}</select></label>`+moneyInput('opening-float','เงินทอนตั้งต้น')+'<p>เงินทอนและเงินเข้าออกไม่ใช่ยอดขาย ไม่ดึงรายการเก่าเข้ากะใหม่</p>','openShift',()=>({employee_id:$('#shift-employee').value,openingFloatSatang:satang('opening-float')}));
$('#historical-shift').onclick=()=>{showDialog('สร้างกะย้อนหลังสำหรับรายการที่ยังไม่ผูกกะ',`<label>ผู้รับผิดชอบ<select id="shift-employee">${employeeOptions()}</select></label><label>เริ่ม (Asia/Bangkok)<input id="shift-from" type="datetime-local" required></label><label>สิ้นสุด ไม่รวมเวลานี้ (Asia/Bangkok)<input id="shift-to" type="datetime-local" required></label>`+moneyInput('opening-float','เงินทอนตั้งต้น')+moneyInput('historical-in','เงินสดเติมรวมตามหลักฐาน','0')+moneyInput('historical-out','เงินสดนำออกรวมตามหลักฐาน','0')+actualFields()+'<p>ห้ามช่วงซ้อนกะอื่น จะผูกเฉพาะรายการในช่วง [เริ่ม,สิ้นสุด) และห้ามรายการเดียวอยู่สองกะ</p>','createHistoricalShift',()=>({employee_id:$('#shift-employee').value,openedAt:Date.parse($('#shift-from').value+'+07:00'),endedAt:Date.parse($('#shift-to').value+'+07:00'),openingFloatSatang:satang('opening-float'),historicalCashInSatang:satang('historical-in'),historicalCashOutSatang:satang('historical-out'),...actualPayload()}));};
$('#chart-group').onchange=()=>{if(state)reports();};
$('#export-summary').onclick=()=>{const r=reports();if(!r)return;const url=URL.createObjectURL(new Blob([incomeSummaryCSV(r)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-income-${r.range.from}-${r.range.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#export-shifts').onclick=()=>{const r=reports();if(!r)return;const url=URL.createObjectURL(new Blob([shiftsCSV(r)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-shifts-${r.range.from}-${r.range.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#print-report').onclick=()=>{if(!reports())return;const details=[...document.querySelectorAll('#income-menu details,#shift-menu details')].map(el=>[el,el.open]);details.forEach(([el])=>el.open=true);const restore=()=>details.forEach(([el,open])=>el.open=open);window.addEventListener('afterprint',restore,{once:true});try{window.print();}catch(e){restore();setMessage(e.message);}};
$('#export-bills-csv').onclick=()=>{const report=reports();if(!report)return;const url=URL.createObjectURL(new Blob([billsCSV(report)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-bills-${report.range.from}-${report.range.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function init(){try{
  state=await readState();const today=bangkokDay(appNow());$('#report-day').value=today;$('#report-month').value=today.slice(0,7);$('#report-week').value=isoWeek(today);$('#report-from').value=today;$('#report-to').value=today;$('#report-employee').innerHTML='<option value="">พนักงานทุกคน</option>'+state.employees.map(e=>`<option value="${escape(e.id)}">${escape(e.name)}</option>`).join('');$('#actor').innerHTML=state.employees.map(e=>`<option value="${escape(e.id)}">${escape(e.name)} (${e.role})</option>`).join('');
  $('#mode').textContent=mode==='server-demo'?'SERVER DEMO · SQLite กลางบนเครื่องเซิร์ฟเวอร์ · หลายเครื่องต้องเปิดเซิร์ฟเวอร์เดียวกัน · บิลประจำ Session':'LOCAL DEMO · ทดลองหน้าจอเท่านั้น ยอดนี้ไม่ใช่ฐานรายได้ร้าน ใช้ Server Demo เพื่อเก็บข้อมูลถาวร ห้ามใช้รับเงินจริง';if(state.fixtureLabel)$('#mode').textContent+=' · '+state.fixtureLabel;render();
  const pending=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null');if(pending){if(state.commands.some(c=>c.id===pending.command.id)){sessionStorage.removeItem(PENDING_KEY);setMessage('คำสั่งก่อนรีเฟรชบันทึกสำเร็จแล้ว ไม่บันทึกซ้ำ');}else{showDialog('ตรวจสอบคำสั่งค้างจากก่อนรีเฟรช',`<p>ส่งคำสั่งเดิมเท่านั้น เพื่อป้องกันรับเงินซ้ำ</p><pre>${escape(JSON.stringify(pending.command,null,2))}</pre>`,pending.command.type,()=>pending.command.payload);Object.assign(modal,{id:pending.command.id,revision:pending.command.expectedRevision,actorId:pending.actorId,pending:pending.command});$('#cancel-dialog').disabled=true;}}
  setInterval(tick,1000);setInterval(async()=>{if(busy||modal)return;try{const latest=await readState();if(latest.revision!==state.revision){state=latest;render();}}catch{setMessage('ติดต่อแหล่งข้อมูลไม่ได้ อย่ารับเงินจริง ตรวจการเชื่อมต่อก่อนทำรายการ');}},2000);
}catch(e){setMessage(`เปิดข้อมูลไม่ได้: ${e.message} · ข้อมูลเดิมไม่ได้ถูกล้าง กรุณาสำรองข้อมูลและตรวจสอบก่อน`);document.querySelectorAll('button').forEach(b=>b.disabled=true);}}
init();
