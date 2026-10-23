import {createDemo,execute} from './domain.js';
// Explicit, isolated test costs; no claim about the store's real costs or receipts.
export function createProfitScenario(now=Date.now()){
 let state=createDemo(),sequence=0;const run=(type,payload,actor='staff-01')=>{state=execute(state,{id:'profit-sample-'+(++sequence),type,payload,expectedRevision:state.revision},actor,now).state;};
 const cost={materialsSatang:100,electricitySatang:100,waterSatang:0,laborSatang:500,otherSatang:0,commissionIncludedSatang:300};
 for(const [id,price] of [['base',2000],['extension',500],['wash100',10000]])run('editService',{service_id:id,priceSatang:price,cost:id==='extension'?{...cost,materialsSatang:0,laborSatang:0,commissionIncludedSatang:0}:cost},'manager-01');
 run('start',{station_id:1});const s=state.sessions[0],base={session_id:s.session_id,expectedStationId:1};run('extend',base);run('addBillProduct',{...base,product_id:'p1',quantity:1});run('payBill',{...base,method:'cash',paymentConfirmed:true});run('recordServiceCost',{bill_id:s.bill_id,charge_id:state.bills[0].charges[0].id,actualCost:null,actualCommissionSatang:400,reason:'ค่าคอมจริงตัวอย่างทดสอบ'},'manager-01');run('finish',base);
 state.fixtureLabel='ข้อมูลทดสอบกำไรเท่านั้น: รายได้ 54 บาท ต้นทุน 24 บาท กำไรขั้นต้น 30 บาท';return state;
}
