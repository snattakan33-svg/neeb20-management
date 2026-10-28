# แนวทางระบบจริงและฐานข้อมูล

สถานะปัจจุบันเป็น **Income / Reconciliation v5** ซึ่งคง Flow บิล Session Bill v4 ให้ใช้หัวข้อ v5 และ v4 ท้ายเอกสาร ส่วน Prepaid v3 และหัวข้อเก่าเป็นประวัติการออกแบบ ไม่ใช่ Flow รับเงินปัจจุบัน

## เทคโนโลยีที่เสนอ

ต้นแบบปัจจุบันมี Server Demo (Node built-in SQLite) และ Local Demo (localStorage แยกเครื่อง) ใช้ command handler ชุดเดียวกันใน domain.js ทุกข้อมูลยังเป็นข้อมูลทดสอบ ไม่ควรใช้ฐาน demo หรือ localStorage เป็นฐานขายจริง

| ทางเลือก | ข้อดี | ข้อจำกัด / ความเหมาะสม |
| --- | --- | --- |
| Google Sheets + Apps Script | เริ่มต้นต้นทุนต่ำ พนักงานคุ้นเคย ดูข้อมูล/ส่งออกรายงานง่าย | ไม่ใช่ relational database มี quota/เวลารัน/ความหน่วงและข้อจำกัด concurrent executions ซึ่งขึ้นกับบัญชี ต้องตรวจเอกสาร Google ล่าสุด ไม่มี transaction ครอบหลายชีต ใช้ได้กับ pilot ที่ปริมาณน้อยและยอมรับข้อจำกัด |
| Node API + SQLite | ต้นทุนต่ำ transaction จริง เหมาะร้านเดียวและ backend instance เดียว | ต้องมี server กับ persistent disk สำรองข้อมูล/กู้คืน SQLite จำกัด concurrent writer ไม่ควรแชร์ไฟล์ DB ผ่าน network drive |
| Managed PostgreSQL เช่น Supabase | transaction, constraints, authentication และรองรับหลายเครื่อง/จองออนไลน์ได้ดีกว่า | มี quota และค่าใช้จ่ายตามบริการ ต้องตั้ง RLS/สิทธิ์และ backup ให้ถูกต้อง ห้ามส่ง service-role key ให้ frontend |

แนะนำ **PostgreSQL แบบ managed สำหรับระบบใช้งานจริงที่รวมจองออนไลน์** หากต้องการเริ่มร้านเดียวราคาประหยัดและมีผู้ดูแล server ใช้ Node + SQLite ก่อนก็ได้ แยก API เพื่อเปลี่ยนฐานข้อมูลภายหลัง Google Sheets เหมาะเป็นหน้ารายงานหรือ pilot ช่วงแรก ไม่แนะนำให้เว็บหน้าร้านกับการจองออนไลน์เขียนลงชีตโดยตรง

หากเลือก Apps Script ให้ทุกการเขียนผ่าน backend เดียว ใช้ `LockService.getScriptLock()` ล็อกช่วงอ่าน-ตรวจ-เขียน ตรวจ revision และ idempotency key ทุกคำสั่ง ปล่อย lock ใน finally ห้ามค้าง lock ระหว่างเรียกบริการภายนอก ใช้ append-only journal สำหรับกู้คืนกรณีเขียนหลายชีตสำเร็จไม่ครบ และมีงานกระทบยอด stock/bills การล็อกไม่ป้องกันคนแก้ชีตด้วยมือหรือ writer จากโครงการอื่น และไม่ให้ transaction แบบ SQL การ refresh polling ไม่แก้ปัญหาชนกัน จึงต้องจำกัด writer และทดสอบโหลดตามบัญชีจริงก่อนใช้ ห้ามใช้ public Sheet หรือ URL deployment เป็นกลไกยืนยันตัวตน

## ตารางสำหรับระบบจริง (ยังไม่ได้สร้างฐานข้อมูล)

