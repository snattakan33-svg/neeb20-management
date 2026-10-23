import {STORAGE_KEY,LEGACY_KEY,newId,createDemo,migrateLegacy,validateState,execute,status,sessionAt,finance,salesSummary,cartLines,total} from './domain.js';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n);
const cash=satang=>money(satang/100);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=ms=>ms==null?'—':new Date(ms).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
const labels={idle:'ว่าง พร้อมให้บริการ',active:'กำลังใช้งาน',warning:'ใกล้หมดเวลา',expired:'หมดเวลา รอพนักงานปิดจุด',finished:'จบคิว',cancelled:'ยกเลิก'};
const financialLabels={unpaid:'ยังไม่ชำระ',paid:'ชำระแล้ว','refund-partial':'คืนเงินบางส่วน','refund-full':'คืนเงินเต็มจำนวน','cancelled-before-payment':'ยกเลิกก่อนรับเงิน'};
let state,mode=(location.protocol==='file:'||typeof NEEB20_STANDALONE!=='undefined')?'local-demo':'server-demo',busy=false,modal=null,activeActor='staff-01';
const notified=new Map();
function localRead(){
  const saved=localStorage.getItem(STORAGE_KEY);
  if(saved)return validateState(JSON.parse(saved));
  const legacy=localStorage.getItem(LEGACY_KEY),initial=legacy?migrateLegacy(JSON.parse(legacy)):createDemo();
  localStorage.setItem(STORAGE_KEY,JSON.stringify(initial));return initial;
}
async function readState(){
  if(mode==='local-demo')return localRead();
  const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ยังไม่บันทึกคำสั่ง');return validateState((await r.json()).state);
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
async function commit(cmd,actorId=activeActor){const result=await dispatch(cmd,actorId);state=result.state;render();return result;}
function showDialog(title,body,type,getPayload){
  if(busy||modal)return;
  modal={type,getPayload,revision:state.revision,id:newId(),actorId:activeActor,pending:null};
  $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;$('#dialog-error').textContent='';$('#confirm-command').disabled=false;$('#confirm-command').textContent='ยืนยัน';$('#cancel-dialog').disabled=false;$('#confirm-dialog').showModal();
}
function closeDialog(){if(busy)return;$('#confirm-dialog').close();modal=null;}
$('#cancel-dialog').onclick=closeDialog;
$('#confirm-dialog').addEventListener('cancel',e=>{if(busy||modal?.pending){e.preventDefault();return;}modal=null;});
$('#confirm-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!modal)return;busy=true;$('#confirm-command').disabled=true;$('#cancel-dialog').disabled=true;
  try{
    if(!modal.pending)modal.pending={id:modal.id,type:modal.type,payload:modal.getPayload(),expectedRevision:modal.revision};
    await commit(modal.pending,modal.actorId);setMessage('บันทึกคำสั่งทดสอบสำเร็จ ไม่ได้รับ/คืนเงินจริง');busy=false;closeDialog();
  }catch(error){
    $('#dialog-error').textContent=error.message;
    if(!error.uncertain){modal.pending=null;if(error.code==='CONFLICT'){try{state=await readState();render();}catch{}$('#dialog-error').textContent+=' · กรุณายกเลิกหน้าต่างนี้ แล้วเปิดตรวจสอบใหม่';$('#confirm-command').hidden=true;}}
    else {$('#confirm-command').textContent='ลองคำสั่งเดิมอีกครั้ง';$('#dialog-body').querySelectorAll('input,select').forEach(el=>el.disabled=true);}
  }finally{busy=false;$('#confirm-command').disabled=false;$('#cancel-dialog').disabled=!!modal?.pending;}
});
$('#confirm-dialog').addEventListener('close',()=>{$('#confirm-command').hidden=false;});
function sessionInfo(s){const f=finance(state,s.bill_id);return `<p><b>จุด ${s.station_id} · Session ${escape(s.session_id)}</b></p><p>เริ่ม ${date(s.startedAt)}<br>สิ้นสุด ${date(s.endsAt)}<br>เหลือ ${Math.max(0,Math.ceil((s.endsAt-Date.now())/60000))} นาที (คำนวณจากเวลาสิ้นสุดเดิม)</p><p>ค่าบริการ ${cash(s.feeSatang)}<br>${financialLabels[f.status]} · รับแล้ว ${cash(f.paid)} · คืนแล้ว ${cash(f.refunded)} · ต้องชำระ ${cash(f.due)}</p>`;}
function targetOptions(s){return state.stations.filter(t=>!t.session_id&&t.id!==s?.station_id).map(t=>`<option value="${t.id}">จุด ${t.id}</option>`).join('');}
const reasonField='<label>เหตุผล (จำเป็น)<input id="reason" required maxlength="500"></label>';
const reason=()=>$('#reason').value.trim();
function openSessionAction(type,s){
  const base={session_id:s.session_id,expectedStationId:s.station_id};
  if(type==='move'||type==='correct'){
    const options=targetOptions(s);if(!options){setMessage('ไม่มีจุดว่างสำหรับย้าย');return;}
    showDialog(type==='correct'?'แก้ไขจุดที่เริ่มผิด':'ย้ายจุด',sessionInfo(s)+`<label>จุดปลายทางที่ว่าง<select id="target">${options}</select></label>`+reasonField,'move',()=>({...base,targetStationId:Number($('#target').value),reason:reason(),correction:type==='correct'}));
  }else if(type==='finish')showDialog('ยืนยันจบคิว · ตรวจจุดและ Session',sessionInfo(s)+'<p>กรุณาปิดไฟด้วยมือ การจบคิวไม่ใช่การรับเงิน และไม่สร้างบิลใหม่</p>','finish',()=>base);
  else if(type==='extend')showDialog('ยืนยันต่อเวลา 5 นาที / 5 บาท',sessionInfo(s)+'<p>เพิ่ม 5 นาทีจากเวลาสิ้นสุดเดิม บิลชำระแล้วจะมีค่าเรียกเก็บเพิ่ม 5 บาทในบิลเดิม</p>','extend',()=>base);
  else if(type==='requestCancel')showDialog('ส่งคำขอยกเลิก · รอผู้จัดการอนุมัติ',sessionInfo(s)+reasonField,'requestCancel',()=>({...base,reason:reason()}));
  else if(type==='approveCancel')showDialog('ผู้จัดการอนุมัติยกเลิก',sessionInfo(s)+`<p>คำขอจาก ${escape(s.cancelRequest.requestedBy)}: ${escape(s.cancelRequest.reason)}</p><p>ไม่คืนเงินอัตโนมัติ หากรับแล้วให้ทำรายการคืนเงินแยก</p>`+reasonField,'approveCancel',()=>({...base,reason:reason()}));
  else if(type==='restore'){
    const options=state.stations.filter(t=>!t.session_id).map(t=>`<option value="${t.id}" ${t.id===s.station_id?'selected':''}>จุด ${t.id}</option>`).join('');
    if(!options){setMessage('ไม่มีจุดว่างสำหรับกู้คืน');return;}
    showDialog('ผู้จัดการกู้คืนคิวเดิม',sessionInfo(s)+`<label>จุดที่ว่าง<select id="target">${options}</select></label><p>ไม่เปลี่ยนเวลาสิ้นสุด ไม่สร้าง Session หรือบิลใหม่ เวลาหมดแล้วจะแสดงหมดเวลา</p>`+reasonField,'restore',()=>({...base,targetStationId:Number($('#target').value),reason:reason()}));
  }else if(type==='refund'){
    const f=finance(state,s.bill_id);showDialog('ผู้จัดการบันทึกคืนเงินทดสอบ',sessionInfo(s)+`<label>ยอดคืน (บาท)<input id="refund-amount" type="number" min="0.01" max="${f.net/100}" step="0.01" value="${f.net/100}" required></label>`+reasonField,'refund',()=>({...base,amountSatang:Math.round(Number($('#refund-amount').value)*100),reason:reason()}));
  }else if(type==='selectBill')showDialog('เพิ่มยอดค้างชำระในตะกร้า',sessionInfo(s),'selectBill',()=>base);
}
function tick(){
  if(!state)return;const now=Date.now();
  for(const station of state.stations){const card=$(`#station-${station.id}`);if(!card)continue;const s=sessionAt(state,station.id),kind=status(s,now),left=s?Math.max(0,Math.ceil((s.endsAt-now)/1000)):1500;
    card.className=`station ${kind}`;card.querySelector('.badge').textContent=labels[kind];card.querySelector('.timer').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;
    if(s&&['warning','expired'].includes(kind)&&notified.get(s.session_id)!==kind){setMessage(`จุด ${station.id}: ${labels[kind]} กรุณาตรวจสอบและเปิด–ปิดไฟด้วยมือ`);notified.set(s.session_id,kind);}
  }
}
function stations(){
  $('#summary').textContent=`ว่าง ${state.stations.filter(s=>!s.session_id).length} / 12 จุด`;
  $('#stations').innerHTML=state.stations.map(t=>{const s=sessionAt(state,t.id),f=s?finance(state,s.bill_id):null;
    const btn=(action,label)=>`<button data-action="${action}" data-session="${escape(s.session_id)}" class="${action==='finish'?'':'secondary'}">${label}</button>`;
    return `<article id="station-${t.id}" class="station"><h2>จุด ${String(t.id).padStart(2,'0')}</h2><span class="badge"></span><div class="timer" aria-label="เวลาคงเหลือ"></div><p>${s?`Session ${escape(s.session_id.slice(0,8))}<br>บริการ ${cash(s.feeSatang)} · สิ้นสุด ${date(s.endsAt)}<br>${financialLabels[f.status]}<br>รับแล้ว ${cash(f.paid)} · ค้าง ${cash(f.due)}`:'25 นาที · 20 บาท'}</p><div class="actions">${s?btn('extend','+5 นาที / 5฿')+btn('move','ย้ายจุด')+btn('correct','แก้ไขจุดที่เริ่มผิด')+btn('finish','จบคิว')+btn('selectBill','เรียกเก็บเงิน')+(s.cancelRequest?'<p>รออนุมัติยกเลิก</p>':btn('requestCancel','ขอยกเลิก')):`<button data-start="${t.id}">เริ่มคิว 20฿</button>`}</div></article>`;
  }).join('');tick();
}
function products(){const query=$('#search').value.trim().toLowerCase();$('#products').innerHTML=state.products.filter(p=>p.name.toLowerCase().includes(query)||p.barcode.toLowerCase().includes(query)).map(p=>`<div class="product"><div><b>${escape(p.name)}</b><small>ทุน ${money(p.cost)} · ขาย ${money(p.price)}<br>สต๊อกทดสอบ ${p.stock} · ${escape(p.barcode)}</small></div><button data-product="${escape(p.id)}" ${p.stock<=0?'disabled':''}>ใส่ตะกร้า</button></div>`).join('')||'<p>ไม่พบสินค้า</p>';}
function records(){
  const manager=state.employees.find(e=>e.id===activeActor)?.role==='manager';
  $('#sessions').innerHTML=state.sessions.slice().reverse().map(s=>{const f=finance(state,s.bill_id);const btn=(action,label)=>`<button class="secondary" data-record="${action}" data-session="${escape(s.session_id)}">${label}</button>`;
    return `<article class="session-record"><b>จุด ${s.station_id} · ${escape(s.session_id)}</b><p>${labels[status(s)]} · ${financialLabels[f.status]}<br>บิล ${escape(s.bill_id)} · บริการ ${cash(f.charged)} · รับแล้ว ${cash(f.paid)} · คืนแล้ว ${cash(f.refunded)} · ค้าง ${cash(f.due)}</p><div class="actions">${f.due?btn('selectBill','เรียกเก็บเงิน'):''}${s.serviceStatus!=='cancelled'&&!s.cancelRequest?btn('requestCancel','ขอยกเลิก'):''}${s.cancelRequest?(manager?btn('approveCancel','อนุมัติยกเลิก'):'<span>รอผู้จัดการอนุมัติยกเลิก</span>'):''}${manager&&s.serviceStatus==='finished'?btn('restore','กู้คืนคิว'):''}${manager&&f.net>0?btn('refund','คืนเงินทดสอบ'):''}</div><details><summary>ประวัติคิว ${s.history.length} เหตุการณ์</summary><pre>${escape(JSON.stringify(state.audit.filter(a=>a.session_id===s.session_id),null,2))}</pre></details></article>`;
  }).join('')||'<p>ยังไม่มีคิวทดสอบ</p>';
  const summary=salesSummary(state);$('#financial-summary').textContent=`รับเงินทดสอบ ${cash(summary.received)} · คืนเงินทดสอบ ${cash(summary.refunded)} · สุทธิ ${cash(summary.net)}`;
  $('#audit').innerHTML=state.audit.slice(-50).reverse().map(a=>`<details><summary>${escape(a.type)} · ${escape(a.employee_id)} · ${date(a.at)}</summary><pre>${escape(JSON.stringify(a,null,2))}</pre></details>`).join('')||'<p>ยังไม่มีเหตุการณ์</p>';
  $('#legacy').textContent=state.legacyArchive?'นำเข้าคิวและตะกร้า v1 แล้ว เก็บข้อมูลต้นฉบับทั้งหมดใน legacyArchive; บิลเก่าที่รับแล้วไม่ถูกสร้างเป็นยอดรับเงินใหม่ ดูต้นฉบับได้ในไฟล์สำรอง':'';
}
function render(){
  stations();products();records();const lines=cartLines(state);
  $('#cart').innerHTML=lines.map(l=>`<div class="cart-line"><div>${escape(l.name)} × ${l.quantity}<small>${money(l.price*l.quantity)}${l.bill_id?` · บิล ${escape(l.bill_id)}`:''}</small></div><button class="secondary" data-remove="${escape(l.bill_id||l.id)}">นำออกจากตะกร้า</button></div>`).join('')||'<p>ยังไม่มีรายการค้างในตะกร้า</p>';
  $('#total').textContent=money(total(lines));$('#checkout').disabled=!lines.length;
  const last=state.receipts.at(-1);$('#receipt').innerHTML=last?`<b>บิลทดสอบล่าสุด · ไม่ใช่หลักฐานรับเงินจริง</b><br>${escape(last.id)}<br>${date(last.createdAt)}<br>${last.lines.map(l=>`${escape(l.name)} × ${l.quantity} — ${money(l.price*l.quantity)}`).join('<br>')}<br><b>รวม ${money(last.total)}</b>`:'';
}
// Small cart mutations are also confirmed, revision-checked commands.
$('#stations').onclick=e=>{const start=e.target.closest('[data-start]'),b=e.target.closest('[data-action]');if(start)showDialog('ยืนยันเริ่มบริการ',`<p>จุด ${Number(start.dataset.start)} · 25 นาที / 20 บาท</p><p>ตรวจสอบจุดและเปิดไฟด้วยมือ</p>`,'start',()=>({station_id:Number(start.dataset.start)}));else if(b){const s=state.sessions.find(s=>s.session_id===b.dataset.session);if(s)openSessionAction(b.dataset.action,s);}};
$('#sessions').onclick=e=>{const b=e.target.closest('[data-record]');if(b){const s=state.sessions.find(s=>s.session_id===b.dataset.session);if(s)openSessionAction(b.dataset.record,s);}};
$('#products').onclick=e=>{const b=e.target.closest('[data-product]');if(b)showDialog('เพิ่มสินค้าทดสอบในตะกร้า',`<p>${escape(state.products.find(p=>p.id===b.dataset.product).name)} × 1</p>`,'addCart',()=>({product_id:b.dataset.product}));};
$('#cart').onclick=e=>{const b=e.target.closest('[data-remove]');if(b)showDialog('นำออกจากตะกร้า','<p>นำออกจากตะกร้าเท่านั้น ไม่ยกเลิกบริการ ไม่ลบหนี้หรือประวัติ</p>','removeCart',()=>({line_id:b.dataset.remove}));};
$('#search').addEventListener('input',()=>{if(state)products();});
$('#product-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),payload={name:f.get('name').trim(),barcode:f.get('barcode').trim(),cost:Number(f.get('cost')),price:Number(f.get('price')),stock:Number(f.get('stock'))};showDialog('ยืนยันเพิ่มสินค้าทดสอบ',`<p>${escape(payload.name)} · ขาย ${money(payload.price)} · สต๊อก ${payload.stock}</p>`,'addProduct',()=>payload);};
$('#checkout').onclick=()=>showDialog('ยืนยันรับเงินทดสอบ',`<p>รวม ${money(total(cartLines(state)))}</p><p>จำลองรับเงินเท่านั้น ไม่รับเงินจริง คำสั่งเดิมจะบันทึกได้เพียงครั้งเดียว</p>`,'checkout',()=>({}));
$('#actor').onchange=()=>{activeActor=$('#actor').value;if(state)records();};
$('#export').onclick=async()=>{try{const latest=await readState(),blob=new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`neeb20-demo-backup-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setMessage(e.message);}};
async function init(){try{
  state=await readState();$('#actor').innerHTML=state.employees.map(e=>`<option value="${escape(e.id)}">${escape(e.name)} (${e.role})</option>`).join('');
  $('#mode').textContent=mode==='server-demo'?'SERVER DEMO · SQLite กลางบนเครื่องเซิร์ฟเวอร์ · หลายเครื่องต้องเปิดเซิร์ฟเวอร์เดียวกัน':'LOCAL DEMO · ข้อมูลเฉพาะเบราว์เซอร์ ไม่รองรับหลายอุปกรณ์ ห้ามใช้รับเงินจริง';render();
  setInterval(tick,1000);setInterval(async()=>{if(busy||modal)return;try{const latest=await readState();if(latest.revision!==state.revision){state=latest;render();}}catch{setMessage('ติดต่อแหล่งข้อมูลไม่ได้ อย่ารับเงินจริง ตรวจการเชื่อมต่อก่อนทำรายการ');}},2000);
}catch(e){setMessage(`เปิดข้อมูลไม่ได้: ${e.message} · ข้อมูลเดิมไม่ได้ถูกล้าง กรุณาสำรองข้อมูลและตรวจสอบก่อน`);document.querySelectorAll('button').forEach(b=>b.disabled=true);}}
init();
