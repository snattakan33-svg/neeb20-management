export const STORAGE_KEY = 'neeb20:demo:v1';
// getRandomValues also works on HTTP LAN origins used for local iPad testing.
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
export function createDemo() {
  return {version:1, stations:Array.from({length:12},(_,i)=>({id:i+1,session:null})),
    products:[{id:'p1',name:'หวีทดสอบ',barcode:'885000000001',cost:15,price:29,stock:20},{id:'p2',name:'เซรั่มทดสอบ',barcode:'885000000002',cost:45,price:79,stock:10}],cart:[],receipts:[]};
}
export function status(session,now=Date.now()) {
  if (!session) return 'idle';
  const left=session.endsAt-now;
  return left<=0?'expired':left<=5*60_000?'warning':'active';
}
export function start(station,now=Date.now(),id=newId()) {
  if (station.session) throw new Error('จุดนี้มีคิวอยู่แล้ว');
  station.session={id,startedAt:now,endsAt:now+25*60_000,extensions:0};
}
export function extend(station) {
  if (!station.session) throw new Error('ยังไม่มีคิว');
  station.session.endsAt+=5*60_000; station.session.extensions++;
}
export function finish(state,station,now=Date.now()) {
  const s=station.session;
  if (!s) throw new Error('ยังไม่มีคิว');
  state.cart.push({kind:'service',id:s.id,name:`หนีบจุด ${station.id}`,quantity:1,price:20+s.extensions*5,startedAt:s.startedAt,endsAt:s.endsAt,finishedAt:now});
  station.session=null;
}
export function total(cart) { return cart.reduce((sum,line)=>sum+line.price*line.quantity,0); }
export function checkout(state,now=Date.now(),id=newId()) {
  if (!state.cart.length) throw new Error('ตะกร้ายังว่าง');
  for (const line of state.cart.filter(l=>l.kind==='product')) {
    const product=state.products.find(p=>p.id===line.id);
    if (!product || !Number.isInteger(line.quantity) || line.quantity<1 || product.stock<line.quantity) throw new Error('สต๊อกทดสอบไม่เพียงพอ');
  }
  for (const line of state.cart.filter(l=>l.kind==='product')) state.products.find(p=>p.id===line.id).stock-=line.quantity;
  const receipt={id,createdAt:now,demo:true,total:total(state.cart),lines:structuredClone(state.cart)};
  state.receipts.push(receipt); state.cart=[]; return receipt;
}
