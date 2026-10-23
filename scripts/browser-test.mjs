// Optional browser integration tests; all data stays in isolated in-memory SQLite.
import assert from 'node:assert/strict';
import {createServer} from '../server.js';
import {DemoStore} from '../server/store.js';
import {execute} from '../src/domain.js';
const {chromium}=await import(process.env.NEEB20_PLAYWRIGHT_MODULE||'playwright');
const store=new DemoStore();
const seeded=execute(store.read(),{id:'seed-expired',type:'start',payload:{station_id:12,method:'cash',paymentConfirmed:true},expectedRevision:0},'staff-01',Date.now()-2000000).state;
store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(seeded));
const server=createServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.NEEB20_CHROMIUM?{executablePath:process.env.NEEB20_CHROMIUM}:{}),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const confirm=async(p=page)=>{const check=p.locator('#payment-confirmed');if(await check.count())await check.check();await p.locator('#confirm-command').click();await p.waitForFunction(()=>!document.querySelector('#confirm-dialog').open);};
 const start=async(id,p=page)=>{await p.locator(`[data-start="${id}"]`).click();await confirm(p);};
 await page.goto(url);await page.locator('.station').last().waitFor();assert.equal(await page.locator('.station').count(),12);assert.match(await page.locator('#station-12 .badge').innerText(),/หมดเวลา/);
 // No session or money exists before explicit confirmation.
 await page.locator('[data-start="1"]').click();await page.locator('#confirm-command').click();assert.equal(store.read().sessions.length,1);await page.locator('#cancel-dialog').click();assert.equal(store.read().transactions.length,1);
 await start(1);let s=store.read().sessions.find(s=>s.station_id===1),sessionId=s.session_id,billId=s.bill_id,end=s.endsAt;
 assert.equal(store.read().transactions.at(-1).amountSatang,2000);
 await page.locator('#station-1 [data-action="markUsed"]').click();await confirm();
 await page.locator('#station-1 [data-action="move"]').click();await page.locator('#target').selectOption('3');await page.locator('#reason').fill('ย้ายจุดทดสอบ');await confirm();
 s=store.read().sessions.find(s=>s.session_id===sessionId);assert.equal(s.station_id,3);assert.equal(s.endsAt,end);assert.equal(s.bill_id,billId);assert.equal(store.read().transactions.length,2);
 await page.reload();await page.locator('#station-3 [data-action="extend"]').click();await page.locator('#payment-method').selectOption('qr');await confirm();assert.equal(store.read().sessions.find(s=>s.session_id===sessionId).feeSatang,2500);assert.equal(store.read().transactions.at(-1).method,'qr');
 await page.locator('#station-3 [data-action="finish"]').click();assert.match(await page.locator('#dialog-body').innerText(),new RegExp(sessionId));assert.match(await page.locator('#dialog-body').innerText(),/ชำระแล้ว/);
 const txBeforeFinish=store.read().transactions.length;await page.evaluate(()=>{const b=document.querySelector('#confirm-command');b.click();b.click();});await page.waitForFunction(()=>!document.querySelector('#confirm-dialog').open);assert.equal(store.read().transactions.length,txBeforeFinish);
 for(let i=0;i<2;i++){await page.locator('[data-product="p1"]').click();await confirm();}
 assert.match(await page.locator('#total').innerText(),/58/);await page.locator('#checkout').click();await page.locator('#payment-method').selectOption('qr');await confirm();assert.equal(store.read().receipts.at(-1).total,58);assert.equal(store.read().products[0].stock,18);
 await page.locator('#actor').selectOption('manager-01');await page.locator(`[data-record="restore"][data-session="${sessionId}"]`).click();await page.locator('#reason').fill('จบผิดคิว');const receiptsBeforeRestore=store.read().receipts.length;await confirm();assert.equal(store.read().receipts.length,receiptsBeforeRestore);
 await page.locator('#station-3 [data-action="extend"]').click();await confirm();assert.equal(store.read().transactions.filter(t=>t.bill_id===billId).reduce((n,t)=>n+t.amountSatang,0),3000);
 await page.locator('#actor').selectOption('staff-01');await start(2);const wrong=store.read().sessions.find(s=>s.station_id===2);
 await page.locator('#station-2 [data-action="requestCancel"]').click();await page.locator('#reason').fill('ลูกค้ายังไม่ได้ใช้');await confirm();assert.equal(await page.locator('[data-record="approveCancel"]').count(),0);
 await page.locator('#actor').selectOption('manager-01');await page.locator(`[data-record="approveCancel"][data-session="${wrong.session_id}"]`).click();await page.locator('#reason').fill('คืนเต็มก่อนใช้');await confirm();assert.equal(store.read().sessions.find(s=>s.session_id===wrong.session_id).serviceStatus,'cancelled');assert.equal(store.read().transactions.filter(t=>t.bill_id===wrong.bill_id).reduce((n,t)=>n+(t.type==='refund'?-1:1)*t.amountSatang,0),0);
 const device=await browser.newContext(),other=await device.newPage();await other.goto(url);await other.locator('#station-3 [data-action="move"]').click();await other.locator('#target').selectOption('5');await other.locator('#reason').fill('คำสั่งจากเครื่องเก่า');
 await start(5);await other.locator('#confirm-command').click();await other.locator('#dialog-error').filter({hasText:'ข้อมูลเปลี่ยน'}).waitFor();assert.equal(store.read().sessions.find(s=>s.session_id===sessionId).station_id,3);await other.locator('#cancel-dialog').click();await device.close();
 await page.locator('summary').filter({hasText:'เพิ่มสินค้า'}).click();
 for(const [name,value] of Object.entries({sku:'TEST001',category:'ทดสอบ',name:'สินค้าทดสอบใหม่',barcode:'TEST001',cost:'10',price:'15',stock:'2'}))await page.locator(`[name="${name}"]`).fill(value);
 await page.locator('#product-form button').click();await confirm();await page.locator('#search').fill('test001');assert.equal(await page.locator('.product').count(),1);const productId=store.read().products.at(-1).id;
 await page.locator('[data-product-action="editProduct"]').click();await page.locator('#edit-price').fill('17');await confirm();
 await page.locator('[data-product-action="receiveStock"]').click();await page.locator('#quantity').fill('3');await page.locator('#reason').fill('รับเข้า');await confirm();
 await page.locator('[data-product-action="adjustStock"]').click();await page.locator('#quantity').fill('-1');await page.locator('#reason').fill('ชำรุด');await confirm();assert.equal(store.read().products.at(-1).stock,4);
 await page.locator('[data-product="'+productId+'"]').click();await confirm();await page.locator('#checkout').click();await confirm();assert.equal(store.read().products.at(-1).stock,3);
 await page.locator('summary').filter({hasText:'รายการขายสินค้า / คืนสินค้า'}).click();const original=store.read().transactions.filter(t=>t.product_id===productId&&t.type==='payment').at(-1);await page.locator(`[data-return="${original.id}"]`).click();await page.locator('#reason').fill('คืนสินค้า');await confirm();assert.equal(store.read().products.at(-1).stock,4);
 await page.locator('[data-product-action="setProductActive"]').click();await page.locator('#reason').fill('พักขาย');await confirm();assert.equal(await page.locator('[data-product="'+productId+'"]').isDisabled(),true);
 assert.match(await page.locator('#report-summary').innerText(),/รายได้สุทธิ/);const downloadPromise=page.waitForEvent('download');await page.locator('#export-csv').click();const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.csv'));
 const apiReport=await (await fetch(url+'/api/reports')).json();assert.equal(apiReport.demo,true);assert.equal(apiReport.summary.product,7500);assert.equal(apiReport.summary.refunded,3700);
 const processed=store.read().commands.find(c=>JSON.parse(c.fingerprint).type==='start'&&JSON.parse(c.fingerprint).payload.station_id===1);const fp=JSON.parse(processed.fingerprint),txCount=store.read().transactions.length;
 await page.evaluate(p=>sessionStorage.setItem('neeb20:pending:v3',JSON.stringify(p)),{actorId:fp.actorId,command:{id:processed.id,type:fp.type,payload:fp.payload,expectedRevision:0}});await page.reload();await page.locator('#message').filter({hasText:'ก่อนรีเฟรชบันทึกสำเร็จ'}).waitFor();assert.equal(store.read().transactions.length,txCount);assert.equal(await page.evaluate(()=>sessionStorage.getItem('neeb20:pending:v3')),null);
 for(const [width,height] of [[768,1024],[390,844]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);
 const standalone=await context.newPage();await standalone.goto(url+'/NEEB20-DEMO.html');await standalone.waitForFunction(()=>document.querySelector('#mode').textContent.includes('LOCAL DEMO'));
 const legacy={version:1,stations:Array.from({length:12},(_,i)=>({id:i+1,session:i===0?{id:'legacy-session',startedAt:100,endsAt:Date.now()+1000000,extensions:0}:null})),products:[{id:'legacy-p',name:'หวีทดสอบ',barcode:'ABC',cost:1,price:2,stock:3}],cart:[],receipts:[{id:'keep-old-receipt',total:10}]};
 await standalone.evaluate(old=>{localStorage.removeItem('neeb20:demo:v3');localStorage.setItem('neeb20:demo:v1',JSON.stringify(old));},legacy);await standalone.reload();await standalone.locator('#station-1 [data-action="move"]').waitFor();
 const migrated=await standalone.evaluate(()=>JSON.parse(localStorage.getItem('neeb20:demo:v3')));assert.equal(migrated.sessions[0].endsAt,legacy.stations[0].session.endsAt);assert.equal(migrated.legacyArchive.receipts[0].id,'keep-old-receipt');assert.equal(store.read().sessions.some(s=>s.session_id==='legacy-session'),false);
 console.log('PASS Chromium: explicit prepaid/cancel-before-payment, 12 stations, expiry, move/refresh, QR extension, finish no extra payment, POS58, restore, full unused cancellation refund, concurrency, catalog, stock/return, reports/API/CSV, reload pending-command recovery, responsive, standalone migration');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));store.close();}