ทุกตารางธุรกิจควรมี `id`, `created_at`, `updated_at`, `store_id` และแยกฐานข้อมูล/environment demo ออกจาก production อย่างชัดเจน เก็บเงินเป็นจำนวนเต็มหน่วยสตางค์ เวลาเป็น UTC แสดง Asia/Bangkok

| ตาราง | ฟิลด์/กฎสำคัญ |
| --- | --- |
| stations | number unique ต่อร้าน (1–12), enabled, revision |
| service_sessions | station_id, started_at, ends_at, extension_count, base_price_satang, extension_price_satang, status, finished_at, staff_id; unique active session ต่อจุด |
| products | sku, barcode unique เมื่อมีค่า, name, cost_satang, price_satang, active |
| inventory_movements | product_id, quantity_delta, reason, order_id, actor_id; journal รับเข้า/ขาย/คืน/ปรับปรุง |
| orders | number unique, status (draft/paid/void), total_satang, demo, staff_id, idempotency_key unique |
| order_items | order_id, type (product/service), product_id หรือ session_id, quantity, ชื่อ/ทุน/ราคาขณะขาย; session_id unique เพื่อกันคิดซ้ำ |
| payments | order_id, method, amount_satang, status, external_reference unique เมื่อมีค่า; ยังไม่เชื่อมในต้นแบบ |
| employees | display_name, role, active; auth identity อ้างอิง provider ไม่เก็บรหัสผ่าน plaintext |
| commission_rules / commission_entries | employee_id, service/product rule, rate/amount snapshot, order_item_id, status; กำหนดกฎคืนเงินและปัดเศษก่อนพัฒนา |
| booking_resources / bookings | ช่างหรือเตียงสระ, start_at, end_at, customer reference, status, price_satang; สระ100 = 10,000 สตางค์ / 60 นาที; กันช่วงเวลาซ้อนใน transaction |
| audit_events | actor, action, entity, before/after ที่ไม่รวมข้อมูลลับ, timestamp |

ยังต้องกำหนดจำนวนเตียงสระ เวลาทำการ ช่วงพัก การยกเลิก/มัดจำ และกฎค่าคอมมิชชันก่อนทำโมดูลนั้น ห้ามสมมติว่ามีช่างหรือทรัพยากรไม่จำกัด

## API และความถูกต้องเมื่อใช้หลายเครื่อง

วางโมดูล stations, catalog, sales, inventory, bookings, staff, commissions, reports และ hardware adapters แยกกัน API ตัวอย่าง `POST /sessions`, `POST /sessions/:id/extend`, `POST /sessions/:id/finish`, `POST /orders/:id/checkout` รับ idempotency key และ expected revision ให้ server ตรวจสิทธิ์ คำนวณราคา และใช้เวลาจาก server แทน browser

จบคิวและสร้าง service line ต้อง atomic ป้องกันสองเครื่องจบคิวเดียวกัน ชำระบิลและตัด stock ต้อง transaction เดียว พร้อมตรวจ stock แบบ conditional update/row lock ปฏิเสธ revision เก่าและส่งสถานะล่าสุด ห้ามให้ client ส่งยอดรวมแล้วเชื่อทันที มี unique constraints กัน retry ซ้ำ และกระบวนการคืนสินค้า/ยกเลิกผ่านรายการกลับ ไม่ลบประวัติขาย

เริ่มจาก polling แล้วค่อยเพิ่ม realtime events ควรมีสถานะ offline และปฏิเสธการขายจริงเมื่อยืนยันกับ server ไม่ได้ ก่อนรองรับ offline queue ต้องออกแบบการแก้ conflict โดยเฉพาะ stock/booking การจองออนไลน์ต้องมี auth/validation, rate limit, กฎข้อมูลส่วนบุคคลและ retention

## อุปกรณ์หน้าร้าน

