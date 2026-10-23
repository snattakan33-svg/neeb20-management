import {mkdir,open,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DemoStore} from '../server/store.js';
import {createReconciliationScenario} from '../src/demo-scenarios.js';
const directory=new URL('../.data/',import.meta.url),path=fileURLToPath(new URL('reconciliation-sample.sqlite',directory));
await mkdir(directory,{recursive:true});
let reserved;
try{reserved=await open(path,'wx');}catch(e){if(e.code==='EEXIST'){console.error('Sample database already exists. Kept unchanged:',path);process.exit(1);}throw e;}
await reserved.close();let store;
try{const sample=createReconciliationScenario();store=new DemoStore(path);store.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(sample));console.log('Created DEMO ONLY sample database:',path);console.log('Use NEEB20_DEMO_DB with this path and PORT=3001. Never replace the main demo.sqlite.');}
catch(e){if(store)store.close();store=null;await unlink(path);throw e;}finally{store?.close();}
