import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,start,extend,finish,status,total,checkout} from '../src/domain.js';
test('12 stations, persisted deadline, warning and expiry without automatic finish',()=>{
 const state=createDemo();assert.equal(state.stations.length,12);start(state.stations[0],1000,'s1');
 const restored=JSON.parse(JSON.stringify(state));const s=restored.stations[0];
 assert.equal(s.session.endsAt,1501000);assert.equal(status(s.session,1201000),'warning');assert.equal(status(s.session,1501000),'expired');assert.ok(s.session);
 assert.throws(()=>start(s,2000,'s2'));extend(s);assert.equal(s.session.endsAt,1801000);assert.equal(s.session.extensions,1);
 finish(restored,s,1802000);assert.equal(s.session,null);assert.equal(total(restored.cart),25);
});
test('combined bill adjusts demo stock and preserves receipt snapshot',()=>{
 const state=createDemo();start(state.stations[0],0,'s');finish(state,state.stations[0],1);
 state.cart.push({kind:'product',id:'p1',name:'หวีทดสอบ',price:29,quantity:2});
 const receipt=checkout(state,2,'bill');assert.equal(receipt.total,78);assert.equal(receipt.demo,true);assert.equal(state.products[0].stock,18);assert.equal(state.cart.length,0);assert.equal(receipt.lines.length,2);assert.throws(()=>checkout(state));
});
test('insufficient stock rejects bill without partial inventory changes',()=>{
 const state=createDemo();state.cart=[{kind:'product',id:'p1',price:29,quantity:1},{kind:'product',id:'p2',price:79,quantity:11}];
 assert.throws(()=>checkout(state));assert.equal(state.products[0].stock,20);assert.equal(state.receipts.length,0);
});
