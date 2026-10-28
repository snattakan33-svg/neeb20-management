import {createDemo,upgradeState,validateState,execute,newId} from './domain.js';
export const BROWSER_DB_NAME='neeb20-ipad-v1';
function browserStorageError(message,code='INVALID'){const e=Error(message);e.code=code;throw e;}
export function checkedBrowserState(raw){
 const state=upgradeState(structuredClone(raw));validateState(state);
 for(const p of state.products)if(!Number.isFinite(p.cost)||p.cost<0||!Number.isFinite(p.price)||p.price<=0)browserStorageError('ไฟล์สำรองไม่มีต้นทุนครบ อาจเป็นไฟล์จากบทบาทพนักงาน กรุณาสำรองด้วยผู้จัดการ');
 for(const t of state.transactions)if(!Number.isSafeInteger(t.amountSatang)||t.amountSatang<=0)browserStorageError('ยอดธุรกรรมในไฟล์ไม่ถูกต้อง');
 return state;
}
async function backupHash(state){const bytes=new TextEncoder().encode(JSON.stringify(state)),digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
export async function browserBackup(state){const valid=checkedBrowserState(state);return {format:'NEEB20_BROWSER_BACKUP',version:1,createdAt:Date.now(),demo:true,timeZone:'Asia/Bangkok',sha256:await backupHash(valid),state:valid};}
export async function parseBrowserBackup(text){
 if(typeof text!=='string'||text.length>100*1024*1024)browserStorageError('ไฟล์สำรองใหญ่เกิน 100 MB');let raw;try{raw=JSON.parse(text);}catch{browserStorageError('อ่านไฟล์ JSON ไม่ได้ กรุณาเลือกไฟล์สำรองของหนีบ20');}
 if(raw?.format==='NEEB20_BROWSER_BACKUP'){
  if(raw.version!==1||typeof raw.sha256!=='string'||raw.sha256!==await backupHash(raw.state))browserStorageError('ไฟล์สำรองไม่สมบูรณ์ หรือข้อมูลถูกแก้ไข ไม่ได้นำเข้า');return checkedBrowserState(raw.state);
 }
 // Previous full manager JSON exports can be moved from Windows to an unused iPad database.
 if(!raw||typeof raw!=='object'||!Number.isInteger(raw.version))browserStorageError('ไม่ใช่ไฟล์สำรองหนีบ20');return checkedBrowserState(raw);
}
export class BrowserStore {
 constructor(name=BROWSER_DB_NAME){this.name=name;this.opening=null;}
 open(){
  if(!globalThis.indexedDB)return Promise.reject(Error('Safari เปิดฐานข้อมูลไม่ได้ โปรดใช้โหมดปกติ ไม่ใช่แท็บส่วนตัว'));
  if(!this.opening)this.opening=new Promise((resolve,reject)=>{const request=indexedDB.open(this.name,1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('ฐานข้อมูลถูกเปิดค้างในแท็บเก่า กรุณาปิดแท็บหนีบ20 อื่นก่อน'));request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.opening=null;};resolve(request.result);};});
  return this.opening;
 }
 async transaction(operation){
  const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),get=store.get('current');let outcome,error;
   get.onsuccess=()=>{try{let current=get.result;if(!current){current=createDemo();current.fixtureLabel='BROWSER DEMO · ข้อมูลอยู่บนเครื่องนี้เท่านั้น ไม่ใช่ฐานข้อมูลออนไลน์';}else current=checkedBrowserState(current);
    outcome=operation(current);if(outcome.write)store.put(outcome.state,'current');else if(!get.result)store.put(current,'current');
   }catch(e){error=e;tx.abort();}};
   tx.oncomplete=()=>resolve(outcome);tx.onabort=()=>{const failure=error||tx.error;reject(failure?.name==='QuotaExceededError'?Error('พื้นที่จัดเก็บเต็ม บันทึกไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาสำรองไฟล์ อย่าล้างข้อมูล Safari'):failure||Error('บันทึกข้อมูลไม่สำเร็จ ข้อมูลเดิมไม่ได้ถูกล้าง'));};tx.onerror=()=>{error ||= tx.error;};
  });
 }
 async read(){return (await this.transaction(state=>({state,write:false}))).state;}
 async dispatch(command,actorId,now=Date.now()){return this.transaction(state=>({...execute(state,command,actorId,now),write:true}));}
 async restore(imported,expectedRevision,reason){
  const valid=checkedBrowserState(imported);
  return this.transaction(current=>{
   if(current.revision!==expectedRevision)browserStorageError('ข้อมูลเปลี่ยนในแท็บอื่น ตรวจสอบก่อนนำเข้าใหม่','CONFLICT');
   if(current.sessions.length||current.transactions.length||current.commands.length)browserStorageError('เครื่องนี้มีประวัติแล้ว จึงไม่ทับข้อมูลเดิม ให้นำเข้าเฉพาะเบราว์เซอร์ใหม่ที่ยังไม่มีรายการ');
   if(typeof reason!=='string'||!reason.trim())browserStorageError('ต้องระบุเหตุผลการนำเข้า');
   const next=structuredClone(valid),sourceRevision=next.revision;next.revision=Math.max(current.revision,sourceRevision)+1;
   next.audit.push({id:newId(),command_id:'browser-restore-'+newId(),type:'browserRestore',at:Date.now(),employee_id:'browser-import',session_id:null,before:{revision:current.revision,empty:true},after:{sourceRevision},reason:reason.trim()});validateState(next);return {state:next,write:true};
  });
 }
 async close(){if(this.opening){const db=await this.opening;db.close();this.opening=null;}}
}