เครื่องสแกนที่จำลอง keyboard อาจใช้ช่องค้นหาบาร์โค้ดได้ แต่ต้องทดสอบรุ่น/ภาษาแป้นพิมพ์/การต่อ iPad จริง โค้ดรอบนี้ค้นหาเท่านั้น ยังไม่เพิ่มอัตโนมัติเมื่อยิงบาร์โค้ด เครื่องพิมพ์ควรทดลอง vendor SDK, network bridge หรือเครื่อง Windows เป็น print agent ตามรุ่น Safari ไม่รับประกัน WebUSB/Bluetooth หรือ ESC/POS โดยตรง ลิ้นชักมักสั่งผ่าน printer จึงต้องยืนยันรุ่นและการเชื่อมต่อก่อนจัดซื้อ รอบนี้ยังไม่มีการเชื่อมต่ออุปกรณ์และไม่มีคำสั่งเปิด–ปิดไฟ


## ส่วนบันทึกข้อมูลที่พัฒนาแล้วในรอบ Station safety

- `GET /api/state` อ่าน snapshot; `POST /api/commands` รับ `{actorId, command: {id, type, payload, expectedRevision}}` เก็บ state ใน `.data/demo.sqlite` ไม่ส่งไฟล์ฐานข้อมูลผ่าน HTTP
- `DemoStore.dispatch` ใช้ SQLite `BEGIN IMMEDIATE` อ่าน state ล่าสุด ตรวจ idempotency และ revision ตรวจสิทธิ์/จุดว่าง/ยอดเงิน/stock แล้วเขียน state ใหม่และ COMMIT พร้อมกัน หากล้มเหลว ROLLBACK ทั้งคำสั่ง รองรับหนึ่งไฟล์ฐานท้องถิ่น ไม่ให้วางบน network drive
- คำสั่งเดิม + payload/ผู้ดำเนินการเดิมจะได้ผลเดิม แม้ revision เปลี่ยนแล้ว คำสั่ง ID เดิมแต่เนื้อหาต่างถูกปฏิเสธ คำสั่งใหม่ที่ revision เก่าตอบ 409 หน้าจอบังคับปิดหน้าต่างและตรวจใหม่ ไม่เปลี่ยน revision แล้ว retry เอง
- ตรวจ `expectedStationId` สำหรับคำสั่งคิวที่กำลังใช้เพื่อกันกดจากจุดเก่าหลังย้าย ใช้ Session ID ไม่ค้นหาคิวจากหมายเลขจุดเพียงอย่างเดียว
- บิลสร้างตั้งแต่เริ่ม Session; charges เพิ่มแบบ append; ย้าย/จบ/กู้คืนไม่สร้างบิลหรือ financial transaction; payment/refund เป็นรายการแยกมี ID เฉพาะ และรายงานรวมจากรายการนี้
- `finance.due` คือ charge ที่ยังไม่เคยรับชำระ (`charged - grossPaid`) ไม่เปิดหนี้ใหม่หลัง refund โดยอัตโนมัติ; รายการ refund แยกและไม่แก้ payment เดิม การคืนบางส่วน/เต็มจำนวนยังแสดงยอดคืนและยอดรับเดิมครบ
- คำสั่งยกเลิกตั้งธงยกเลิกบิลและหยุดเรียกเก็บยอดค้าง แต่ไม่แก้ประวัติ charges/payment/refund ผู้จัดการต้องอนุมัติคำขอพร้อมเหตุผล เงินที่รับแล้วต้องคืนด้วยคำสั่งแยก
- UI ล็อกปุ่มระหว่างประมวลผลและเก็บ command เดิมไว้เมื่อผลเครือข่ายไม่แน่นอน การส่งซ้ำจึงไม่เกิดรับเงิน/ต่อเวลาเพิ่มซ้ำ หลัง reload ต้องอ่าน state จาก server ก่อนทำคำสั่งใหม่
- ไม่มี API ลบ history/transactions หรือ reset database ปุ่มสำรองส่งออก state ทั้งหมด พนักงานทดสอบมี ID คงที่ ไม่ใช่ชื่อที่พิมพ์เอง

### ช่องว่างก่อน production (ยังไม่ใช่ระบบรักษาความปลอดภัยจริง)

