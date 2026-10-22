import {STORAGE_KEY,createDemo,status,start,extend,finish,total,checkout,newId} from './domain.js';
const $=s=>document.querySelector(s);
let state;
try {state=JSON.parse(localStorage.getItem(STORAGE_KEY)) || createDemo(); if(state.version!==1 || state.stations.length!==12) throw Error();}
catch { state=createDemo(); $('#message').textContent='อ่านข้อมูลทดสอบเดิมไม่ได้ ใช้ชุดตัวอย่างใหม่ ข้อมูลเดิมยังไม่ถูกเขียนทับจนกว่าจะทำรายการ'; }
const money=n=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function action(fn){const before=structuredClone(state);try{fn();save();render();}catch(e){state=before;$('#message').textContent=e.name==='QuotaExceededError'?'พื้นที่จัดเก็บเต็ม รายการยังไม่ถูกบันทึก':e.message;render();}}
const labels={idle:'ว่าง พร้อมให้บริการ',active:'กำลังให้บริการ',warning:'ใกล้หมดเวลา',expired:'หมดเวลา · รอยืนยัน'};
const notified=new Map();
function stations(){const now=Date.now();$('#summary').textContent=`ว่าง ${state.stations.filter(s=>!s.session).length} / 12 จุด`;
 $('#stations').innerHTML=state.stations.map(s=>{const kind=status(s.session,now),left=s.session?Math.max(0,Math.ceil((s.session.endsAt-now)/1000)):1500;
 if(s.session && ['warning','expired'].includes(kind) && notified.get(s.session.id)!==kind){$('#message').textContent=`จุด ${s.id}: ${labels[kind]} กรุณาตรวจสอบและเปิด–ปิดไฟด้วยมือ`;notified.set(s.session.id,kind);}
 return `<article class="station ${kind}"><h2>จุด ${String(s.id).padStart(2,'0')}</h2><span class="badge">${labels[kind]}</span><div class="timer" aria-label="เวลาคงเหลือ">${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}</div><p>${s.session?`ยอดบริการ ${money(20+s.session.extensions*5)} · สิ้นสุด ${new Date(s.session.endsAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}`:'25 นาที · 20 บาท'}</p><div class="actions">${s.session?`<button data-action="extend" data-id="${s.id}" class="secondary">+5 นาที / 5฿</button><button data-action="finish" data-id="${s.id}">ยืนยันจบคิว</button>`:`<button data-action="start" data-id="${s.id}">เริ่มคิว 20฿</button>`}</div></article>`;}).join('');
}
function products(){const query=$('#search').value.trim().toLowerCase();$('#products').innerHTML=state.products.filter(p=>p.name.toLowerCase().includes(query)||p.barcode.toLowerCase().includes(query)).map(p=>`<div class="product"><div><b>${escape(p.name)}</b><small>ทุน ${money(p.cost)} · ขาย ${money(p.price)}<br>สต๊อกทดสอบ ${p.stock} · ${escape(p.barcode)}</small></div><button data-product="${p.id}" ${p.stock<=0?'disabled':''}>ใส่ตะกร้า</button></div>`).join('')||'<p>ไม่พบสินค้า</p>';}
function render(){stations();products();$('#cart').innerHTML=state.cart.map((l,i)=>`<div class="cart-line"><div>${escape(l.name)} × ${l.quantity}<small>${money(l.price*l.quantity)}</small></div>${l.kind==='product'?`<button class="secondary" data-remove="${i}" aria-label="นำ ${escape(l.name)} ออก">นำออก</button>`:'<small>ค่าบริการจบคิว</small>'}</div>`).join('')||'<p>ยังไม่มีรายการ</p>';$('#total').textContent=money(total(state.cart));$('#checkout').disabled=!state.cart.length;
 const last=state.receipts.at(-1);$('#receipt').innerHTML=last?`<b>บิลทดสอบล่าสุด · ไม่ใช่หลักฐานรับเงินจริง</b><br>${new Date(last.createdAt).toLocaleString('th-TH')}<br>${last.lines.map(l=>`${escape(l.name)} × ${l.quantity} — ${money(l.price*l.quantity)}`).join('<br>')}<br><b>รวม ${money(last.total)}</b><br>ปรับเฉพาะสต๊อกทดสอบในเบราว์เซอร์แล้ว`:'';
}
$('#stations').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const s=state.stations.find(s=>s.id===Number(b.dataset.id));if(b.dataset.action==='finish'&&!confirm(`ยืนยันจบคิวจุด ${s.id} และเพิ่มค่าบริการลงบิล? กรุณาปิดไฟด้วยมือ`))return;action(()=>{if(b.dataset.action==='start')start(s);else if(b.dataset.action==='extend')extend(s);else finish(state,s);});});
$('#products').addEventListener('click',e=>{const b=e.target.closest('[data-product]');if(!b)return;action(()=>{const p=state.products.find(p=>p.id===b.dataset.product),line=state.cart.find(l=>l.kind==='product'&&l.id===p.id);if((line?.quantity||0)>=p.stock)throw Error('จำนวนเกินสต๊อกทดสอบ');if(line)line.quantity++;else state.cart.push({kind:'product',id:p.id,name:p.name,price:p.price,cost:p.cost,quantity:1});});});
$('#cart').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b)action(()=>state.cart.splice(Number(b.dataset.remove),1));});
$('#search').addEventListener('input',products);
$('#product-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),name=f.get('name').trim(),barcode=f.get('barcode').trim(),cost=Number(f.get('cost')),price=Number(f.get('price')),stock=Number(f.get('stock'));action(()=>{if(!name||!Number.isFinite(cost)||cost<0||!Number.isFinite(price)||price<=0||!Number.isInteger(stock)||stock<0)throw Error('กรุณาตรวจสอบข้อมูลสินค้า');if(barcode&&state.products.some(p=>p.barcode===barcode))throw Error('บาร์โค้ดซ้ำ');state.products.push({id:newId(),name,barcode,cost,price,stock});});});
$('#checkout').addEventListener('click',()=>{if(confirm('ยืนยันบิลจำลอง? ไม่รับเงินจริง และปรับเฉพาะสต๊อกทดสอบ'))action(()=>{checkout(state);$('#message').textContent='บันทึกบิลทดสอบสำเร็จ';});});
$('#reset').addEventListener('click',()=>{if(confirm('ล้างคิว ตะกร้า บิล และสินค้าทดสอบทั้งหมดในเครื่องนี้?'))action(()=>{state=createDemo();$('#message').textContent='เริ่มชุดข้อมูลทดสอบใหม่แล้ว';});});
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY){location.reload();}});
render();setInterval(stations,1000);
