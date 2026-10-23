// Optional UI integration test. Keep Playwright out of the application's dependencies.
import assert from 'node:assert/strict';
import {createServer} from '../server.js';
import {DemoStore} from '../server/store.js';
import {execute} from '../src/domain.js';
const {chromium}=await import(process.env.NEEB20_PLAYWRIGHT_MODULE||'playwright');
const store=new DemoStore();
const seeded=execute(store.read(),{id:'seed-expired',type:'start',payload:{station_id:12},expectedRevision:0},'staff-01',Date.now()-2000000).state;
store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(seeded));
const server=createServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.NEEB20_CHROMIUM?{executablePath:process.env.NEEB20_CHROMIUM}:{}),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const confirm=async(p=page)=>{await p.locator('#confirm-command').click();await p.waitForFunction(()=>!document.querySelector('#confirm-dialog').open);};
 const start=async(id,p=page)=>{await p.locator(`[data-start="${id}"]`).click();await confirm(p);};
 await page.goto(url);await page.locator('.station').last().waitFor();assert.equal(await page.locator('.station').count(),12);assert.match(await page.locator('#station-12 .badge').innerText(),/หมดเวลา/);
 await start(1);let s=store.read().sessions.find(s=>s.station_id===1),sessionId=s.session_id,billId=s.bill_id,end=s.endsAt;
 await page.locator('#station-1 [data-action="move"]').click();await page.locator('#target').selectOption('3');await page.locator('#reason').fill('ย้ายจุดทดสอบ');await confirm();
 s=store.read().sessions.find(s=>s.session_id===sessionId);assert.equal(s.station_id,3);assert.equal(s.endsAt,end);assert.equal(s.bill_id,billId);assert.equal(store.read().transactions.length,0);
 await page.reload();await page.locator('#station-3 [data-action="extend"]').click();await confirm();assert.equal(store.read().sessions.find(s=>s.session_id===sessionId).feeSatang,2500);
 await page.locator('#station-3 [data-action="finish"]').click();assert.match(await page.locator('#dialog-body').innerText(),new RegExp(sessionId));assert.match(await page.locator('#dialog-body').innerText(),/ยังไม่ชำระ/);
 await page.evaluate(()=>{const b=document.querySelector('#confirm-command');b.click();b.click();});await page.waitForFunction(()=>!document.querySelector('#confirm-dialog').open);assert.equal(store.read().transactions.length,0);
 for(let i=0;i<2;i++){await page.locator('[data-product="p1"]').click();await confirm();}
 assert.match(await page.locator('#total').innerText(),/83/);await page.locator('#checkout').click();await confirm();assert.equal(store.read().receipts[0].total,83);assert.equal(store.read().products[0].stock,18);
 await page.locator('#actor').selectOption('manager-01');await page.locator(`[data-record="restore"][data-session="${sessionId}"]`).click();await page.locator('#reason').fill('จบผิดคิว');await confirm();
 assert.equal(store.read().sessions.find(s=>s.session_id===sessionId).bill_id,billId);assert.equal(store.read().receipts.length,1);
 await page.locator('#station-3 [data-action="extend"]').click();await confirm();assert.equal(store.read().bills.find(b=>b.id===billId).charges.at(-1).supplemental,true);
 await page.locator('#station-3 [data-action="selectBill"]').click();await confirm();assert.match(await page.locator('#total').innerText(),/5\.00/);
 await page.locator('#checkout').click();await confirm();assert.equal(store.read().transactions.filter(t=>t.bill_id===billId).reduce((n,t)=>n+t.amountSatang,0),3000);
 await page.locator('#actor').selectOption('staff-01');await start(2);const wrong=store.read().sessions.find(s=>s.station_id===2);
 await page.locator('#station-2 [data-action="requestCancel"]').click();await page.locator('#reason').fill('กดเริ่มโดยไม่มีลูกค้า');await confirm();assert.equal(await page.locator('[data-record="approveCancel"]').count(),0);
 await page.locator('#actor').selectOption('manager-01');await page.locator(`[data-record="approveCancel"][data-session="${wrong.session_id}"]`).click();await page.locator('#reason').fill('ตรวจแล้ว อนุมัติ');await confirm();assert.equal(store.read().sessions.find(s=>s.session_id===wrong.session_id).serviceStatus,'cancelled');
 // A second device opens a move dialog. First device takes its selected destination.
 const device=await browser.newContext(),other=await device.newPage();await other.goto(url);await other.locator('#station-3 [data-action="move"]').click();await other.locator('#target').selectOption('5');await other.locator('#reason').fill('คำสั่งจากเครื่องเก่า');
 await start(5);await other.locator('#confirm-command').click();await other.locator('#dialog-error').filter({hasText:'ข้อมูลเปลี่ยน'}).waitFor();assert.equal(store.read().sessions.find(s=>s.session_id===sessionId).station_id,3);await other.locator('#cancel-dialog').click();await device.close();
 await page.locator('summary').filter({hasText:'เพิ่มสินค้า'}).click();
 for(const [name,value] of Object.entries({name:'สินค้าทดสอบใหม่',barcode:'TEST001',cost:'10',price:'15',stock:'2'}))await page.locator(`[name="${name}"]`).fill(value);
 await page.locator('#product-form button').click();await confirm();await page.locator('#search').fill('test001');assert.equal(await page.locator('.product').count(),1);
 for(const [width,height] of [[768,1024],[390,844]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);
 // Test the self-contained local demo and v1 migration over HTTP because this
 // cloud browser's administrator policy blocks file:// navigation.
 const standalone=await context.newPage();await standalone.goto(url+'/NEEB20-DEMO.html');
 await standalone.waitForFunction(()=>document.querySelector('#mode').textContent.includes('LOCAL DEMO'));
 const legacy={version:1,stations:Array.from({length:12},(_,i)=>({id:i+1,session:i===0?{id:'legacy-session',startedAt:100,endsAt:Date.now()+1000000,extensions:0}:null})),products:[{id:'legacy-p',name:'หวีทดสอบ',barcode:'ABC',cost:1,price:2,stock:3}],cart:[],receipts:[{id:'keep-old-receipt',total:10}]};
 await standalone.evaluate(old=>{localStorage.removeItem('neeb20:demo:v2');localStorage.setItem('neeb20:demo:v1',JSON.stringify(old));},legacy);await standalone.reload();await standalone.locator('#station-1 [data-action="move"]').waitFor();
 const migrated=await standalone.evaluate(()=>JSON.parse(localStorage.getItem('neeb20:demo:v2')));assert.equal(migrated.sessions[0].endsAt,legacy.stations[0].session.endsAt);assert.equal(migrated.legacyArchive.receipts[0].id,'keep-old-receipt');assert.equal(store.read().sessions.some(s=>s.session_id==='legacy-session'),false);
 console.log('PASS Chromium: stations, expiry, move, preserved deadlines, extension, double-click finish, POS 83, paid restore, supplemental 5, cancellation approval, two-device stale rejection, barcode, responsive layout, local-demo migration');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));store.close();}