1. Actor ใน Demo รับจาก client และเลือกบทบาทได้ ต้องแทนด้วย server-side authenticated session, CSRF protection/token ตามรูปแบบ deploy, role assignment ของผู้ดูแลจริง และ manager approval ที่พิสูจน์ตัวตนได้ ห้ามเอา demo role selector ไปใช้จริง
2. แยก schema เป็น sessions/station assignments/bills/charges/transactions/idempotency keys/audit พร้อม foreign keys, unique active station/session, unique financial references และ database constraints ชนิดเงิน/สถานะ โครง JSON หนึ่งแถวใน SQLite เป็นจุดเริ่มทดสอบ atomicity ไม่ใช่ schema production ที่พร้อมขยาย
3. ให้ append-only journal/immutable audit มีสิทธิ์ฐานข้อมูลและการตรวจ tampering, backup/versioned export และ recovery test จริง ผู้ดูแลไฟล์ SQLite ยังแก้ข้อมูลภายนอกแอปได้
4. ทดสอบ clock skew และใช้ server time offset สำหรับ countdown บนหลายเครื่อง เพิ่ม payment provider verification/reconciliation ก่อนเชื่อมเงินจริง และแยก key/database/network สำหรับ production จาก demo โดยเด็ดขาด
5. ตอนนี้มี shared POS cart หนึ่งชุด ถ้าต้องการหลายแคชเชียร์แยกบิล ให้เพิ่ม draft order ownership และ register ID ไม่ใช้ shared cart เดียว
6. ถ้าขยายไปหลาย server instances ใช้ PostgreSQL/transactional normalized schema; ไม่แชร์ไฟล์ SQLite ข้ามเครื่องหรือใช้ Sheets เป็น concurrent transaction engine

## Prepaid v3 (แทนขั้นตอนรับเงินบริการแบบ postpaid เดิม)

### Atomic command และ ledger

- `start` ต้อง `{station_id, method:cash|qr, paymentConfirmed:true}`; ตรวจจุดว่างแล้วสร้าง Session+บิล+base charge+payment 2,000 สตางค์+receipt+Audit พร้อมจับเวลาที่ `now` ใน SQLite transaction เดียว ไม่เก็บ draft Session ก่อนรับเงิน การกดยกเลิก modal ก่อนยืนยันไม่มีค่าใช้จ่ายหรือ entity ที่ต้องย้อนเงิน
- `extend` ต้องยืนยันรับ 500 สตางค์ สร้าง charge/payment ประเภท extension เพิ่ม deadline เดิม 300,000ms โดยไม่สร้าง Session/บิลใหม่
- `finish` ปล่อย Station และปิดช่วงใช้งานเท่านั้น คิว prepaid ไม่มีหนี้เข้า POS/ไม่มี payment ใหม่ `restore` ใช้ Session/บิล/deadline เดิมและเริ่มช่วงใช้จริงใหม่เมื่อพนักงานยืนยัน
- Session เก็บ `usageIntervals` แยกจากเวลาจับเวลาหลังจ่าย พนักงาน `markUsed` บันทึกการเริ่มใช้จริง การยกเลิก `unused:true` ถูกปฏิเสธถ้ามีช่วงใช้จริงแล้ว ยังต้องให้ผู้จัดการตรวจข้อเท็จจริง ไม่สามารถพิสูจน์การใช้จาก browser โดยลำพัง
- ผู้จัดการ `approveCancel` ระบุ unused, refundAmountSatang, reason; หาก unused ต้องคืนเต็มยอดรับสุทธิ การยกเลิก+refund อยู่ใน transaction เดียว ไม่มี intermediate state ที่ยกเลิกแล้วลืมคืนเงิน หากใช้แล้วคืน 0..net ตามนโยบายที่ผู้จัดการระบุ
- `refundSession` ผูกกับ original payment IDs แยกเป็นหลาย refund ถ้าครอบหลายรายการ เช่นคืน base+extension; ไม่แก้/ลบ payment เดิม method ใน refund คือช่องทางจ่ายคืนจริงที่พนักงานระบุ ไม่จำเป็นต้องเป็นช่องทางรับเดิม
- ธุรกรรมเงินใหม่ทุกตัวมี id, type, category (`base/extension/product/legacy`), amountSatang, method (`cash/qr`), session/bill/receipt/original transaction reference, command, เวลา/พนักงาน และ demo:true

