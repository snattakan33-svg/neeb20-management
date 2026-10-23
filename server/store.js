import {DatabaseSync} from 'node:sqlite';
import {createDemo,execute,validateState,upgradeState} from '../src/domain.js';
export class DemoStore {
  constructor(path=':memory:'){
    this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS demo_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT OR IGNORE INTO demo_state(id,body) VALUES(1,?)').run(JSON.stringify(createDemo()));
      const raw=JSON.parse(this.db.prepare('SELECT body FROM demo_state WHERE id=1').get().body);
      if(raw.version!==5||raw.costSchema!==1)this.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(upgradeState(raw)));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');this.db.close();throw e;}
  }
  read(){return validateState(JSON.parse(this.db.prepare('SELECT body FROM demo_state WHERE id=1').get().body));}
  dispatch(command,actorId){
    this.db.exec('BEGIN IMMEDIATE');
    try{const outcome=execute(this.read(),command,actorId);if(!outcome.replayed)this.db.prepare('UPDATE demo_state SET body=? WHERE id=1').run(JSON.stringify(outcome.state));this.db.exec('COMMIT');return outcome;}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
