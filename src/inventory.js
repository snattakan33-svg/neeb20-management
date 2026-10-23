// Additive inventory metadata. Existing sale-time catalog cost policy remains unchanged.
export function inventoryError(message,code='INVALID'){const e=new Error(message);e.code=code;throw e;}
export const normalizedSKU=value=>String(value).normalize('NFKC').trim().toLowerCase();
export function ensureInventoryState(state){
 state.inventoryLots ||= [];state.stockCounts ||= [];
 for(const p of state.products){p.unit??='ชิ้น';p.minimumStock??=3;p.image??='';p.skuAliases ||= [];
  if(!state.inventoryLots.some(l=>l.product_id===p.id)&&p.stock>0)state.inventoryLots.push({id:'inventory-opening-'+p.id,product_id:p.id,quantity:p.stock,remaining:p.stock,unitCostSatang:Math.round(p.cost*100),at:0,employee_id:'system-migration',kind:'opening-valuation',reason:'ยอดเปิดระบบล็อต ประเมินด้วยต้นทุน catalog ไม่ใช่หลักฐานรับเข้าเก่า',command_id:'inventory-opening',movement_id:null});
 }state.inventorySchema=1;return state;
}
export function productAvailability(p){return !p.active?'inactive':p.stock===0?'out':p.stock<=p.minimumStock?'low':'ready';}
export function validProductMetadata(payload,product){
 const unit=payload.unit??product?.unit??'ชิ้น',minimumStock=payload.minimumStock??product?.minimumStock??3,image=payload.image??product?.image??'';
 if(typeof unit!=='string'||!unit.trim()||unit.length>40||!Number.isSafeInteger(minimumStock)||minimumStock<0||minimumStock>1000000||typeof image!=='string'||image.length>180000)inventoryError('หน่วยนับ สต๊อกขั้นต่ำ หรือรูปภาพไม่ถูกต้อง');
 if(image&&!/^https:\/\/[^\s]+$/i.test(image)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))inventoryError('รูปภาพต้องเป็น HTTPS หรือไฟล์ PNG/JPEG/WebP');
 return {unit:unit.trim(),minimumStock,image};
}
export function inventoryMovement(state,product,movement,options={}){
 if(movement.quantityDelta>0){
  const unitCostSatang=options.unitCostSatang??Math.round(product.cost*100);
  if(!Number.isSafeInteger(unitCostSatang)||unitCostSatang<0||unitCostSatang>100000000)inventoryError('ต้นทุนล็อตไม่ถูกต้อง');
  const lot={id:movement.id+'-lot',product_id:product.id,quantity:movement.quantityDelta,remaining:movement.quantityDelta,unitCostSatang,at:movement.at,employee_id:movement.employee_id,kind:movement.kind,reason:movement.reason,command_id:movement.command_id,movement_id:movement.id,reference:options.lotReference||''};
  state.inventoryLots.push(lot);movement.lot_id=lot.id;
 }else{
  let remaining=-movement.quantityDelta;movement.lotAllocations=[];
  for(const lot of state.inventoryLots.filter(l=>l.product_id===product.id&&l.remaining>0)){
   const quantity=Math.min(lot.remaining,remaining);lot.remaining-=quantity;remaining-=quantity;movement.lotAllocations.push({lot_id:lot.id,quantity});if(!remaining)break;
  }if(remaining)inventoryError('ยอดล็อตไม่ตรงกับสต๊อก ต้องตรวจสอบก่อนทำรายการ','CONFLICT');
 }
}
export function applyInventoryCommand(state,command,actor,now,{newId,log,moveStock}){
 const p=command.payload||{},manager=()=>{if(actor.role!=='manager')inventoryError('ต้องให้ผู้จัดการอนุมัติ','FORBIDDEN');};
 if(!['submitStockCount','approveStockCount','rejectStockCount','deleteProduct'].includes(command.type))return false;
 const reason=()=>{if(typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>500)inventoryError('ต้องระบุเหตุผล 1–500 ตัวอักษร');return p.reason.trim();};
 if(command.type==='submitStockCount'){
  const product=state.products.find(x=>x.id===p.product_id);if(!product||!Number.isSafeInteger(p.counted)||p.counted<0||p.counted>1000000)inventoryError('ผลตรวจนับไม่ถูกต้อง');
  if(state.stockCounts.some(c=>c.product_id===product.id&&c.status==='PENDING'))inventoryError('มีผลตรวจนับรออนุมัติแล้ว','CONFLICT');
  const count={id:newId(),product_id:product.id,sku:product.sku,systemStock:product.stock,counted:p.counted,status:'PENDING',at:now,employee_id:actor.id,lastMovementId:state.stockMovements.filter(m=>m.product_id===product.id).at(-1)?.id||null,reason:reason(),command_id:command.id};state.stockCounts.push(count);log('submitStockCount',null,null,count,count.reason);
 }else if(command.type==='deleteProduct'){
  manager();const product=state.products.find(x=>x.id===p.product_id);if(!product)inventoryError('ไม่พบสินค้า');
  // Products are always retained. This protects references in unpaid bills, stock and price history too.
  inventoryError('ไม่ลบสินค้าแบบถาวร กรุณาปิดขายเพื่อเก็บประวัติ','FORBIDDEN');
 }else{
  manager();const count=state.stockCounts.find(c=>c.id===p.count_id&&c.status==='PENDING');if(!count)inventoryError('ผลตรวจนับถูกจัดการแล้วหรือไม่พบ','CONFLICT');const before=structuredClone(count),note=reason();
  if(command.type==='approveStockCount'){
   const product=state.products.find(x=>x.id===count.product_id);if(product.stock!==count.systemStock||(state.stockMovements.filter(m=>m.product_id===product.id).at(-1)?.id||null)!==count.lastMovementId)inventoryError('สต๊อกเปลี่ยนหลังตรวจนับ ต้องปฏิเสธและตรวจนับใหม่','CONFLICT');
   if(count.counted!==product.stock)moveStock(product,count.counted-product.stock,'stockCount',note);
   count.status='APPROVED';
  }else count.status='REJECTED';
  count.reviewedAt=now;count.reviewedBy=actor.id;count.reviewReason=note;log(command.type,null,before,count,note);
 }return true;
}
export function validateInventory(state){
 if(state.inventorySchema!==1)return;
 const keys=new Set();for(const p of state.products){if(!Number.isSafeInteger(p.stock)||p.stock<0)inventoryError('สต๊อกไม่ถูกต้อง');for(const sku of new Set([p.sku,...p.skuAliases].map(normalizedSKU))){if(keys.has(sku))inventoryError('SKU หรือรหัสเก่าซ้ำ');keys.add(sku);}if(state.inventoryLots.filter(l=>l.product_id===p.id).reduce((n,l)=>n+l.remaining,0)!==p.stock)inventoryError('ยอดล็อตและสต๊อกไม่ตรงกัน');}
 for(const lot of state.inventoryLots)if(!Number.isSafeInteger(lot.remaining)||lot.remaining<0||lot.remaining>lot.quantity||(lot.unitCostSatang!==undefined&&(!Number.isSafeInteger(lot.unitCostSatang)||lot.unitCostSatang<0)))inventoryError('ข้อมูลล็อตไม่ถูกต้อง');
}