### สินค้าและสต๊อก

SKU case-insensitive unique, barcode unique เมื่อมีค่า, category, active, cost/price snapshot; add/edit/toggle/adjust/return ต้อง manager; receiveStock ให้ staff ได้ ตะกร้าไม่จอง stock และเป็น shared cart เดียว ต้องตรวจ active/ราคา/stock อีกครั้งที่ checkout หากราคาเปลี่ยนต้องนำออกแล้วเพิ่มใหม่

`checkout` product payment เก็บ product_id, quantity, unitPriceSatang, unitCostSatang; ตัด stock และสร้าง movement ที่ผูก transaction ใน commit เดียว `returnProduct` อ้าง original product payment จำกัดจำนวนขาย-คืนแล้ว คืนราคาต่อชิ้นเดิม เลือก restock ได้ และบันทึก refund/movement/audit พร้อมกัน กรณีของเสียเลือกไม่ restock ได้ ไม่มีการลบ sale เดิม

### Reports และเวลา

`GET /api/reports?mode=daily&day=YYYY-MM-DD`, `mode=monthly&month=YYYY-MM`, หรือ `mode=range&from=...&to=...` เรียก makeReport จาก snapshot ฝั่ง server โดยตรง `GET /api/state`/ผล command มี serverNow สำหรับ client clock offset

ขอบเขตวันใช้ Asia/Bangkok (UTC+7) รวมวันสิ้นสุด จัดกลุ่มรายรับจาก payment ตามหมวด, refunds ตามวันที่คืน, cash/qr แยกรับ/คืน/สุทธิ ไม่ใช้การจบคิวสร้างรายได้ Refund ที่คืนข้ามวันทำให้สุทธิวันคืนติดลบได้ ไม่ควรย้อนแก้รายรับวันเดิม

รายงาน Session ใช้ cohort ที่ startedAt อยู่ในช่วงวัน ให้จำนวนจบ/ยกเลิกภายใน cohort และ terminal events ในช่วงวันแยกกัน เส้นทาง Station รวม move/restore แต่จำนวน move นับเฉพาะคำสั่ง move ระยะใช้จริงรวม usageIntervals ไม่รวมช่วงปิดคิวผิด-รอกู้คืน ถ้าไม่ยืนยันหรือเป็นข้อมูลเก่ารายงานไม่ทราบ ไม่อนุมานว่าใช้ครบ 25 นาที

### Upgrade และข้อจำกัดที่ยังเหลือ

SQLite v2 → v3 อัปเกรดใน BEGIN IMMEDIATE เก็บ state เดิมครบใน schemaArchives ไม่แก้ transactions/receipts/audit เดิม ช่องทาง/หมวดของธุรกรรมเก่าที่ไม่บันทึกไว้ใช้ unknown/legacy ไม่สร้างเงินใหม่ ข้อมูลสินค้ายกมาเป็น opening movement และ active Sessions เดิมเป็น legacyPostpaid deadline ไม่เปลี่ยน รับยอดค้างเก่าแยกจาก prepaid ใหม่

UI เก็บ command ค้างใน sessionStorage ก่อนส่ง หาก response หายให้ retry ID/payload/actor เดิม หลัง refresh ถ้าพบ ID ใน server state แล้วจะไม่ส่งเงินใหม่ ถ้ายังไม่พบจะแสดงให้ยืนยันส่งคำสั่งเดิม ถ้า revision เปลี่ยนต้องตรวจใหม่ ไม่ silently rebase คำสั่งรับเงินจริง การเขียนเงิน/stock ของ Server Demo อยู่ SQLite เสมอ ไม่ใช้ client state เป็นหลักฐาน

