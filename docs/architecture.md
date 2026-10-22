# แนวทางระบบจริงและฐานข้อมูล

## เทคโนโลยีที่เสนอ

ต้นแบบปัจจุบันเป็น frontend แบบไม่มี dependency บันทึก localStorage สำหรับทดสอบเท่านั้น แยกกฎธุรกิจใน domain.js เพื่อให้ย้ายไป server ได้ ไม่ควรใช้ localStorage เป็นฐานข้อมูลขายจริง

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
