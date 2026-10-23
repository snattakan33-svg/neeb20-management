# แนวทางระบบจริงและฐานข้อมูล

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