ยังเป็น DEMO: manual confirmation ไม่ใช่ bank verification; บทบาทเลือกได้ไม่ใช่ authenticated identity; state JSON/WAL เป็นฐานทดลองไม่ใช่ normalized production schema; ต้องทำ HTTPS/auth/manager re-auth, provider reconciliation หากเชื่อม QR จริง, audit tamper protection, backup+restore test, rate limits/retention/pagination และแยก production environment ก่อนใช้เงินจริง Local HTML เป็น UI sandbox เท่านั้น ไม่ใช่แหล่งรายได้/stock ถาวรของร้าน

## Session Bill v4 — Flow ปัจจุบัน (แทน Prepaid v3)

### Invariants

หนึ่ง Session มีบิลหลักเพียงหนึ่งบิล ตรวจ uniqueness ใน validateState; Station assignment ชี้ Session ไม่ชี้รายได้ เริ่มเวลา/ต่อเวลา/สินค้า/ย้าย/จบไม่สร้าง payment ยอดรับเกิดเมื่อ payBill ตรวจและ settle ทุก charge เท่านั้น บิล PAID/REFUNDED immutable สำหรับรายการใหม่ ไม่เปิดเพิ่มรายการหรือรับเงินเต็มซ้ำ

`start`: 25 นาที + base charge 2,000 สตางค์ + UNPAID ไม่มี receipt/payment; `extend`: +300,000ms และ extension charge 500 สตางค์ในบิลเดิม; `addBillProduct`: quantity/price/cost/name snapshot จาก catalog; `removeBillProduct`: ทำ void charge พร้อมเหตุผล ไม่ลบประวัติ

`payBill`: ต้อง method/confirmation, expectedRevision และ expectedStationId (เมื่อ Session active) ตรวจ cancelled/pending approval/เคยรับเงินแล้ว รวมจำนวนสินค้าเดียวกันทุกบรรทัด ตรวจ stock/active จาก DB ล่าสุด แล้วบันทึก receipt เดียว, Payment ID กลุ่ม, ledger line Transaction IDs ที่แบ่งหมวด base/extension/product, stock movements, paidAt/paidBy/method/status และ audit ใน transaction เดียว ไม่สร้าง transaction รวมซ้อนกับยอด ledger ย่อย

Stock ไม่มี reservation ระหว่างเปิดบิล เลือกตรวจ/ตัดตอนจ่ายตามข้อกำหนด สองบิลอาจเลือกรายการเดียวกัน แต่ผู้จ่ายทีหลังหากของหมดจะไม่ได้รับเงินบางส่วน ต้องแก้รายการหรือยกเลิกก่อนปล่อย Station การ cancelUnpaid จึงไม่เปลี่ยน inventory ไม่สร้าง stock movement ปลอม

`finish`: server ปฏิเสธ PAYMENT_REQUIRED ถ้าไม่มีเงินรับ/ยังมีหนี้ ไม่ปล่อยจุด UI แสดงคำเตือนไปคิดเงิน `cancelUnpaid`: staff ทำพร้อมเหตุผล ยกเลิกบิล/Session โดยเก็บ charges/audit; paid cancel/refund ยังต้อง manager ไม่ลบรายการเดิม `restore` ใช้ deadline/bill เดิม ไม่มี payment ใหม่

### Reporting และ historical receipts

Bill.status เก็บและคำนวณสอดคล้องกับ finance เป็น UNPAID/PAID/CANCELLED/REFUNDED รายได้รวมเฉพาะ financial ledger ที่เกิดการ settlement สำเร็จ ไม่รวม charges ค้างชำระ เมื่อ refund หรือ VOID บิลที่เคย PAID ไม่ลบยอดรับเก่า รายงานคง payment แล้วหัก refund ตามวันคืน วิธีนี้ป้องกันยอดหายหรือหักซ้ำเมื่อบิลปัจจุบัน REFUNDED/CANCELLED

รายงานบิลส่ง Bill/Session/Station/เวลาใช้/บริการ/สินค้า/ยอดแยก/ยอดรวม/cash/QR/paidAt/paidBy/payment+transaction references และสถานะครบ บิลในรายงานเลือกเปิด/จ่าย/มีธุรกรรมในช่วงวันที่ แสดงสถานะปัจจุบันและยอดสะสมบิล ส่วนรายงานรายรับเลือกเวลา transaction โดยตรง สองมุมมองอาจมีคนละจำนวนคิวตามวันเริ่มและวันจ่าย

