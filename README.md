# Uthai Smash Club

เว็บจัดการชมรมแบดมินตันอุทัยธานี ครอบคลุมบอร์ดทีวี ผู้เล่น และผู้ดูแลระบบ ใช้ Frontend แบบ HTML/CSS/JavaScript และ Backend Node.js + WebSocket

> สถานะปัจจุบัน: ระบบ Full-stack สำหรับรันบนเครื่องหรือเซิร์ฟเวอร์ ข้อมูลถูกบันทึกที่ Backend และทุกหน้าจออัปเดตแบบ Real-time

## หน้าหลัก

| หน้า | Path | หน้าที่ |
| --- | --- | --- |
| บอร์ดสนาม | `board/index.html` | จอทีวีแบบอ่านอย่างเดียว แสดง 4 สนาม คิวรอ 10/20 คิว และคนว่างไม่มีคิว |
| สำหรับผู้เล่น | `player/index.html` | เลือกชื่อ เช็คอิน ลงคิว ดูยอด แนบหลักฐาน เช็คเอาท์ และช่วยบริหารสนาม |
| ผู้ดูแล | `admin/index.html` | Dashboard, คิวสนาม, CRUD เบิกลูก/ซื้อของ, รับชำระ, สมาชิก และ Master Data |

PIN เริ่มต้นสำหรับหน้า Admin คือ `8888`

## ความต้องการ

- Node.js 20 ขึ้นไป
- pnpm หรือ npm

## ติดตั้งและเปิดใช้งาน

```bash
pnpm install
pnpm dev
```

Server เริ่มต้นที่ `http://127.0.0.1:8080` แล้วเปิด:

- `http://localhost:8080/board/index.html`
- `http://localhost:8080/player/index.html`
- `http://localhost:8080/admin/index.html`

ใช้ `pnpm start` เมื่อต้องการรันโดยไม่เปิด Watch Mode

การเปิด `index.html` แบบ `file://` ใช้ดูหน้าเว็บแบบออฟไลน์ได้ แต่จะไม่มี WebSocket และข้อมูลจะไม่บันทึก การใช้งานปกติต้องเปิดผ่าน Node Server

## ความสามารถสำคัญ

- บอร์ดทีวี Responsive/Adaptive แสดงคิวแบบ 2 คอลัมน์ × 5 แถวเมื่อมีไม่เกิน 10 คิว และ 2 คอลัมน์ × 10 แถวเมื่อมี 20 คิว
- ผู้เล่นค้นหาและเลือกตัวเองจาก Master ก่อนใช้งาน สมาชิกใหม่ต้องให้ Admin เพิ่มชื่อ
- เบอร์โทรสมาชิกเป็นข้อมูลไม่บังคับ
- เช็คอินตัวเองหรือเพื่อน และรวมผู้เล่นว่าง 4 คนลงคิว
- ทุกคนช่วยจัดคิวลงสนาม คืนทีมกลับไปรอคิว จบเกม และเช็คเอาท์คนกลับบ้านได้
- สมาชิกชมรมใช้สิทธิ์รายปี บุคคลภายนอกคิดค่าเข้าเริ่มต้น `20 บาท/วัน`
- ผู้มียอดค้างถูกระงับการเช็คอิน ลงคิว และเบิกลูกจนกว่าจะรับชำระ
- ตาราง CRUD เบิกลูกและซื้อของ มีตัวกรองวันที่ ค้นหา เรียง แก้ไข และลบย้อนหลัง
- เบิกลูกเลือกชื่อซ้ำใน 4 ช่องได้ กรณีคนหนึ่งออกค่าใช้จ่ายหรือเลี้ยงอีกคน
- ลูกแบดรองรับหลายยี่ห้อ รุ่น และราคา
- สินค้ารองรับน้ำและอุปกรณ์ โดยรวมยอดเข้าค่ารายวันของผู้ซื้อ
- Dashboard ดูรายรับรายวัน รายเดือน และรายปี
- ดาวน์โหลดรูปสรุปยอดค้างเพื่อส่งทวงใน Line เดิมได้
- ค่าระบบเลือกได้ระหว่างคิดต่อลูกหรือเหมาจ่ายรายเดือน
- Board, Player และ Admin ใช้ข้อมูลกลางชุดเดียวกันผ่าน WebSocket
- Backend บันทึกข้อมูลอัตโนมัติลง `data/state.json`

รายละเอียดกติกาและลำดับงานอยู่ใน [BUSINESS-FLOW.md](./BUSINESS-FLOW.md)

## โครงสร้าง repo

