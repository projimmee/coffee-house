# ☕ Coffee House - ร้านกาแฟ

เว็บแอปพลิเคชันร้านกาแฟ (HTML/CSS/JS)  
รองรับทั้ง **localStorage** (offline) และ **Firebase Realtime Database** (แชร์ข้อมูลทุกเครื่อง)

## คุณสมบัติ
- หน้าลูกค้า: ดูเมนู, ใส่ตะกร้า, สั่งซื้อ, ติดตามออเดอร์
- หน้าผู้ขาย: จัดการสินค้า, ดู/อัปเดตสถานะออเดอร์
- รหัสผ่านผู้ขายเริ่มต้น: `admin123`

## วิธีเปิดใช้ฐานข้อมูลกลาง (Firebase) ให้ทุกเครื่องเห็นข้อมูลเดียวกัน

1. ไปที่ [Firebase Console](https://console.firebase.google.com) → สร้างโปรเจคใหม่
2. เพิ่ม **Web App** แล้วคัดลอก `firebaseConfig`
3. ไปที่ **Realtime Database** → สร้างฐานข้อมูล (เลือก location ใกล้ เช่น `asia-southeast1`)
4. ตั้ง **Rules** เป็นโหมดทดสอบชั่วคราว:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
5. เปิดไฟล์ `app.js` แล้ว:
   - วาง `firebaseConfig` แทนที่ `FIREBASE_CONFIG`
   - เปลี่ยน `const USE_FIREBASE = false;` เป็น `true`
6. อัปโหลดไฟล์ทั้งหมดขึ้น GitHub Pages อีกครั้ง

หลังจากนั้นทุกเครื่องที่เปิดเว็บจะเห็นสินค้าและออเดอร์ร่วมกันแบบ real-time

## โครงสร้างไฟล์
- `index.html` — หน้าลูกค้า
- `admin.html` — หน้าผู้ขาย
- `app.js` — ตรรกะหลัก + Firebase
- `style.css` — สไตล์

## GitHub Pages
Settings → Pages → Deploy from a branch → `main` / root