v2/v3 → v4 เก็บต้นฉบับใน schemaArchives โดยไม่ rewrite transactions/receipts/audit เก่า บิล Prepaid PAID ไม่เปิดหนี้ 20 บาทซ้ำ Local keys เก่าคงไว้ หากมีคำสั่งค้างของรุ่นเก่า ต้องตรวจและจบก่อนอัปเดต ไม่ตีความคำสั่ง Prepaid เก่าเป็นการรับเงินใหม่ตาม Flow ใหม่

### ข้อจำกัดที่ยังอยู่

Demo roles ยังไม่ใช่ authenticated identities, SQLite state JSON ยังเป็นโครงทดลอง, ไม่มี bank verification, ไม่มี production publish/HTTPS หรืออุปกรณ์จริง การคืนเงินทั้งบิลไม่ restock เอง แต่จำกัด refund ต้นทางทั้งจำนวน/เงินไม่ให้คืนสินค้าเพื่อคืนเงินซ้ำ หากสินค้ากลับมาหลัง refund ให้ผู้จัดการปรับ stock พร้อมเหตุผล รุ่นนี้ยังไม่มี workflow แก้บิล PAID เพื่อเพิ่มรายการ/เรียกเก็บเพิ่ม

## Income / Reconciliation v5 — ปัจจุบัน (คง Session Bill v4)

เพิ่ม shifts.js เป็น pure command/report layer แยกจาก Station commands เดิม domain.execute ใช้ revision/idempotency/actor boundary เดียวกัน แล้ว assignNewTransactions ผูก ledger ใหม่เข้ากะ OPEN ก่อน commit SQLite เดียวกัน ถ้ากะต้องมีแต่ไม่เปิดหรือ cash ไม่พอคืนเงิน จะ rollback รายการเงิน/stock/บิลด้วย error เชิงธุรกิจ ไม่ทำ partial commit

One shared drawer: หนึ่ง OPEN shift ต่อเวลา Submit ปิด period และตรึง transaction_ids/cashMovements; กะถัดไปเปิดได้ก่อน approve กะเก่า แต่ assignment ไม่ย้ายข้ามกะ Approval เก็บ approvedSnapshot และ manager/time; correction ต่อท้ายเฉพาะยอดนับ/ยอดตรวจ QR/ยอดส่ง ไม่แก้ revenue หรือ snapshot เดิม การอนุมัติผลต่างพร้อมเหตุผลไม่เปลี่ยนสถานะตรวจเงินให้เป็น MATCH

สูตร expectedCash = float + cashPayments − cashRefunds + drawerIn − drawerOut; expectedHandover = expectedCash − retainedFloat; countDifference และ handoverDifference แยกกัน ไม่บวก short ซ้ำ QR verified net signed เพื่อรองรับ refund-only shift ผลต่างทิศตรงข้ามเป็น PENDING แม้ net difference =0

Report API เพิ่ม weekly ISO, all-history, employee_id, charts day/week/month, paidBillCount, current unpaid, employee aggregates, shift summaries, unassigned ledger และ anomaly review ป้าย wash100 ใช้ transaction category จริงเท่านั้น ไม่สร้างรายได้จากโมดูลที่ยังไม่มี Daily transactions และ shift periods เลือกต่างมุมมอง จึงไม่ควรบวกเป็นยอดขายซ้ำ

QR original transaction มี staff_confirmation และ UNVERIFIED bank flag; manual bank reconciliation/approval อยู่ใน shift.bankVerification ไม่อัปเดตให้เสมือนธนาคารรับรอง เก็บหลักฐานอ้างอิงที่พนักงานพิมพ์ ไม่เก็บ OTP/password

v4 → v5 archive เดิมและสร้าง arrays shifts/shiftControl โดยไม่เดาย้อน assignment เงินเก่าเป็น unassigned; historical shift ต้อง manager ระบุช่วง/ยอดตามหลักฐาน ไม่ซ้อนและไม่มี ID ซ้ำ Unknown-method history ยังคง pending ไม่อนุมัติโดยเดาช่องทาง