```text
bat-uthai/
├── index.html                 # หน้าเริ่มต้นและเมนูหลัก
├── app.js                     # Business logic, fallback data และ UI actions
├── styles.css                 # Layout และ responsive styles
├── package.json               # คำสั่งรันและ dependency
├── pnpm-lock.yaml             # ล็อกเวอร์ชัน dependency
├── server/server.mjs          # HTTP API, Static Server, WebSocket และ persistence
├── server/state-store.mjs     # โหลด Seed, รัน Migration และเขียน State แบบ atomic
├── tests/realtime.test.mjs    # ทดสอบ Backend และการ Broadcast
├── data/seed.json             # Master Data เริ่มต้นที่ commit ไปกับระบบ
├── data/state.json            # ข้อมูลใช้งานจริง สร้างตอนรันและไม่ commit
├── board/index.html           # Route บอร์ดทีวี
├── player/index.html          # Route ผู้เล่น
├── admin/index.html           # Routeผู้ดูแล
├── BUSINESS-FLOW.md           # กติกาธุรกิจและ flow ส่งต่อทีมพัฒนา
└── output/
    ├── presentation/          # PowerPoint เสนอขาย
    ├── pdf/                   # PDF เสนอขาย
    └── testing/               # Excel รายการและผลทดสอบระบบ
```

## Backend และ Real-time

- `GET /api/health` ตรวจสถานะ Server, จำนวน Client และ revision ล่าสุด
- `GET /api/state` อ่าน Snapshot ปัจจุบัน
- `WS /ws` รับและ Broadcast Snapshot ไปทุกหน้าจอ
- เมื่อเปิดระบบครั้งแรก Backend สร้าง `data/state.json` จาก `data/seed.json`
- Seed เก็บเฉพาะ Master Data ที่จำเป็น ได้แก่ ระดับมือ 4 สนาม รุ่นลูกแบด สินค้า และค่าบริการ โดยไม่สร้างสมาชิกหรือรายการการเงินปลอม
- `server/state-store.mjs` รัน Migration อัตโนมัติตาม `schemaVersion` ก่อนเปิด Server ปัจจุบันเป็นเวอร์ชัน `1`
- ทุกการเปลี่ยนคิว สนาม สมาชิก เบิกลูก ซื้อของ หรือรับชำระ จะบันทึกลง `data/state.json`
- การเขียนไฟล์ใช้ไฟล์ชั่วคราวแล้ว Rename เพื่อลดความเสี่ยงไฟล์เสียกลางทาง

หากต้องการเริ่มข้อมูลใหม่ ให้หยุด Server สำรอง `data/state.json` ไว้ก่อน แล้วค่อยลบไฟล์ดังกล่าว เมื่อเปิด Server อีกครั้งระบบจะสร้างข้อมูลจาก Seed

### ความปลอดภัยของข้อมูลใน Git

- `data/seed.json` commit ได้ เพราะเก็บเฉพาะ Master Data เริ่มต้นและไม่มีสมาชิกหรือธุรกรรม
- `data/state.json` และไฟล์ชั่วคราวถูกระบุใน `.gitignore` แล้ว เพราะอาจมีชื่อสมาชิก ยอดเงิน และหลักฐานการใช้งานจริง
- ห้ามใช้ `git add -f data/state.json` และไม่ควรนำไฟล์ State จริงไปใส่ใน Issue, Pull Request หรือไฟล์นำเสนอ
- ก่อนอัปเดตระบบบน Server ให้สำรอง `data/state.json` ไว้นอก repo เสมอ

## ตรวจสอบ

```bash
pnpm check
```

คำสั่งนี้ตรวจ Syntax ของ Frontend และทดสอบ Seed, Migration, HTTP, WebSocket, การ Broadcast, Persistence และสมาชิกที่ไม่มีเบอร์โทร

ผลทดสอบระบบแบบ Manual + Automated ล่าสุดอยู่ที่ `output/testing/uthai-smash-system-test-cases.xlsx` ภายในไฟล์มี Summary, รายการทดสอบ 45 เคส, ผลจริง และช่องว่างที่ยังต้องทดสอบต่อ

## นำขึ้น Server

ระบบต้องรันบน Hosting ที่รองรับ Node.js และ WebSocket ไม่สามารถใช้ Static Hosting อย่าง GitHub Pages เพียงอย่างเดียวได้

สำหรับ Production ต้องเพิ่มอย่างน้อย:

- ฐานข้อมูล Production แทนไฟล์ JSON
- Authentication/Authorization ฝั่ง Server สำหรับ Admin และผู้เล่น
- Transaction สำหรับรับชำระและปิดยอดรายวัน
- Audit Log สำหรับการแก้ไข/ลบรายการทางการเงิน
- Backup, Error Monitoring และการทดสอบก่อนใช้งานจริง

## เอกสารนำเสนอ

ไฟล์ล่าสุด:

- PowerPoint: `output/presentation/uthai-smash-sales-deck-v2.pptx`
- PDF: `output/pdf/uthai-smash-sales-deck-v2.pdf`

ไฟล์ที่ไม่มี `-v2` เก็บไว้เป็นเวอร์ชันก่อนหน้าเพื่อเปรียบเทียบ
