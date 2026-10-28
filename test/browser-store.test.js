import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,execute} from '../src/domain.js';
import {costVisibleState} from '../src/costing.js';
import {browserBackup,parseBrowserBackup,BrowserStore} from '../src/browser-store.js';
test('browser backup preserves complete payment, inventory, deadlines and cost snapshots, hash verifies on import',async()=>{
 let state=createDemo();const run=(type,payload)=>state=execute(state,{id:crypto.randomUUID(),type,payload,expectedRevision:state.revision},'staff-01').state;
 run('start',{station_id:1});const s=state.sessions[0];run('addBillProduct',{session_id:s.session_id,expectedStationId:1,product_id:'p1',quantity:1});run('payBill',{session_id:s.session_id,expectedStationId:1,method:'cash',paymentConfirmed:true});const before=structuredClone(state),backup=await browserBackup(state),restored=await parseBrowserBackup(JSON.stringify(backup));assert.deepEqual(restored,state);assert.deepEqual(state,before);assert.equal(restored.transactions.length,2);assert.equal(restored.sessions[0].endsAt,s.endsAt);assert.equal(restored.products[0].stock,19);assert.equal(backup.sha256.length,64);
});
test('tampered backup fails integrity, invalid JSON/money rejected without inventing history',async()=>{
 const backup=await browserBackup(createDemo());backup.state.products[0].stock++;await assert.rejects(parseBrowserBackup(JSON.stringify(backup)),/ไม่สมบูรณ์/);await assert.rejects(parseBrowserBackup('{'),/JSON/);await assert.rejects(parseBrowserBackup('{}'),/ไม่ใช่ไฟล์/);const state=createDemo();state.transactions.push({id:'invalid',amountSatang:-100});await assert.rejects(browserBackup(state),/ยอดธุรกรรม/);
});
test('previous full manager JSON imports but staff-redacted export cannot lose sensitive cost data silently',async()=>{
 const state=createDemo();assert.deepEqual(await parseBrowserBackup(JSON.stringify(state)),state);await assert.rejects(parseBrowserBackup(JSON.stringify(costVisibleState(state))),/ต้นทุนครบ/);
});
test('browser storage never substitutes or clears data if IndexedDB is unavailable',async()=>{
 await assert.rejects(new BrowserStore().read(),/Safari เปิดฐานข้อมูลไม่ได้/);
});