ข้อมูลตัวอย่างสร้างจาก execute commands ใน demo-scenarios.js ไปฐาน reconciliation-sample.sqlite โดย reserve ไฟล์ด้วย wx ปฏิเสธเขียนทับ แยกจาก demo.sqlite ไม่มี sample injected ระหว่าง startup ปกติ ยังคงข้อจำกัด Demo identity, JSON SQLite schema, หนึ่งลิ้นชัก และไม่มี bank automation/อุปกรณ์จริง

## v0.6.0: cost snapshots and gross profit

Additive `costSchema:1` retains schema 5 and every existing financial/audit record. Product payment lines capture sale-time unitCostSatang. Service charges capture service-time estimated components. `catalogHistory` is append-only price/cost history. `costAdjustments` is an append-only journal for incurred service cost and actual commission; latest values replace estimates, with included commission deducted once before actual commission is added. Reports on prior sale periods can be restated using this latest knowledge, never by rewriting financial transactions. Unknown legacy costs yield incomplete/null profits. Product restock refunds reverse original COGS; money-only refunds retain incurred costs. Explicit actual costs on never-paid cancelled services are losses on recording date. Operating expenses have a separate future namespace and never affect gross profit.

Demo staff API views recursively strip cost/commission snapshots, archives, command fingerprints and cost history. Profit reads and cost writes require manager. Client-selected Demo identity remains untrusted authentication: production needs server-established authenticated sessions and verified permissions. Local file data cannot be confidential. See `docs/costs-and-profit.md` for Thai policies and test procedure.

## v0.7.0: SKU management, stock counts and receipt lots

Additive `inventorySchema:1` fills unit/minimum/image/skuAliases and initializes inventoryLots plus stockCounts. Existing money, bill and stock movement history is untouched. Opening lot valuation explicitly uses the catalog value at migration and has unknown original receipt date. Incoming batches capture unitCostSatang and reference; all outgoing movements carry lot allocations and total remaining lots must equal product.stock. The existing standard catalog cost-at-sale policy for profit remains unchanged; receipt-lot valuation and current catalog valuation are separate report fields, not FIFO COGS.

SKU changes retain immutable product IDs, reserve normalized historical aliases and require manager confirmation/reason for used products. New payments/receipts snapshot SKU/name/unit. No permanent product deletion command succeeds. Stock changes are manager-only movements; staff submits a pending count. Approval checks both stock and last product movement ID to prevent even equal-net changes from overwriting activity. Same SQLite command transaction handles stock, lots, audit, revision and idempotency. Reports join by immutable product ID across renames. Photos are bounded raster data URLs (or HTTPS links) stored in the state snapshot; API request cap is 256 KB. Staff API redaction also removes lot cost. Demo identity remains non-authenticated; production auth is still required.

## v0.8.0: free single-device browser deployment

`render.yaml` defines a Static Site only, with no server instance or disk/database. `build-static.js` reuses the tested standalone bundle, extracts hashed external JS/CSS and adds an install manifest plus an app-shell-only service worker. Explicit `NEEB20_BROWSER_ONLY` selects BrowserStore; no automatic fallback is allowed from a server error to a new browser database. Desktop SQLite and file Local Demo behavior remain unchanged.

BrowserStore uses one IndexedDB readwrite transaction for read/revision validation/domain command/journal/write. Cross-tab transactions serialize without relying on Web Locks. Full state is preserved on failures, including quota errors. Backups have a full manager snapshot, checksum and timestamp; restore accepts old full JSON but rejects cost-redacted or invalid files. Restore is allowed only on an unused dataset, with a revision check and an appended import audit, never overwriting live history. This is not multi-device sync or authentication. Browser eviction, private browsing, device loss and clearing storage remain risks; external backup is mandatory. Offline shells do not cache business records or API calls. Updates wait for old clients to close. See the Thai iPad guide for free-host setup, actual device testing and limitations.
