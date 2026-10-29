# ☕ เมา เมา คาเฟ่

เว็บแอปพลิเคชัน เมา เมา คาเฟ่ (HTML/CSS/JS)  
รองรับ **Firebase Realtime Database** + **Firebase Authentication** (ผู้ขาย)

## คุณสมบัติ
- หน้าลูกค้า: ดูเมนู, ใส่ตะกร้า, สั่งซื้อ, ติดตามออเดอร์, เช็คบิลโต๊ะ
- หน้าผู้ขาย: จัดการสินค้า, ออเดอร์, โต๊ะ/QR, สั่งให้โต๊ะ, สรุปรายได้, รูปพร้อมเพย์
- ผู้ขายล็อกอินด้วย **Firebase Auth** (ปลอดภัยกว่าเปิดฐานข้อมูลสาธารณะ)

## ความปลอดภัย (สำคัญ)

Firebase แจ้งว่ากฎเดิม `.read: true` / `.write: true` **ไม่ปลอดภัย** — ให้เปลี่ยนตามขั้นตอนนี้:

### 1) เปิด Email/Password Auth
1. [Firebase Console](https://console.firebase.google.com) → โปรเจค `coffee-house-b5964`
2. **Authentication** → **Sign-in method** → เปิด **Email/Password**
3. **Users** → **Add user**
   - อีเมล: `admin@coffee-house.app` (หรืออีเมลที่ตั้งใน `ADMIN_EMAIL` ใน `app.js`)
   - รหัสผ่าน: ตั้งเอง (เก็บเป็นความลับ)

### 2) วางกฎ Realtime Database
1. **Realtime Database** → แท็บ **Rules**
2. วางเนื้อหาจากไฟล์ `database.rules.json` แล้ว **Publish**

สรุปสิทธิ์:
| ข้อมูล | อ่าน | เขียน |
|--------|------|--------|
| สินค้า / หมวดหมู่ | ทุกคน | เฉพาะผู้ขายที่ล็อกอิน |
| ออเดอร์ | ทุกคน | ลูกค้าสร้างใหม่ได้ / ผู้ขายแก้ได้ |
| คำขอเช็คบิล | ทุกคน | ลูกค้า+ผู้ขาย (มีเงื่อนไข) |
| session โต๊ะ (QR) | ทุกคน | เฉพาะผู้ขาย |
| สรุปรายได้ | เฉพาะผู้ขาย | เฉพาะผู้ขาย |
| ตั้งค่า (พร้อมเพย์) | ทุกคน | เฉพาะผู้ขาย |

### 3) ล็อกอินหน้าผู้ขาย
เปิด `admin.html` → กรอกอีเมล + รหัสผ่านที่สร้างใน Authentication

## โครงสร้างไฟล์
- `index.html` — หน้าลูกค้า
- `admin.html` — หน้าผู้ขาย
- `app.js` — ตรรกะหลัก + Firebase
- `style.css` — สไตล์
- `database.rules.json` — กฎความปลอดภัย Realtime Database

## GitHub Pages
Settings → Pages → Deploy from a branch → `main` / root

## แก้ไขปัญหาเช็คบิล / เคลียร์บิล

ถ้ากด **เช็คบิล** หรือ **เคลียร์บิล** แล้วไม่ทำงาน (หรือขึ้น Permission denied):

1. ไปที่ Firebase Console → **Realtime Database** → **Rules**
2. วางเนื้อหาจากไฟล์ `database.rules.json` ชุดใหม่ แล้วกด **Publish**
3. กฎใหม่ให้ผู้ขายที่ล็อกอินเขียน `/orders` และ `/billRequests` ได้ทั้งก้อน (และอัปเดตรายออเดอร์)
4. รีเฟรชหน้า `admin.html` แล้วลองใหม่

โค้ดใน `app.js` อัปเดตออเดอร์ทีละรายการตอนเคลียร์บิลแล้ว จึงทนต่อกฎเดิมได้ดีขึ้นด้วย
