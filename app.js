// ===== Coffee House Management System =====
// HTML/CSS/JS + Firebase Realtime Database (shared across devices)
// Cart ยังใช้ localStorage (ต่อเครื่อง)

/* =====================================================
   🔥 ตั้งค่า Firebase ที่นี่
   1. ไปที่ https://console.firebase.google.com
   2. สร้างโปรเจคใหม่ (หรือใช้ของเดิม)
   3. เพิ่ม Web App → คัดลอก firebaseConfig มาวางด้านล่าง
   4. ไปที่ Realtime Database → สร้างฐานข้อมูล → เริ่มในโหมด test
   5. Rules ตั้งเป็น (สำหรับทดสอบ):
      {
        "rules": {
          ".read": true,
          ".write": true
        }
      }
   ===================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBo9AfzOLBjz7sZGLPDUfXUHjYFie0UIrg",
  authDomain: "coffee-house-b5964.firebaseapp.com",
  databaseURL: "https://coffee-house-b5964-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "coffee-house-b5964",
  storageBucket: "coffee-house-b5964.firebasestorage.app",
  messagingSenderId: "616757694802",
  appId: "1:616757694802:web:a2248e4a903bd0ea3c2a8b"
};

const USE_FIREBASE = true;

const STORAGE_KEYS = {
  products: 'coffee_products',
  orders: 'coffee_orders',
  cart: 'coffee_cart',
  adminAuth: 'coffee_admin_auth',
  table: 'coffee_table',
  tableSession: 'coffee_table_session',
  billRequests: 'coffee_bill_requests',
  tableSessions: 'coffee_table_sessions'
};

const TOTAL_TABLES = 20;

const STATUS_LABELS = {
  pending: 'รับออเดอร์',
  preparing: 'กำลังทำ',
  completed: 'เสร็จแล้ว',
  cancelled: 'ยกเลิก'
};

const STATUS_META = {
  pending: { icon: '📋', label: 'รับออเดอร์', desc: 'ร้านค้ารับออเดอร์แล้ว', step: 1, color: '#e67e22' },
  preparing: { icon: '👨‍🍳', label: 'กำลังทำ', desc: 'กำลังเตรียมสินค้าให้คุณ', step: 2, color: '#2980b9' },
  completed: { icon: '✅', label: 'เสร็จแล้ว', desc: 'พร้อมเสิร์ฟ / มารับได้เลย', step: 3, color: '#27ae60' },
  cancelled: { icon: '❌', label: 'ยกเลิก', desc: 'ออเดอร์นี้ถูกยกเลิกแล้ว', step: 0, color: '#e74c3c' }
};

function generateSessionToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function getTableSessions() {
  if (firebaseReady) return { ...tableSessionsCache };
  try {
    const data = localStorage.getItem(STORAGE_KEYS.tableSessions);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

async function saveTableSessions(obj) {
  if (firebaseReady && db) {
    await db.ref('tableSessions').set(obj && Object.keys(obj).length ? obj : null);
    tableSessionsCache = obj || {};
  } else {
    localStorage.setItem(STORAGE_KEYS.tableSessions, JSON.stringify(obj || {}));
  }
  if (document.getElementById('tables-qr-grid')) renderTablesQR();
}

async function ensureAllTableSessions() {
  const sessions = getTableSessions();
  let changed = false;
  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const k = String(i);
    if (!sessions[k]) {
      sessions[k] = generateSessionToken();
      changed = true;
    }
  }
  if (changed) await saveTableSessions(sessions);
  return sessions;
}

async function rotateTableSession(tableNum) {
  const sessions = getTableSessions();
  sessions[String(tableNum)] = generateSessionToken();
  await saveTableSessions(sessions);
  return sessions[String(tableNum)];
}

function getTableSessionToken(tableNum) {
  const sessions = getTableSessions();
  return sessions[String(tableNum)] || '';
}

function isTableSessionValid(tableNum, token) {
  if (!tableNum) return false;
  const current = getTableSessionToken(tableNum);
  // ยังไม่มี session ในระบบ → ยอมรับ (จะถูกสร้างทีหลัง)
  if (!current) return true;
  return !!token && token === current;
}


/** โต๊ะปัจจุบันมีสิทธิ์สั่งได้หรือไม่ (ต้องมี session ตรงกับ QR ปัจจุบัน) */
function canOrderAtCurrentTable() {
  const table = (() => {
    const saved = localStorage.getItem(STORAGE_KEYS.table);
    if (!saved) return null;
    const n = parseInt(saved, 10);
    return (n >= 1 && n <= TOTAL_TABLES) ? n : null;
  })();
  if (!table) return false;
  const session = getCurrentTableSession();
  return isTableSessionValid(table, session);
}

function requireValidTableForOrder(actionLabel) {
  const table = getCurrentTable();
  if (!table) {
    alert('กรุณาสแกน QR ที่โต๊ะก่อน' + (actionLabel ? actionLabel : 'สั่งอาหาร') + '\n(หลังเคลียร์บิลต้องใช้ QR ใหม่เท่านั้น)');
    return null;
  }
  const session = getCurrentTableSession();
  if (!isTableSessionValid(table, session)) {
    alert('⚠️ QR โต๊ะนี้หมดอายุแล้ว\nร้านเคลียร์บิลไปแล้ว — กรุณาสแกน QR ใหม่ที่โต๊ะเท่านั้น');
    clearCurrentTable();
    if (typeof renderTableBadge === 'function') renderTableBadge();
    return null;
  }
  return table;
}

function getCurrentTableSession() {
  return localStorage.getItem(STORAGE_KEYS.tableSession) || '';
}

function getCurrentTable() {
  // จาก URL ?table=N&s=TOKEN เท่านั้นที่ถือว่ามีสิทธิ์สั่ง (หลังเคลียร์บิลต้องสแกน QR ใหม่)
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('table');
  const sessionFromUrl = params.get('s') || '';
  if (fromUrl) {
    const n = parseInt(fromUrl, 10);
    if (n >= 1 && n <= TOTAL_TABLES) {
      const currentToken = getTableSessionToken(n);

      // ระบบมี session แล้ว → ต้องมี s= ที่ตรงกันเท่านั้น
      if (currentToken) {
        if (!sessionFromUrl || sessionFromUrl !== currentToken) {
          localStorage.removeItem(STORAGE_KEYS.table);
          localStorage.removeItem(STORAGE_KEYS.tableSession);
          if (!window.__outdatedQrWarned) {
            window.__outdatedQrWarned = true;
            setTimeout(() => {
              alert('⚠️ QR โต๊ะ ' + n + ' หมดอายุหรือไม่ถูกต้อง\nกรุณาสแกน QR ใหม่ที่โต๊ะเท่านั้น (หลังร้านเคลียร์บิลแล้ว)');
            }, 400);
          }
          return null;
        }
        // token ตรง → อนุญาต
        localStorage.setItem(STORAGE_KEYS.table, String(n));
        localStorage.setItem(STORAGE_KEYS.tableSession, sessionFromUrl);
        return n;
      }

      // ยังไม่มี session ในระบบ (ครั้งแรก) → รับ table จาก URL ได้
      localStorage.setItem(STORAGE_KEYS.table, String(n));
      if (sessionFromUrl) {
        localStorage.setItem(STORAGE_KEYS.tableSession, sessionFromUrl);
      }
      return n;
    }
  }

  // ไม่มี ?table= ใน URL → ใช้ค่าที่บันทึกไว้เฉพาะเมื่อ session ยังตรง
  const saved = localStorage.getItem(STORAGE_KEYS.table);
  if (saved) {
    const n = parseInt(saved, 10);
    if (n >= 1 && n <= TOTAL_TABLES) {
      const savedSession = localStorage.getItem(STORAGE_KEYS.tableSession) || '';
      if (!isTableSessionValid(n, savedSession)) {
        localStorage.removeItem(STORAGE_KEYS.table);
        localStorage.removeItem(STORAGE_KEYS.tableSession);
        return null;
      }
      return n;
    }
  }
  return null;
}

function setCurrentTable(n) {
  // เลือกโต๊ะจาก UI อย่างเดียว — ไม่มอบ session (ต้องสแกน QR ที่มี s= ถึงจะสั่งได้)
  if (n >= 1 && n <= TOTAL_TABLES) {
    localStorage.setItem(STORAGE_KEYS.table, String(n));
    // ล้าง session เก่าของโต๊ะอื่น ถ้ามี — ไม่ดึง token จากเซิร์ฟเวอร์
    const savedSession = localStorage.getItem(STORAGE_KEYS.tableSession) || '';
    if (savedSession && !isTableSessionValid(n, savedSession)) {
      localStorage.removeItem(STORAGE_KEYS.tableSession);
    }
  }
}

function clearCurrentTable() {
  localStorage.removeItem(STORAGE_KEYS.table);
  localStorage.removeItem(STORAGE_KEYS.tableSession);
}

function getTableOrderUrl(tableNum) {
  const base = (typeof getBuyerBaseUrl === 'function')
    ? getBuyerBaseUrl()
    : (() => {
        let url = window.location.href.split('?')[0].replace(/admin\.html$/, 'index.html');
        if (url.endsWith('/')) url += 'index.html';
        else if (!url.endsWith('index.html')) {
          url = url.replace(/admin\.html$/, 'index.html');
          if (!url.endsWith('index.html')) {
            const parts = url.split('/');
            parts[parts.length - 1] = 'index.html';
            url = parts.join('/');
          }
        }
        return url;
      })();
  const token = getTableSessionToken(tableNum);
  return token
    ? `${base}?table=${tableNum}&s=${token}`
    : `${base}?table=${tableNum}`;
}

const DEFAULT_PRODUCTS = [
  { id: 'p1', name: 'เอสเปรสโซ่', price: 45, category: 'กาแฟ', description: 'กาแฟเข้มข้นแบบอิตาเลียน', image: '' },
  { id: 'p2', name: 'อเมริกาโน่', price: 50, category: 'กาแฟ', description: 'เอสเปรสโซ่ผสมน้ำร้อน หอมเข้ม', image: '' },
  { id: 'p3', name: 'คาปูชิโน่', price: 60, category: 'กาแฟ', description: 'นมฟองนุ่ม ๆ กับเอสเปรสโซ่', image: '' },
  { id: 'p4', name: 'ลาเต้', price: 65, category: 'กาแฟ', description: 'นมสดละมุน กับกาแฟหอมกรุ่น', image: '' },
  { id: 'p5', name: 'มอคค่า', price: 70, category: 'กาแฟ', description: 'ช็อกโกแลต + กาแฟ + นม', image: '' },
  { id: 'p6', name: 'ชาเขียวมัทฉะลาเต้', price: 75, category: 'ชา', description: 'มัทฉะญี่ปุ่นแท้ ผสมนม', image: '' },
  { id: 'p7', name: 'ชานมไต้หวัน', price: 55, category: 'ชา', description: 'ชานมสูตรไต้หวัน หวานมัน', image: '' },
  { id: 'p8', name: 'เค้กช็อกโกแลต', price: 85, category: 'ของหวาน', description: 'เค้กช็อกโกแลตนุ่มฟู', image: '' },
  { id: 'p9', name: 'ครัวซองต์เนย', price: 50, category: 'ของหวาน', description: 'ครัวซองต์อบใหม่ กรอบนอกนุ่มใน', image: '' },
  { id: 'p10', name: 'น้ำส้มคั้นสด', price: 45, category: 'เครื่องดื่มอื่นๆ', description: 'น้ำส้มคั้นสด ๆ ไม่ใส่น้ำตาล', image: '' }
];

const DEFAULT_CATEGORIES = ['กาแฟ', 'ชา', 'ของหวาน', 'เครื่องดื่มอื่นๆ'];

// ===== Firebase Init =====
let db = null;
let productsCache = [...DEFAULT_PRODUCTS];
let ordersCache = [];
let categoriesCache = [...DEFAULT_CATEGORIES];
let billRequestsCache = {}; // { tableNum: { table, total, items, requestedAt, status } }
let tableSessionsCache = {}; // { "1": "token...", ... } — QR เปลี่ยนเมื่อเคลียร์บิล
let firebaseReady = false;
let storage = null;
let pendingImageFile = null; // file selected for upload

function initFirebase() {
  if (!USE_FIREBASE) {
    console.log('📦 ใช้ localStorage (ยังไม่เปิด Firebase)');
    return false;
  }
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    console.warn('⚠️ กรุณาใส่ Firebase Config ใน app.js ก่อน');
    return false;
  }
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    db = firebase.database();
    // Storage ไม่จำเป็นแล้ว (ใช้ base64 แทน)
    storage = null;
    firebaseReady = true;
    console.log('🔥 Firebase พร้อมใช้งาน');
    return true;
  } catch (e) {
    console.error('Firebase init error:', e);
    return false;
  }
}

// ===== Helpers =====
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatPrice(n) {
  return Number(n).toLocaleString('th-TH');
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getIcon(category) {
  const icons = {
    'กาแฟ': '☕',
    'ชา': '🍵',
    'ของหวาน': '🍰',
    'เครื่องดื่มอื่นๆ': '🥤'
  };
  return icons[category] || '🍽️';
}

// ===== Storage Layer (Firebase + localStorage fallback) =====

function getProducts() {
  if (firebaseReady) return productsCache;
  const data = localStorage.getItem(STORAGE_KEYS.products);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(DEFAULT_PRODUCTS));
    return [...DEFAULT_PRODUCTS];
  }
  return JSON.parse(data);
}

async function saveProducts(products) {
  if (firebaseReady && db) {
    // เก็บเป็น object keyed by id
    const obj = {};
    products.forEach(p => { obj[p.id] = p; });
    await db.ref('products').set(obj);
    productsCache = products;
  } else {
    localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(products));
  }
}

function getOrders() {
  if (firebaseReady) return ordersCache;
  const data = localStorage.getItem(STORAGE_KEYS.orders);
  return data ? JSON.parse(data) : [];
}

async function saveOrders(orders) {
  if (firebaseReady && db) {
    const obj = {};
    orders.forEach(o => { obj[o.id] = o; });
    await db.ref('orders').set(obj);
    ordersCache = orders;
  } else {
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));
  }
}

function getCart() {
  const data = localStorage.getItem(STORAGE_KEYS.cart);
  return data ? JSON.parse(data) : [];
}

function saveCart(cart) {
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
}

function getCategories() {
  if (firebaseReady) return categoriesCache;
  const data = localStorage.getItem('coffee_categories');
  if (!data) {
    localStorage.setItem('coffee_categories', JSON.stringify(DEFAULT_CATEGORIES));
    return [...DEFAULT_CATEGORIES];
  }
  return JSON.parse(data);
}

async function saveCategories(categories) {
  if (firebaseReady && db) {
    await db.ref('categories').set(categories);
    categoriesCache = categories;
  } else {
    localStorage.setItem('coffee_categories', JSON.stringify(categories));
  }
  renderCategoryFilters();
  renderCategorySelect();
  renderAdminCategories();
}

// หมายเลขออเดอร์ (Firebase transaction หรือ local)
async function getNextOrderNumber() {
  try {
    if (firebaseReady && db) {
      const counterRef = db.ref('meta/orderCounter');
      const result = await counterRef.transaction(current => {
        const next = (typeof current === 'number' ? current : 0) % 1000;
        return next + 1;
      });
      if (result && result.committed && result.snapshot.exists()) {
        const num = (result.snapshot.val() - 1) % 1000;
        return String(num < 0 ? 0 : num).padStart(3, '0');
      }
      // transaction ไม่สำเร็จ → ใช้ timestamp แทน
      return String(Date.now() % 1000).padStart(3, '0');
    }
  } catch (err) {
    console.error('getNextOrderNumber error:', err);
  }
  // fallback local
  let counter = parseInt(localStorage.getItem('coffee_order_counter') || '0', 10);
  const num = counter;
  counter = (counter + 1) % 1000;
  localStorage.setItem('coffee_order_counter', String(counter));
  return String(num).padStart(3, '0');
}

// ===== Real-time Listeners (Firebase) =====
function startFirebaseListeners() {
  if (!firebaseReady || !db) {
    console.warn('Firebase not ready, skipping listeners');
    return;
  }

  console.log('📡 เริ่มฟังข้อมูลจาก Firebase...');

  // Products listener
  db.ref('products').on('value', snapshot => {
    const val = snapshot.val();
    if (val) {
      productsCache = Object.values(val);
      console.log('✅ โหลดสินค้า', productsCache.length, 'รายการ');
    } else {
      // ยังไม่มีข้อมูล → seed default
      console.log('🌱 ยังไม่มีสินค้า → ใส่ค่าเริ่มต้น');
      const obj = {};
      DEFAULT_PRODUCTS.forEach(p => { obj[p.id] = p; });
      db.ref('products').set(obj).catch(err => console.error('Seed products error:', err));
      productsCache = [...DEFAULT_PRODUCTS];
    }
    if (document.getElementById('product-grid')) renderProducts();
    if (document.getElementById('admin-product-list')) renderAdminProducts();
  }, error => {
    console.error('❌ อ่าน products ไม่ได้ (เช็ค Rules):', error);
    // fallback แสดงสินค้าเริ่มต้น
    productsCache = [...DEFAULT_PRODUCTS];
    if (document.getElementById('product-grid')) renderProducts();
  });

  // Orders listener
  db.ref('orders').on('value', snapshot => {
    const val = snapshot.val();
    ordersCache = val ? Object.values(val).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
    console.log('✅ โหลดออเดอร์', ordersCache.length, 'รายการ');
    
    if (document.getElementById('orders-list')) {
      renderOrders();
    }
    updateBuyerBillButton();
    // refresh track if open
    const trackResult = document.getElementById('track-result');
    const trackInput = document.getElementById('track-order-id');
    if (trackResult && trackResult.style.display !== 'none' && trackInput?.value.trim()) {
      searchOrder();
    }
    if (typeof updateLastSync === 'function') updateLastSync();
  }, error => {
    console.error('❌ อ่าน orders ไม่ได้ (เช็ค Rules):', error);
  });

  // Bill requests listener
  db.ref('billRequests').on('value', snapshot => {
    const val = snapshot.val();
    billRequestsCache = val && typeof val === 'object' ? val : {};
    console.log('✅ โหลดคำขอเช็คบิล', Object.keys(billRequestsCache).length, 'รายการ');
    renderBillRequestBanner();
    if (document.getElementById('tables-qr-grid')) renderTablesQR();
    updateBuyerBillButton();
    // ถ้า modal เปิดอยู่ รีเฟรช
    const bm = document.getElementById('buyer-bill-modal');
    if (bm && bm.classList.contains('show')) {
      // keep open; user can re-open if needed
    }
  }, error => {
    console.error('❌ อ่าน billRequests ไม่ได้:', error);
  });

  // Table sessions listener (QR token ต่อโต๊ะ)
  db.ref('tableSessions').on('value', snapshot => {
    const val = snapshot.val();
    if (val && typeof val === 'object') {
      tableSessionsCache = val;
    } else {
      // seed tokens สำหรับทุกโต๊ะ
      const seeded = {};
      for (let i = 1; i <= TOTAL_TABLES; i++) {
        seeded[String(i)] = generateSessionToken();
      }
      db.ref('tableSessions').set(seeded).catch(err => console.error('Seed tableSessions error:', err));
      tableSessionsCache = seeded;
    }
    console.log('✅ โหลด session โต๊ะ', Object.keys(tableSessionsCache).length, 'โต๊ะ');
    if (document.getElementById('tables-qr-grid')) renderTablesQR();
    // buyer: ตรวจ session ปัจจุบันอีกครั้ง
    if (document.getElementById('product-grid')) {
      const t = getCurrentTable();
      renderTableBadge();
      updateBuyerBillButton();
      // ถ้า session ถูก rotate (เคลียร์บิล) ให้เคลียร์ตะกร้าและแจ้ง
      if (!t && getCart().length > 0) {
        saveCart([]);
        updateCartUI();
      }
    }
  }, error => {
    console.error('❌ อ่าน tableSessions ไม่ได้:', error);
  });

  // Categories listener
  db.ref('categories').on('value', snapshot => {
    const val = snapshot.val();
    if (val && Array.isArray(val) && val.length > 0) {
      categoriesCache = val;
    } else {
      categoriesCache = [...DEFAULT_CATEGORIES];
      db.ref('categories').set(DEFAULT_CATEGORIES).catch(err => console.error('Seed categories error:', err));
    }
    console.log('✅ โหลดหมวดหมู่', categoriesCache.length, 'รายการ');
    renderCategoryFilters();
    renderCategorySelect();
    renderAdminCategories();
  }, error => {
    console.error('❌ อ่าน categories ไม่ได้:', error);
    categoriesCache = [...DEFAULT_CATEGORIES];
    renderCategoryFilters();
    renderCategorySelect();
  });
}

// ===== Table UI (Buyer) =====
function renderTableBadge() {
  const table = getCurrentTable();
  let badge = document.getElementById('table-badge');
  if (!badge) {
    // สร้างถ้ายังไม่มี
    const nav = document.querySelector('.nav-brand');
    if (nav) {
      badge = document.createElement('span');
      badge.id = 'table-badge';
      badge.className = 'table-badge';
      nav.appendChild(badge);
    }
  }
  if (!badge) return;

  if (table) {
    badge.innerHTML = `🪑 โต๊ะ <strong>${table}</strong>`;
    badge.style.display = 'inline-flex';
    badge.onclick = null;
  } else {
    badge.innerHTML = `🪑 เลือกโต๊ะ`;
    badge.style.display = 'inline-flex';
    badge.style.cursor = 'pointer';
    badge.onclick = openTablePicker;
  }

  // อัปเดต hero เล็กน้อย
  const heroP = document.querySelector('.hero-content p');
  if (heroP && table) {
    heroP.textContent = `สั่งอาหารโต๊ะ ${table} · กาแฟคุณภาพ หอมกรุ่น`;
  }
  updateBuyerBillButton();
}

function openTablePicker() {
  const current = getCurrentTable();
  let html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;max-height:50vh;overflow:auto;">';
  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const active = current === i ? 'background:var(--primary);color:#fff;' : '';
    html += `<button type="button" class="btn btn-outline btn-sm" style="${active}" onclick="selectTable(${i})">${i}</button>`;
  }
  html += '</div>';

  // ใช้ modal ง่าย ๆ
  let modal = document.getElementById('table-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'table-picker-modal';
    modal.className = 'modal show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:360px;">
        <div class="modal-header">
          <h2>🪑 เลือกหมายเลขโต๊ะ</h2>
          <button class="close-btn" onclick="closeTablePicker()">&times;</button>
        </div>
        <div style="padding:1rem;" id="table-picker-body"></div>
        <p style="padding:0 1rem 1rem;font-size:0.85rem;color:var(--text-muted);">หรือสแกน QR ที่โต๊ะเพื่อเลือกอัตโนมัติ</p>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeTablePicker(); });
  }
  document.getElementById('table-picker-body').innerHTML = html;
  modal.classList.add('show');
}

function closeTablePicker() {
  document.getElementById('table-picker-modal')?.classList.remove('show');
}

function selectTable(n) {
  setCurrentTable(n);
  closeTablePicker();
  // อย่าใส่ s= ใน URL จาก picker — ต้องสแกน QR จริง
  const url = new URL(window.location.href);
  url.searchParams.set('table', n);
  url.searchParams.delete('s');
  window.history.replaceState({}, '', url);
  renderTableBadge();
  // ถ้าโต๊ะนี้มี session แล้ว แจ้งว่าต้องสแกน QR
  const token = getTableSessionToken(n);
  if (token && !isTableSessionValid(n, getCurrentTableSession())) {
    alert('โต๊ะ ' + n + ' ต้องสแกน QR ที่โต๊ะเท่านั้น\n(ไม่สามารถเลือกจากเมนูนี้เพื่อสั่งได้หลังร้านเปิดใช้ QR session)');
  }
}

// ===== Buyer: Products =====
let currentCategory = 'all';

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  let products = getProducts();
  if (currentCategory !== 'all') {
    products = products.filter(p => p.category === currentCategory);
  }

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="icon">☕</div>
        <p>ยังไม่มีสินค้าในหมวดนี้</p>
      </div>`;
    return;
  }

  grid.innerHTML = products.map(p => `
    <div class="product-card">
      <div class="product-image">
        ${p.image
          ? `<img src="${p.image}" alt="${p.name}" onerror="this.parentElement.innerHTML='${getIcon(p.category)}'">`
          : getIcon(p.category)}
      </div>
      <div class="product-body">
        <div class="product-category">${p.category}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="product-footer">
          <div class="product-price">${formatPrice(p.price)} ฿</div>
          <button class="btn btn-primary btn-sm" onclick="addToCart('${p.id}')">
            + ใส่ตะกร้า
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderCategoryFilters() {
  const container = document.querySelector('.filters');
  if (!container) return;
  const cats = getCategories();
  const active = currentCategory || 'all';
  container.innerHTML = `
    <button class="filter-btn ${active === 'all' ? 'active' : ''}" data-category="all">ทั้งหมด</button>
    ${cats.map(c => `<button class="filter-btn ${active === c ? 'active' : ''}" data-category="${c}">${c}</button>`).join('')}
  `;
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

function setupFilters() {
  renderCategoryFilters();
}

function renderCategorySelect() {
  const select = document.getElementById('product-category');
  if (!select) return;
  const cats = getCategories();
  const current = select.value;
  select.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  if (current && cats.includes(current)) select.value = current;
}

function renderAdminCategories() {
  const list = document.getElementById('admin-category-list');
  if (!list) return;
  const cats = getCategories();
  if (cats.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>ยังไม่มีหมวดหมู่</p></div>';
    return;
  }
  list.innerHTML = cats.map(c => `
    <div class="admin-product-item" style="padding:0.6rem 0.8rem;">
      <div class="info">
        <div class="name">${c}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteCategory('${c.replace(/'/g, "\\'")}')">ลบ</button>
    </div>
  `).join('');
}

async function addCategory() {
  const input = document.getElementById('new-category-name');
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    alert('กรุณากรอกชื่อหมวดหมู่');
    return;
  }
  let cats = getCategories();
  if (cats.includes(name)) {
    alert('มีหมวดหมู่นี้แล้ว');
    return;
  }
  cats.push(name);
  await saveCategories(cats);
  input.value = '';
  alert('เพิ่มหมวดหมู่เรียบร้อย');
}

async function deleteCategory(name) {
  const products = getProducts();
  const used = products.some(p => p.category === name);
  if (used) {
    if (!confirm(`หมวดหมู่ "${name}" ยังมีสินค้าอยู่\nลบแล้วสินค้าจะยังอยู่ในระบบ แต่จะไม่มีปุ่มกรอง\nต้องการลบหมวดหมู่นี้หรือไม่?`)) return;
  } else {
    if (!confirm(`ต้องการลบหมวดหมู่ "${name}" หรือไม่?`)) return;
  }
  let cats = getCategories().filter(c => c !== name);
  if (cats.length === 0) {
    alert('ต้องมีอย่างน้อย 1 หมวดหมู่');
    return;
  }
  await saveCategories(cats);
  if (currentCategory === name) {
    currentCategory = 'all';
    renderProducts();
  }
}

// ===== Cart =====
// Pending product for note modal
let pendingProduct = null;
let pendingQty = 1;

function addToCart(productId) {
  // หลังเคลียร์บิลต้องสแกน QR ใหม่เท่านั้น
  if (!requireValidTableForOrder('ใส่ตะกร้า')) {
    return;
  }

  const products = getProducts();
  const product = products.find(p => p.id === productId);
  if (!product) return;

  pendingProduct = product;
  pendingQty = 1;

  // Show note modal
  const preview = document.getElementById('note-product-preview');
  if (preview) {
    const icon = getIcon(product.category);
    const imgHtml = product.image
      ? `<img src="${product.image}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" onerror="this.parentElement.textContent='${icon}'">`
      : icon;
    preview.innerHTML = `
      <div class="np-icon">${imgHtml}</div>
      <div>
        <div class="np-name">${product.name}</div>
        <div class="np-price">${formatPrice(product.price)} ฿</div>
      </div>`;
  }
  document.getElementById('note-qty-value').textContent = '1';
  document.getElementById('item-note').value = '';
  document.querySelectorAll('.quick-tag').forEach(t => t.classList.remove('active'));
  document.getElementById('note-modal')?.classList.add('show');
}

function closeNoteModal() {
  document.getElementById('note-modal')?.classList.remove('show');
  pendingProduct = null;
  pendingQty = 1;
}

function confirmAddToCart() {
  if (!pendingProduct) return;
  if (!requireValidTableForOrder('ใส่ตะกร้า')) {
    closeNoteModal();
    return;
  }

  const note = (document.getElementById('item-note')?.value || '').trim();
  const qty = pendingQty || 1;

  let cart = getCart();
  // ถ้าสินค้าเดียวกัน + หมายเหตุเดียวกัน ให้รวมจำนวน
  const existing = cart.find(item =>
    item.id === pendingProduct.id && (item.note || '') === note
  );

  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: pendingProduct.id,
      name: pendingProduct.name,
      price: pendingProduct.price,
      qty: qty,
      note: note
    });
  }
  saveCart(cart);
  updateCartUI();
  closeNoteModal();
}

function updateCartQty(productId, delta) {
  let cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  saveCart(cart);
  updateCartUI();
  renderCartItems();
}

function removeFromCart(productId) {
  let cart = getCart().filter(i => i.id !== productId);
  saveCart(cart);
  updateCartUI();
  renderCartItems();
}

function updateCartQtyByIndex(idx, delta) {
  let cart = getCart();
  if (!cart[idx]) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }
  saveCart(cart);
  updateCartUI();
  renderCartItems();
}

function removeFromCartByIndex(idx) {
  let cart = getCart();
  cart.splice(idx, 1);
  saveCart(cart);
  updateCartUI();
  renderCartItems();
}



function updateCartUI() {
  const cart = getCart();
  const count = cart.reduce((sum, i) => sum + i.qty, 0);
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.textContent = count;

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = formatPrice(total);

  const checkoutBtn = document.getElementById('checkout-btn');
  if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  if (!container) return;

  const cart = getCart();
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🛒</div>
        <p>ตะกร้าว่างเปล่า</p>
      </div>`;
    return;
  }

  container.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        ${item.note ? `<div style="font-size:0.8rem; color:var(--primary-light); margin:0.15rem 0;">📝 ${item.note}</div>` : ''}
        <span>${formatPrice(item.price)} ฿ × ${item.qty} = ${formatPrice(item.price * item.qty)} ฿</span>
      </div>
      <div class="cart-item-actions">
        <button class="qty-btn" onclick="updateCartQtyByIndex(${idx}, -1)">−</button>
        <span>${item.qty}</span>
        <button class="qty-btn" onclick="updateCartQtyByIndex(${idx}, 1)">+</button>
        <button class="btn btn-sm btn-danger" onclick="removeFromCartByIndex(${idx})" style="padding:0.2rem 0.5rem;">ลบ</button>
      </div>
    </div>
  `).join('');
}

function openCart() {
  renderCartItems();
  updateCartUI();
  document.getElementById('cart-modal')?.classList.add('show');
}

function closeCart() {
  document.getElementById('cart-modal')?.classList.remove('show');
}

// ===== Checkout =====
function openCheckout() {
  const cart = getCart();
  if (cart.length === 0) return;

  const table = requireValidTableForOrder('สั่งอาหาร');
  if (!table) return;

  closeCart();
  const summary = document.getElementById('checkout-summary');
  const totalEl = document.getElementById('checkout-total');
  if (summary) {
    summary.innerHTML = `
      <div class="detail-item" style="font-weight:700;color:var(--primary);margin-bottom:0.4rem;">
        <span>🪑 โต๊ะ ${table}</span><span></span>
      </div>
      ` + cart.map(i =>
      `<div class="detail-item"><span>${i.name} × ${i.qty}${i.note ? ' <small style="color:var(--text-muted);">(📝 '+i.note+')</small>' : ''}</span><span>${formatPrice(i.price * i.qty)} ฿</span></div>`
    ).join('');
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  if (totalEl) totalEl.textContent = formatPrice(total);

  document.getElementById('checkout-modal')?.classList.add('show');
}

function closeCheckout() {
  document.getElementById('checkout-modal')?.classList.remove('show');
}

async function placeOrder(e) {
  e.preventDefault();
  const cart = getCart();
  if (cart.length === 0) return;

  const table = requireValidTableForOrder('สั่งอาหาร');
  if (!table) return;
  const sessionToken = getCurrentTableSession();

  const note = (document.getElementById('customer-note')?.value || '').trim();
  const submitBtn = e.target?.querySelector?.('[type="submit"]') || document.querySelector('#checkout-form [type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังสั่งซื้อ...';
  }

  try {
    const orderId = await getNextOrderNumber();

    const order = {
      id: orderId,
      table: table,
      session: sessionToken || getTableSessionToken(table) || '',
      customerName: '',
      customerPhone: '',
      note: note,
      items: cart.map(i => ({ ...i })),
      total: cart.reduce((s, i) => s + i.price * i.qty, 0),
      status: 'pending',
      settled: false,
      createdAt: new Date().toISOString()
    };

    // บันทึกออเดอร์ทีละรายการ (ไม่ทับทั้งก้อน) ถ้าใช้ Firebase
    if (firebaseReady && db) {
      await db.ref('orders/' + orderId).set(order);
      // อัปเดต cache ทันที
      ordersCache = [order, ...ordersCache.filter(o => o.id !== orderId)];
    } else {
      const orders = getOrders();
      orders.unshift(order);
      await saveOrders(orders);
    }

    // clear cart
    saveCart([]);
    updateCartUI();

    closeCheckout();
    document.getElementById('checkout-form')?.reset();

    // เด้งไปหน้าติดตามออเดอร์ทันที
    openTrack();
    const input = document.getElementById('track-order-id');
    if (input) {
      input.value = order.id;
      searchOrder();
    }
  } catch (err) {
    console.error('placeOrder error:', err);
    alert('สั่งซื้อไม่สำเร็จ: ' + (err.message || err) + '\n\nลองใหม่อีกครั้ง หรือเช็คการเชื่อมต่ออินเทอร์เน็ต');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'ยืนยันสั่งซื้อ';
    }
  }
}

function closeSuccess() {
  document.getElementById('success-modal')?.classList.remove('show');
}

// ===== Admin =====
function isAdminLoggedIn() {
  return localStorage.getItem(STORAGE_KEYS.adminAuth) === 'true';
}

function loginAdmin() {
  const pw = document.getElementById('admin-password')?.value;
  if (pw === 'admin123') {
    localStorage.setItem(STORAGE_KEYS.adminAuth, 'true');
    showAdminDashboard();
  } else {
    const err = document.getElementById('login-error');
    if (err) {
      err.style.display = 'block';
      setTimeout(() => err.style.display = 'none', 2500);
    }
  }
}

function logoutAdmin() {
  localStorage.removeItem(STORAGE_KEYS.adminAuth);
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-dashboard').style.display = 'none';
  stopOrdersPolling();
}

function showAdminDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'block';
  renderOrders();
  renderAdminProducts();
  renderCategorySelect();
  renderAdminCategories();
  renderTablesQR();
  renderBillRequestBanner();
  if (!firebaseReady) {
    startRealtimeSync();
    startOrdersPolling();
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      document.getElementById(tabId)?.classList.add('active');
      if (btn.dataset.tab === 'tables') {
        setTimeout(renderTablesQR, 50);
      }
      if (btn.dataset.tab === 'products') {
        renderAdminProducts();
        renderAdminCategories();
        renderCategorySelect();
      }
    });
  });
}

// ===== Orders (Admin) =====
let currentOrderStatus = 'all';

// Track previous order IDs for new-order highlight
let previousOrderIds = new Set();

function updateOrderStats(allOrders) {
  const pending = allOrders.filter(o => o.status === 'pending').length;
  const preparing = allOrders.filter(o => o.status === 'preparing').length;
  const completed = allOrders.filter(o => o.status === 'completed').length;
  const total = allOrders.length;

  const el = (id) => document.getElementById(id);
  if (el('stat-pending')) el('stat-pending').textContent = pending;
  if (el('stat-preparing')) el('stat-preparing').textContent = preparing;
  if (el('stat-completed')) el('stat-completed').textContent = completed;
  if (el('stat-total')) el('stat-total').textContent = total;
}

function updateLastSync() {
  const el = document.getElementById('last-sync');
  if (el) {
    const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `อัปเดต ${now}`;
  }
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  if (!list) return;

  const allOrders = getOrders();
  // สถิตินับเฉพาะที่ยังไม่เคลียร์บิล
  const activeOrders = allOrders.filter(o => !o.settled);
  updateOrderStats(activeOrders);
  updateLastSync();

  let orders = activeOrders;
  if (currentOrderStatus !== 'all') {
    orders = orders.filter(o => o.status === currentOrderStatus);
  }

  // Detect new orders for highlight + optional sound
  const currentIds = new Set(allOrders.map(o => o.id));
  const newIds = [...currentIds].filter(id => !previousOrderIds.has(id) && previousOrderIds.size > 0);
  if (newIds.length > 0) {
    tryPlayNewOrderSound();
  }
  previousOrderIds = currentIds;

  if (orders.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>ยังไม่มีออเดอร์${currentOrderStatus !== 'all' ? ' ในสถานะนี้' : ''}</p>
      </div>`;
    return;
  }

  const statusLabel = STATUS_LABELS;

  list.innerHTML = orders.map(o => {
    const isNew = newIds.includes(o.id);
    const borderClass = o.status === 'pending' ? 'pending-urgent' : (o.status === 'preparing' ? 'preparing-active' : '');
    const newClass = isNew ? 'new-order' : '';
    const itemSummary = o.items.map(i => `${i.name}×${i.qty}${i.note ? ' (📝'+i.note+')' : ''}`).join(', ');

    return `
    <div class="order-card ${borderClass} ${newClass}" data-order-id="${o.id}">
      <div class="order-info">
        <h3>
          ${o.table ? `<span class="table-tag">โต๊ะ ${o.table}</span> ` : ''}
          #${o.id}${isNew ? ' <span style="color:var(--accent);font-size:0.8rem;">ใหม่!</span>' : ''}
        </h3>
        <div class="order-meta">
          <span>🕒 ${formatDate(o.createdAt)}</span>
          ${o.note ? `<span>📝 ${o.note}</span>` : ''}
        </div>
        <div style="margin-top:0.35rem; font-size:0.88rem; color:var(--text-muted);">
          ${itemSummary}
        </div>
        <div style="margin-top:0.45rem;">
          <span class="status-badge status-${o.status}">${statusLabel[o.status] || o.status}</span>
          <strong style="margin-left:0.8rem; color:var(--primary);">${formatPrice(o.total)} ฿</strong>
        </div>
      </div>
      <div class="order-actions">
        ${o.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o.id}', 'preparing')">เริ่มทำ</button>` : ''}
        ${o.status === 'preparing' ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o.id}', 'completed')">เสร็จแล้ว</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="viewOrderDetail('${o.id}')">รายละเอียด</button>
      </div>
    </div>`;
  }).join('');
}

function tryPlayNewOrderSound() {
  try {
    // Simple beep using Web Audio API
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // ignore if audio not allowed
  }
}

function setupOrderFilters() {
  document.querySelectorAll('.status-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOrderStatus = btn.dataset.status;
      renderOrders();
    });
  });
}

function viewOrderDetail(orderId) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const statusLabel = STATUS_LABELS;

  const body = document.getElementById('order-detail-body');
  body.innerHTML = `
    <div class="detail-row"><span>หมายเลข</span><strong>${order.id}</strong></div>
    ${order.table ? `<div class="detail-row"><span>โต๊ะ</span><strong style="font-size:1.2rem;color:var(--primary);">🪑 ${order.table}</strong></div>` : ''}
    ${order.note ? `<div class="detail-row"><span>หมายเหตุ</span><strong>${order.note}</strong></div>` : ''}
    <div class="detail-row"><span>เวลาสั่ง</span><strong>${formatDate(order.createdAt)}</strong></div>
    <div class="detail-row"><span>สถานะ</span>
      <span class="status-badge status-${order.status}">${statusLabel[order.status]}</span>
    </div>
    ${order.note ? `<div class="detail-row"><span>หมายเหตุ</span><strong>${order.note}</strong></div>` : ''}
    
    <div class="detail-items">
      <strong>รายการสินค้า</strong>
      ${order.items.map(i => `
        <div class="detail-item">
          <span>${i.name} × ${i.qty}${i.note ? '<br><small style="color:var(--primary-light);">📝 '+i.note+'</small>' : ''}</span>
          <span>${formatPrice(i.price * i.qty)} ฿</span>
        </div>
      `).join('')}
      <div class="detail-item" style="margin-top:0.5rem; font-weight:700; border-top:1px dashed #ccc; padding-top:0.5rem;">
        <span>รวมทั้งสิ้น</span>
        <span>${formatPrice(order.total)} ฿</span>
      </div>
    </div>

    <div class="status-actions">
      ${order.status !== 'preparing' && order.status !== 'completed' && order.status !== 'cancelled'
        ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${order.id}', 'preparing')">เริ่มทำ</button>` : ''}
      ${order.status === 'preparing'
        ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${order.id}', 'completed')">เสร็จแล้ว</button>` : ''}
      ${order.status !== 'completed' && order.status !== 'cancelled'
        ? `<button class="btn btn-outline btn-sm" onclick="updateOrderStatus('${order.id}', 'cancelled')" style="color:var(--danger);border-color:var(--danger);">ยกเลิก</button>` : ''}
    </div>
  `;

  document.getElementById('order-detail-modal')?.classList.add('show');
}

function closeOrderDetail() {
  document.getElementById('order-detail-modal')?.classList.remove('show');
}

async function updateOrderStatus(orderId, newStatus) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  order.status = newStatus;
  if (firebaseReady && db) {
    await db.ref('orders/' + orderId).update({ status: newStatus });
    ordersCache = orders;
  } else {
    await saveOrders(orders);
  }
  renderOrders();
  viewOrderDetail(orderId);
}

// ===== Products (Admin) =====
function renderAdminProducts() {
  const list = document.getElementById('admin-product-list');
  if (!list) return;

  const products = getProducts();
  if (products.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📦</div><p>ยังไม่มีสินค้า</p></div>`;
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="admin-product-item">
      <div class="info">
        <div class="thumb">
          ${p.image
            ? `<img src="${p.image}" alt="" onerror="this.parentElement.innerHTML='${getIcon(p.category)}'">`
            : getIcon(p.category)}
        </div>
        <div>
          <div class="name">${p.name}</div>
          <div class="meta">${p.category} · ${formatPrice(p.price)} ฿</div>
        </div>
      </div>
      <div style="display:flex; gap:0.4rem;">
        <button class="btn btn-outline btn-sm" onclick="editProduct('${p.id}')">แก้ไข</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">ลบ</button>
      </div>
    </div>
  `).join('');
}

function editProduct(id) {
  const products = getProducts();
  const p = products.find(x => x.id === id);
  if (!p) return;

  document.getElementById('edit-id').value = p.id;
  document.getElementById('product-name').value = p.name;
  document.getElementById('product-price').value = p.price;
  document.getElementById('product-category').value = p.category;
  document.getElementById('product-desc').value = p.description || '';
  document.getElementById('product-image').value = p.image || '';
  pendingImageFile = null;
  const fileInput = document.getElementById('product-image-file');
  if (fileInput) fileInput.value = '';
  showImagePreview(p.image || '');
  document.getElementById('form-title').textContent = '✏️ แก้ไขสินค้า';
  document.getElementById('submit-product').textContent = 'บันทึกการแก้ไข';
  document.getElementById('cancel-edit').style.display = 'inline-flex';

  // อยู่ในแท็บจัดการสินค้า · เลื่อนไปที่ฟอร์ม
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="products"]')?.classList.add('active');
  document.getElementById('tab-products')?.classList.add('active');
  renderCategorySelect();
  setTimeout(() => {
    document.getElementById('product-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function showImagePreview(url) {
  const box = document.getElementById('image-preview-box');
  const img = document.getElementById('image-preview');
  if (!box || !img) return;
  if (url) {
    img.src = url;
    box.style.display = 'block';
  } else {
    img.src = '';
    box.style.display = 'none';
  }
}

function clearProductImage() {
  pendingImageFile = null;
  const fileInput = document.getElementById('product-image-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('product-image').value = '';
  showImagePreview('');
}

function onImageFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    e.target.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('ไฟล์ใหญ่เกินไป (สูงสุด 5 MB)');
    e.target.value = '';
    return;
  }
  pendingImageFile = file;
  document.getElementById('product-image').value = '';
  const reader = new FileReader();
  reader.onload = (ev) => showImagePreview(ev.target.result);
  reader.readAsDataURL(file);
}

// แปลงไฟล์รูปเป็น base64 (ย่อขนาดอัตโนมัติ ไม่ต้องใช้ Storage)
function fileToBase64(file, maxWidth = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้อง'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // ใช้ jpeg เพื่อให้ไฟล์เล็กลง
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function cancelEdit() {
  document.getElementById('product-form').reset();
  document.getElementById('edit-id').value = '';
  pendingImageFile = null;
  const fileInput = document.getElementById('product-image-file');
  if (fileInput) fileInput.value = '';
  showImagePreview('');
  document.getElementById('form-title').textContent = '➕ เพิ่มสินค้าใหม่';
  document.getElementById('submit-product').textContent = 'บันทึกสินค้า';
  document.getElementById('cancel-edit').style.display = 'none';
}

async function deleteProduct(id) {
  if (!confirm('ต้องการลบสินค้านี้จริงหรือไม่?')) return;
  let products = getProducts().filter(p => p.id !== id);
  await saveProducts(products);
  renderAdminProducts();
  renderProducts();
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('product-name').value.trim();
  const price = Number(document.getElementById('product-price').value);
  const category = document.getElementById('product-category').value;
  const description = document.getElementById('product-desc').value.trim();
  let image = document.getElementById('product-image').value.trim();

  const submitBtn = document.getElementById('submit-product');
  const oldText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = pendingImageFile ? 'กำลังอัปโหลดรูป...' : 'กำลังบันทึก...';
  }

  try {
    const productId = id || generateId('p');

    // แปลงรูปเป็น base64 ถ้ามีไฟล์เลือกไว้ (ไม่ต้องใช้ Storage)
    if (pendingImageFile) {
      try {
        image = await fileToBase64(pendingImageFile);
      } catch (err) {
        console.error(err);
        alert('แปลงรูปไม่สำเร็จ: ' + (err.message || err));
        return;
      }
    }

    let products = getProducts();

    if (id) {
      const idx = products.findIndex(p => p.id === id);
      if (idx !== -1) {
        products[idx] = { ...products[idx], name, price, category, description, image };
      }
    } else {
      products.push({
        id: productId,
        name,
        price,
        category,
        description,
        image
      });
    }

    await saveProducts(products);
    pendingImageFile = null;
    cancelEdit();
    renderAdminProducts();

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="products"]')?.classList.add('active');
    document.getElementById('tab-products')?.classList.add('active');

    alert(id ? 'แก้ไขสินค้าเรียบร้อย' : 'เพิ่มสินค้าเรียบร้อย');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = oldText || 'บันทึกสินค้า';
    }
  }
}



// ===== Real-time Sync (no refresh needed) =====
let trackPollingTimer = null;
let ordersPollingTimer = null;

function startRealtimeSync() {
  // Cross-tab sync via storage event
  window.addEventListener('storage', (e) => {
    if (!e.key) return;

    if (e.key === STORAGE_KEYS.orders) {
      // Orders changed in another tab
      if (document.getElementById('orders-list')) {
        renderOrders();
      }
      // If track modal is open and has a result, refresh it
      const trackResult = document.getElementById('track-result');
      const trackInput = document.getElementById('track-order-id');
      if (trackResult && trackResult.style.display !== 'none' && trackInput?.value.trim()) {
        searchOrder();
      }
    }

    if (e.key === STORAGE_KEYS.products) {
      if (document.getElementById('product-grid')) {
        renderProducts();
      }
      if (document.getElementById('admin-product-list')) {
        renderAdminProducts();
      }
    }

    if (e.key === STORAGE_KEYS.billRequests) {
      renderBillRequestBanner();
      if (document.getElementById('tables-qr-grid')) renderTablesQR();
      updateBuyerBillButton();
    }
    if (e.key === STORAGE_KEYS.cart) {
      updateCartUI();
      if (document.getElementById('cart-modal')?.classList.contains('show')) {
        renderCartItems();
      }
    }
  });
}

function startOrdersPolling() {
  stopOrdersPolling();
  // Light polling every 2s while on admin orders tab (same-tab + reliability)
  ordersPollingTimer = setInterval(() => {
    if (document.getElementById('tab-orders')?.classList.contains('active') ||
        document.getElementById('admin-dashboard')?.style.display !== 'none') {
      renderOrders();
    }
  }, 1500);
}

function stopOrdersPolling() {
  if (ordersPollingTimer) {
    clearInterval(ordersPollingTimer);
    ordersPollingTimer = null;
  }
}

function startTrackPolling() {
  stopTrackPolling();
  trackPollingTimer = setInterval(() => {
    const trackResult = document.getElementById('track-result');
    const modal = document.getElementById('track-modal');
    if (!modal?.classList.contains('show') || !trackResult) return;
    const trackInput = document.getElementById('track-order-id');
    if (trackInput?.value.trim()) {
      searchOrder();
    } else if (getCurrentTable()) {
      renderTableOrders(getCurrentTable());
    }
  }, 1500);
}

function stopTrackPolling() {
  if (trackPollingTimer) {
    clearInterval(trackPollingTimer);
    trackPollingTimer = null;
  }
}


// ===== Track Order (Buyer) =====
function openTrack() {
  const table = getCurrentTable();
  document.getElementById('track-modal')?.classList.add('show');
  startTrackPolling();

  // ถ้ามีโต๊ะที่เลือกอยู่ → แสดงออเดอร์ของโต๊ะนั้นทันที
  if (table) {
    const input = document.getElementById('track-order-id');
    if (input) {
      input.value = '';
      input.placeholder = 'หรือค้นหาด้วยหมายเลขออเดอร์';
    }
    renderTableOrders(table);
  } else {
    document.getElementById('track-order-id').value = '';
    document.getElementById('track-result').style.display = 'none';
  }
}

function closeTrack() {
  document.getElementById('track-modal')?.classList.remove('show');
  stopTrackPolling();
}

function renderTableOrders(tableNum) {
  const resultEl = document.getElementById('track-result');
  if (!resultEl) return;

  const orders = getOrders().filter(o =>
    Number(o.table) === Number(tableNum) && !o.settled
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  resultEl.style.display = 'block';

  if (orders.length === 0) {
    resultEl.innerHTML = `
      <div class="track-not-found">
        <div class="icon">🪑</div>
        <p>โต๊ะ ${tableNum} ยังไม่มีออเดอร์<br><small>เมื่อสั่งซื้อแล้ว สถานะจะขึ้นที่นี่</small></p>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:1rem;" onclick="finishTracking()">
        ← กลับไปเลือกสินค้า
      </button>`;
    return;
  }

  const statusMap = STATUS_META;

  const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const grandTotal = orders.reduce((s, o) => s + (o.total || 0), 0);

  const cards = orders.map(order => {
    const st = statusMap[order.status] || statusMap.pending;
    const itemsHtml = (order.items || []).map(i =>
      `<div style="display:flex;justify-content:space-between;font-size:0.88rem;padding:0.15rem 0;">
        <span>${i.name} × ${i.qty}${i.note ? ' <small style="color:var(--text-muted);">(📝 '+i.note+')</small>' : ''}</span>
        <span>${formatPrice(i.price * i.qty)} ฿</span>
      </div>`
    ).join('');

    return `
      <div class="track-status-card" style="margin-bottom:0.8rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <strong style="font-size:1.05rem;">#${order.id}</strong>
          <span style="background:${st.color};color:#fff;padding:0.2rem 0.6rem;border-radius:12px;font-size:0.82rem;font-weight:600;">
            ${st.icon} ${st.label}
          </span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.4rem;">${formatDate(order.createdAt)}</div>
        ${itemsHtml}
        <div style="text-align:right;font-weight:700;color:var(--primary);margin-top:0.3rem;padding-top:0.3rem;border-top:1px dashed var(--border);">
          ${formatPrice(order.total)} ฿
        </div>
      </div>`;
  }).join('');

  resultEl.innerHTML = `
    <div class="track-live-badge" style="margin-bottom:0.8rem;">🔴 สด · โต๊ะ ${tableNum} · อัปเดต ${now}</div>
    ${cards}
    <div style="background:var(--accent-soft,#f5e6d3);border-radius:12px;padding:0.8rem;margin-bottom:0.8rem;">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;">
        <span>รวมทั้งสิ้น (${orders.length} ออเดอร์)</span>
        <span style="color:var(--primary);">${formatPrice(grandTotal)} ฿</span>
      </div>
    </div>
    <button class="btn btn-primary btn-block" onclick="finishTracking()">
      ✅ เสร็จสิ้น · กลับไปเลือกสินค้า
    </button>`;
}

function searchOrder() {
  const orderId = document.getElementById('track-order-id')?.value.trim();
  const resultEl = document.getElementById('track-result');
  if (!resultEl) return;

  // ถ้าไม่ได้กรอกหมายเลข แต่มีโต๊ะ → แสดงออเดอร์โต๊ะ
  if (!orderId) {
    const table = getCurrentTable();
    if (table) {
      renderTableOrders(table);
      return;
    }
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="track-not-found">
        <div class="icon">🔍</div>
        <p>กรุณาเลือกโต๊ะ หรือกรอกหมายเลขออเดอร์</p>
      </div>`;
    return;
  }

  const orders = getOrders();
  const order = orders.find(o => o.id.toLowerCase() === orderId.toLowerCase());

  resultEl.style.display = 'block';

  if (!order) {
    resultEl.innerHTML = `
      <div class="track-not-found">
        <div class="icon">😕</div>
        <p>ไม่พบออเดอร์นี้<br><small>กรุณาตรวจสอบหมายเลขอีกครั้ง</small></p>
      </div>`;
    return;
  }

  const statusMap = STATUS_META;

  const st = statusMap[order.status] || statusMap.pending;
  const isCancelled = order.status === 'cancelled';

  let timelineHtml = '';
  if (!isCancelled) {
    timelineHtml = `
      <div class="track-timeline">
        <div class="track-step ${st.step >= 1 ? (st.step > 1 ? 'done' : 'active') : ''}">
          <div class="track-step-dot">${st.step > 1 ? '✓' : '1'}</div>
          <div class="track-step-label">รับออเดอร์</div>
        </div>
        <div class="track-step ${st.step >= 2 ? (st.step > 2 ? 'done' : 'active') : ''}">
          <div class="track-step-dot">${st.step > 2 ? '✓' : '2'}</div>
          <div class="track-step-label">กำลังทำ</div>
        </div>
        <div class="track-step ${st.step >= 3 ? 'active' : ''}">
          <div class="track-step-dot">${st.step >= 3 ? '✓' : '3'}</div>
          <div class="track-step-label">เสร็จแล้ว</div>
        </div>
      </div>`;
  }

  const itemsHtml = order.items.map(i =>
    `<div class="track-info-row"><span>${i.name} × ${i.qty}${i.note ? ' <small style="color:var(--primary-light);">(📝 '+i.note+')</small>' : ''}</span><span>${formatPrice(i.price * i.qty)} ฿</span></div>`
  ).join('');

  const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  resultEl.innerHTML = `
    <div class="track-status-card">
      <div class="track-live-badge">🔴 สด · อัปเดต ${now}</div>
      <div class="track-status-icon">${st.icon}</div>
      <div class="track-status-label" style="color: ${isCancelled ? 'var(--danger)' : 'var(--primary)'}">${st.label}</div>
      <div class="track-status-desc">${st.desc}</div>
      ${timelineHtml}
      <div class="track-info-list">
        <div class="track-info-row"><span>หมายเลข</span><strong>${order.id}</strong></div>
        ${order.table ? `<div class="track-info-row"><span>โต๊ะ</span><strong style="color:var(--primary);">🪑 ${order.table}</strong></div>` : ''}
        <div class="track-info-row"><span>เวลาสั่ง</span><strong>${formatDate(order.createdAt)}</strong></div>
        ${order.note ? `<div class="track-info-row"><span>หมายเหตุ</span><strong>${order.note}</strong></div>` : ''}
        <div style="margin-top:0.6rem; padding-top:0.5rem; border-top:1px dashed var(--border);">
          <strong style="font-size:0.85rem; color:var(--text-muted);">รายการ</strong>
          ${itemsHtml}
          <div class="track-info-row" style="margin-top:0.4rem; font-weight:700;">
            <span>รวม</span><span style="color:var(--primary);">${formatPrice(order.total)} ฿</span>
          </div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:1rem;" onclick="finishTracking()">
        ✅ เสร็จสิ้น · กลับไปเลือกสินค้า
      </button>
    </div>`;
}

function finishTracking() {
  closeTrack();
  // scroll to products
  const grid = document.getElementById('product-grid');
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== Tables / QR (Admin) =====
function getBuyerBaseUrl() {
  // สร้าง URL หน้าลูกค้าจากหน้า admin
  let path = window.location.pathname;
  if (path.endsWith('admin.html')) {
    path = path.replace(/admin\.html$/, 'index.html');
  } else if (path.endsWith('/')) {
    path = path + 'index.html';
  } else {
    path = path.replace(/\/[^/]*$/, '/index.html');
  }
  return window.location.origin + path;
}


// ===== Bill Requests (Buyer → Seller notify) =====
function getBillRequests() {
  if (firebaseReady) return { ...billRequestsCache };
  try {
    const data = localStorage.getItem(STORAGE_KEYS.billRequests);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

async function saveBillRequests(obj) {
  if (firebaseReady && db) {
    await db.ref('billRequests').set(obj && Object.keys(obj).length ? obj : null);
    billRequestsCache = obj || {};
  } else {
    localStorage.setItem(STORAGE_KEYS.billRequests, JSON.stringify(obj || {}));
  }
  renderBillRequestBanner();
  if (document.getElementById('tables-qr-grid')) renderTablesQR();
}

function aggregateTableItems(orders) {
  const itemMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(i => {
      const key = i.name + '|' + (i.note || '');
      if (!itemMap[key]) {
        itemMap[key] = { name: i.name, note: i.note || '', qty: 0, price: i.price, sub: 0 };
      }
      itemMap[key].qty += i.qty;
      itemMap[key].sub += i.price * i.qty;
    });
  });
  return Object.values(itemMap);
}

function openBuyerBillModal() {
  const table = getCurrentTable();
  const modal = document.getElementById('buyer-bill-modal');
  const body = document.getElementById('buyer-bill-body');
  const title = document.getElementById('buyer-bill-title');
  if (!modal || !body) return;

  if (!table) {
    openTablePicker();
    return;
  }

  const orders = getTableUnsettledOrders(table);
  const total = getTableBillTotal(table);
  if (title) title.textContent = `🧾 เช็คบิลโต๊ะ ${table}`;

  if (orders.length === 0) {
    body.innerHTML = `
      <div class="empty-state" style="padding:1.2rem 0;">
        <div class="icon">✨</div>
        <p>ยังไม่มีรายการของโต๊ะ ${table}<br><small>สั่งสินค้าก่อน แล้วค่อยเช็คบิล</small></p>
      </div>`;
    modal.classList.add('show');
    return;
  }

  const items = aggregateTableItems(orders);
  const itemsHtml = items.map(i => `
    <div class="detail-item">
      <span>${i.name} × ${i.qty}${i.note ? ' <small style="color:var(--primary-light);">(📝 '+i.note+')</small>' : ''}</span>
      <span>${formatPrice(i.sub)} ฿</span>
    </div>`).join('');

  const ordersHtml = orders.map(o => `
    <div style="padding:0.45rem 0; border-bottom:1px dashed var(--border); font-size:0.88rem;">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;">
        <span><strong>#${o.id}</strong>
          <span class="status-badge status-${o.status}" style="margin-left:0.35rem;">${STATUS_LABELS[o.status] || o.status}</span>
        </span>
        <span style="font-weight:600;color:var(--primary);">${formatPrice(o.total)} ฿</span>
      </div>
    </div>`).join('');

  const reqs = getBillRequests();
  const already = reqs[String(table)] && reqs[String(table)].status === 'pending';

  body.innerHTML = `
    <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:0.8rem;">
      สรุปรายการทั้งหมดของ <strong>โต๊ะ ${table}</strong> ที่ยังไม่ชำระ
    </p>
    <div style="margin-bottom:0.9rem;">
      <h4 style="margin:0 0 0.4rem;font-size:0.9rem;color:var(--text-muted);">ออเดอร์ (${orders.length})</h4>
      ${ordersHtml}
    </div>
    <div style="background:var(--accent-soft,#f5e6d3);border-radius:12px;padding:0.85rem;margin-bottom:1rem;">
      <h4 style="margin:0 0 0.5rem;font-size:0.95rem;">รายการสินค้า</h4>
      ${itemsHtml}
      <div class="detail-item" style="margin-top:0.55rem;padding-top:0.55rem;border-top:2px solid var(--primary);font-weight:800;font-size:1.15rem;">
        <span>รวมทั้งสิ้น</span>
        <span style="color:var(--primary);">${formatPrice(total)} ฿</span>
      </div>
    </div>
    ${already ? `
      <div style="background:#E6F6ED;color:#0D7A3F;border-radius:10px;padding:0.75rem;text-align:center;margin-bottom:0.8rem;font-weight:600;">
        ✅ แจ้งเช็คบิลไปแล้ว · รอพนักงานมารับชำระ
      </div>
      <button type="button" class="btn btn-outline btn-block" onclick="closeBuyerBillModal()">ปิด</button>
    ` : `
      <button type="button" class="btn btn-primary btn-block" id="confirm-buyer-bill-btn">
        🧾 ยืนยันเรียกเช็คบิล · ${formatPrice(total)} ฿
      </button>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.6rem;text-align:center;">
        กดยืนยันแล้วจะแจ้งเตือนไปที่หน้าผู้ขาย
      </p>
    `}
  `;

  modal.classList.add('show');
  document.getElementById('confirm-buyer-bill-btn')?.addEventListener('click', () => confirmBuyerBill(table));
}

function closeBuyerBillModal() {
  document.getElementById('buyer-bill-modal')?.classList.remove('show');
}

async function confirmBuyerBill(tableNum) {
  const orders = getTableUnsettledOrders(tableNum);
  const total = getTableBillTotal(tableNum);
  if (orders.length === 0) {
    alert('ไม่มีรายการให้เช็คบิล');
    return;
  }

  const ok = confirm(
    `ยืนยันเรียกเช็คบิลโต๊ะ ${tableNum}?\n\n` +
    `จำนวน ${orders.length} ออเดอร์\n` +
    `ยอดรวม ${formatPrice(total)} บาท\n\n` +
    `ระบบจะแจ้งเตือนไปที่ผู้ขาย`
  );
  if (!ok) return;

  const items = aggregateTableItems(orders);
  const reqs = getBillRequests();
  reqs[String(tableNum)] = {
    table: Number(tableNum),
    total,
    orderCount: orders.length,
    orderIds: orders.map(o => o.id),
    items,
    requestedAt: new Date().toISOString(),
    status: 'pending'
  };
  await saveBillRequests(reqs);

  // ทำเครื่องหมายบนออเดอร์ว่าลูกค้าเรียกเช็คบิลแล้ว
  const all = getOrders();
  const idSet = new Set(orders.map(o => o.id));
  let changed = false;
  all.forEach(o => {
    if (idSet.has(o.id) && !o.billRequested) {
      o.billRequested = true;
      o.billRequestedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) await saveOrders(all);

  closeBuyerBillModal();
  alert(`แจ้งเช็คบิลโต๊ะ ${tableNum} เรียบร้อยแล้ว\nยอด ${formatPrice(total)} บาท\nรอพนักงานมารับชำระเงินครับ ☕`);
  updateBuyerBillButton();
}

function updateBuyerBillButton() {
  const btn = document.getElementById('buyer-bill-btn');
  if (!btn) return;
  const table = getCurrentTable();
  if (table) {
    btn.style.display = '';
    const total = getTableBillTotal(table);
    const reqs = getBillRequests();
    const pending = reqs[String(table)]?.status === 'pending';
    btn.innerHTML = pending
      ? `🧾 รอเช็คบิล`
      : (total > 0 ? `🧾 เช็คบิล` : `🧾 เช็คบิล`);
    if (pending) btn.classList.add('bill-pending');
    else btn.classList.remove('bill-pending');
  } else {
    btn.style.display = 'none';
  }
}

function renderBillRequestBanner() {
  const banner = document.getElementById('bill-request-banner');
  const listEl = document.getElementById('bill-request-list');
  if (!banner || !listEl) return;

  const reqs = getBillRequests();
  const pending = Object.values(reqs).filter(r => r && r.status === 'pending')
    .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));

  if (pending.length === 0) {
    banner.style.display = 'none';
    return;
  }

  listEl.innerHTML = pending.map(r =>
    `<button type="button" class="bill-req-chip" onclick="openTableBill(${r.table})">โต๊ะ ${r.table} · ${formatPrice(r.total)} ฿</button>`
  ).join(' ');
  banner.style.display = 'block';
}

function getTableUnsettledOrders(tableNum) {
  return getOrders().filter(o =>
    Number(o.table) === Number(tableNum) &&
    !o.settled &&
    o.status !== 'cancelled'
  );
}

function getTableBillTotal(tableNum) {
  return getTableUnsettledOrders(tableNum).reduce((s, o) => s + (o.total || 0), 0);
}

function renderTablesQR() {
  const grid = document.getElementById('tables-qr-grid');
  if (!grid) return;

  // ให้แน่ใจว่าทุกโต๊ะมี session token
  const sessions = getTableSessions();
  let needSeed = false;
  for (let i = 1; i <= TOTAL_TABLES; i++) {
    if (!sessions[String(i)]) {
      sessions[String(i)] = generateSessionToken();
      needSeed = true;
    }
  }
  if (needSeed) {
    saveTableSessions(sessions).catch(err => console.error(err));
  }

  grid.innerHTML = '';

  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const url = getTableOrderUrl(i);
    const unsettled = getTableUnsettledOrders(i);
    const total = getTableBillTotal(i);
    const hasBill = unsettled.length > 0;
    const reqs = getBillRequests();
    const billReq = reqs[String(i)] && reqs[String(i)].status === 'pending';
    const token = getTableSessionToken(i);

    const card = document.createElement('div');
    card.className = 'table-qr-card' + (hasBill ? ' has-bill' : '') + (billReq ? ' bill-requested' : '');
    card.innerHTML = `
      <div class="table-qr-title">
        โต๊ะ ${i}
        ${billReq ? `<span class="bill-req-badge" title="ลูกค้าเรียกเช็คบิล">🔔 เรียกบิล</span>` : ''}
        ${hasBill ? `<span class="bill-dot" title="มีบิลค้าง">${unsettled.length}</span>` : ''}
      </div>
      <div class="table-qr-code" id="qr-table-${i}"></div>
      <div class="table-qr-url" title="${url}">${url.length > 48 ? url.slice(0, 48) + '…' : url}</div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.25rem;">รหัส: ${token ? token.slice(0, 6) : '-'}</div>
      ${hasBill ? `<div class="table-bill-amount">${formatPrice(total)} ฿</div>` : ''}
      <div style="display:flex; gap:0.35rem; justify-content:center; flex-wrap:wrap; margin-top:0.4rem;">
        <button class="btn btn-outline btn-sm" onclick="downloadTableQR(${i})" title="ดาวน์โหลดรูป QR">⬇️</button>
        <button class="btn btn-outline btn-sm" onclick="printTableQR(${i})" title="พิมพ์ QR">🖨️</button>
        <button class="btn ${hasBill ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="openTableBill(${i})">
          🧾 เช็คบิล
        </button>
      </div>
    `;
    grid.appendChild(card);

    const el = card.querySelector(`#qr-table-${i}`);
    if (typeof QRCode !== 'undefined') {
      new QRCode(el, {
        text: url,
        width: 120,
        height: 120,
        colorDark: '#3d2314',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      el.innerHTML = '<small style="color:red;">โหลด QR lib ไม่สำเร็จ</small>';
    }
  }
}


// ===== Print receipt PDF (80mm thermal style) =====
function buildReceiptHtml(tableNum, orders, items, total) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit'
  });
  const orderIds = orders.map(o => o.id).join(', ');

  const lines = items.map(i => {
    const name = i.note ? `${i.name} (${i.note})` : i.name;
    return `
      <tr>
        <td style="padding:3px 0;vertical-align:top;width:58%;">${name}</td>
        <td style="padding:3px 0;text-align:center;vertical-align:top;width:14%;">${i.qty}</td>
        <td style="padding:3px 0;text-align:right;vertical-align:top;width:28%;">${formatPrice(i.sub)}</td>
      </tr>`;
  }).join('');

  return `
  <div id="receipt-print-root" style="
    font-family: 'Sarabun', 'Tahoma', sans-serif;
    width: 72mm;
    padding: 4mm 3mm;
    color: #1a1a1a;
    font-size: 11px;
    line-height: 1.35;
    box-sizing: border-box;
  ">
    <div style="text-align:center;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:700;letter-spacing:0.5px;">☕ Coffee House</div>
      <div style="font-size:10px;color:#444;margin-top:2px;">ใบเสร็จรับเงิน / Receipt</div>
    </div>
    <div style="border-top:1px dashed #333;border-bottom:1px dashed #333;padding:6px 0;margin-bottom:6px;font-size:10px;">
      <div style="display:flex;justify-content:space-between;"><span>โต๊ะ</span><strong>${tableNum}</strong></div>
      <div style="display:flex;justify-content:space-between;"><span>วันที่</span><span>${dateStr}</span></div>
      <div style="display:flex;justify-content:space-between;"><span>เวลา</span><span>${timeStr}</span></div>
      <div style="display:flex;justify-content:space-between;gap:6px;"><span>ออเดอร์</span><span style="text-align:right;word-break:break-all;">${orderIds}</span></div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="border-bottom:1px solid #333;">
          <th style="text-align:left;padding:2px 0;font-weight:600;">รายการ</th>
          <th style="text-align:center;padding:2px 0;font-weight:600;">จำนวน</th>
          <th style="text-align:right;padding:2px 0;font-weight:600;">ราคา</th>
        </tr>
      </thead>
      <tbody>
        ${lines}
      </tbody>
    </table>
    <div style="border-top:1px dashed #333;margin-top:6px;padding-top:6px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;">
        <span>รวมทั้งสิ้น</span>
        <span>${formatPrice(total)} บาท</span>
      </div>
      <div style="font-size:10px;color:#555;margin-top:2px;">
        ${orders.length} ออเดอร์ · ${items.reduce((s, i) => s + i.qty, 0)} ชิ้น
      </div>
    </div>
    <div style="text-align:center;margin-top:12px;font-size:10px;color:#555;">
      ขอบคุณที่อุดหนุนครับ/ค่ะ<br/>Thank you
    </div>
  </div>`;
}

async function printTableReceipt(tableNum, options = {}) {
  const silent = !!options.silent;
  const orders = options.orders || getTableUnsettledOrders(tableNum);
  if (!orders.length) {
    if (!silent) alert('ไม่มีรายการสำหรับพิมพ์ใบเสร็จ');
    return false;
  }
  const total = options.total != null
    ? options.total
    : orders.reduce((s, o) => s + (o.total || 0), 0);
  const items = options.items || (
    typeof aggregateTableItems === 'function'
      ? aggregateTableItems(orders)
      : (() => {
          const map = {};
          orders.forEach(o => (o.items || []).forEach(i => {
            const k = i.name + '|' + (i.note || '');
            if (!map[k]) map[k] = { name: i.name, note: i.note || '', qty: 0, price: i.price, sub: 0 };
            map[k].qty += i.qty;
            map[k].sub += i.price * i.qty;
          }));
          return Object.values(map);
        })()
  );

  if (typeof html2pdf === 'undefined') {
    if (!silent) alert('โหลดไลบรารี PDF ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่');
    return false;
  }

  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-9999px';
  wrap.style.top = '0';
  wrap.style.background = '#fff';
  wrap.innerHTML = buildReceiptHtml(tableNum, orders, items, total);
  document.body.appendChild(wrap);

  const root = wrap.querySelector('#receipt-print-root');
  const baseH = 55;
  const lineH = 7;
  const pageH = Math.max(80, baseH + items.length * lineH + 15);

  const opt = {
    margin: [2, 2, 2, 2],
    filename: `receipt-table-${tableNum}-${Date.now()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    },
    jsPDF: {
      unit: 'mm',
      format: [80, pageH],
      orientation: 'portrait'
    },
    pagebreak: { mode: ['avoid-all'] }
  };

  try {
    const btn = document.getElementById('print-receipt-btn');
    const clearBtn = document.getElementById('clear-bill-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ กำลังสร้าง PDF...';
    }
    if (clearBtn) {
      clearBtn.disabled = true;
      clearBtn.textContent = '⏳ พิมพ์ใบเสร็จก่อน...';
    }
    await html2pdf().set(opt).from(root).save();
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) alert('สร้าง PDF ไม่สำเร็จ: ' + (err.message || err));
    return false;
  } finally {
    wrap.remove();
    const btn = document.getElementById('print-receipt-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🖨️ พิมพ์ใบเสร็จ PDF';
    }
    const clearBtn = document.getElementById('clear-bill-btn');
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.textContent = `✅ เคลียร์บิลโต๊ะ ${tableNum}`;
    }
  }
}

function openTableBill(tableNum) {
  const orders = getTableUnsettledOrders(tableNum);
  const total = getTableBillTotal(tableNum);
  const title = document.getElementById('bill-modal-title');
  const body = document.getElementById('bill-modal-body');
  if (!body) return;

  if (title) title.textContent = `🧾 เช็คบิลโต๊ะ ${tableNum}`;

  if (orders.length === 0) {
    body.innerHTML = `
      <div class="empty-state" style="padding:1.5rem 0;">
        <div class="icon">✨</div>
        <p>โต๊ะ ${tableNum} ไม่มีบิลค้าง<br><small>ยังไม่มีออเดอร์ หรือเคลียร์บิลแล้ว</small></p>
      </div>`;
    document.getElementById('bill-modal')?.classList.add('show');
    return;
  }

  // รวมรายการสินค้าทั้งหมด
  const itemMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(i => {
      const key = i.name + '|' + (i.note || '');
      if (!itemMap[key]) {
        itemMap[key] = { name: i.name, note: i.note || '', qty: 0, price: i.price, sub: 0 };
      }
      itemMap[key].qty += i.qty;
      itemMap[key].sub += i.price * i.qty;
    });
  });
  const items = Object.values(itemMap);

  const ordersHtml = orders.map(o => `
    <div style="padding:0.5rem 0; border-bottom:1px dashed var(--border); font-size:0.9rem;">
      <div style="display:flex; justify-content:space-between;">
        <strong>#${o.id}</strong>
        <span class="status-badge status-${o.status}">${
          STATUS_LABELS[o.status] || o.status
        }</span>
      </div>
      <div style="color:var(--text-muted); margin-top:0.2rem;">
        ${(o.items || []).map(i => `${i.name}×${i.qty}`).join(', ')}
      </div>
      <div style="text-align:right; font-weight:600; color:var(--primary);">${formatPrice(o.total)} ฿</div>
    </div>
  `).join('');

  const summaryHtml = items.map(i => `
    <div class="detail-item">
      <span>${i.name} × ${i.qty}${i.note ? ' <small>(📝 '+i.note+')</small>' : ''}</span>
      <span>${formatPrice(i.sub)} ฿</span>
    </div>
  `).join('');

  body.innerHTML = `
    <div style="margin-bottom:1rem;">
      <h4 style="margin:0 0 0.5rem; font-size:0.95rem;">ออเดอร์ที่ยังไม่เคลียร์ (${orders.length})</h4>
      ${ordersHtml}
    </div>
    <div style="background:var(--accent-soft,#f5e6d3); border-radius:12px; padding:0.8rem; margin-bottom:1rem;">
      <h4 style="margin:0 0 0.5rem; font-size:0.95rem;">สรุปรายการ</h4>
      ${summaryHtml}
      <div class="detail-item" style="margin-top:0.5rem; padding-top:0.5rem; border-top:2px solid var(--primary); font-weight:800; font-size:1.15rem;">
        <span>รวมทั้งสิ้น</span>
        <span style="color:var(--primary);">${formatPrice(total)} ฿</span>
      </div>
    </div>
    ${(() => {
      const r = getBillRequests()[String(tableNum)];
      if (r && r.status === 'pending') {
        const t = r.requestedAt ? new Date(r.requestedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div style="background:#FFF4E5;color:#C47A00;border-radius:10px;padding:0.7rem;margin-bottom:0.8rem;font-weight:600;text-align:center;">
          🔔 ลูกค้าเรียกเช็คบิลแล้ว${t ? ' · ' + t + ' น.' : ''}
        </div>`;
      }
      return '';
    })()}
    <div style="display:flex; flex-direction:column; gap:0.5rem;">
      <button type="button" class="btn btn-outline btn-block" id="print-receipt-btn" onclick="printTableReceipt(${tableNum})">
        🖨️ พิมพ์ใบเสร็จ PDF
      </button>
      <button type="button" class="btn btn-primary btn-block" id="clear-bill-btn" onclick="clearTableBill(${tableNum})">
        ✅ เคลียร์บิลโต๊ะ ${tableNum}
      </button>
    </div>
    <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.6rem; text-align:center;">
      กดพิมพ์ใบเสร็จ PDF ก่อน แล้วค่อยเคลียร์บิลเมื่อชำระเงินแล้ว
    </p>
  `;

  document.getElementById('bill-modal')?.classList.add('show');
}

function closeBillModal() {
  document.getElementById('bill-modal')?.classList.remove('show');
}

async function clearTableBill(tableNum) {
  const orders = getTableUnsettledOrders(tableNum);
  if (orders.length === 0) {
    closeBillModal();
    return;
  }
  const total = getTableBillTotal(tableNum);
  if (!confirm(
    `ยืนยันเคลียร์บิลโต๊ะ ${tableNum}?\n\n` +
    `จำนวน ${orders.length} ออเดอร์\n` +
    `ยอดรวม ${formatPrice(total)} บาท\n\n` +
    `(ออเดอร์จะถูกทำเครื่องหมายว่าชำระแล้ว)`
  )) {
    return;
  }

  const all = getOrders();
  const ids = new Set(orders.map(o => o.id));
  all.forEach(o => {
    if (ids.has(o.id)) {
      o.settled = true;
      o.settledAt = new Date().toISOString();
      if (o.status === 'pending' || o.status === 'preparing') {
        o.status = 'completed';
      }
    }
  });
  await saveOrders(all);

  const reqs = getBillRequests();
  if (reqs[String(tableNum)]) {
    delete reqs[String(tableNum)];
    await saveBillRequests(reqs);
  }

  // เปลี่ยน QR ของโต๊ะนี้ (session token ใหม่) — QR เก่าใช้สั่งไม่ได้อีก
  await rotateTableSession(tableNum);

  closeBillModal();
  renderOrders();
  renderTablesQR();
  renderBillRequestBanner();
  alert(`เคลียร์บิลโต๊ะ ${tableNum} เรียบร้อย\nยอด ${formatPrice(total)} บาท\n\n🔄 QR โต๊ะนี้ถูกเปลี่ยนแล้ว\nพิมพ์ QR ใหม่ติดโต๊ะได้เลย`);
}

function getQrDataUrl(tableNum) {
  const el = document.getElementById(`qr-table-${tableNum}`);
  if (!el) return null;
  const img = el.querySelector('img');
  const canvas = el.querySelector('canvas');
  if (img && img.src) return img.src;
  if (canvas) return canvas.toDataURL('image/png');
  return null;
}

function downloadTableQR(tableNum) {
  const dataUrl = getQrDataUrl(tableNum);
  if (!dataUrl) {
    alert('ยังไม่มี QR ให้ดาวน์โหลด');
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `table-${tableNum}-qr.png`;
  a.click();
}

/** พิมพ์ QR โค้ดของโต๊ะ (เปิดหน้าต่างพิมพ์ พร้อมชื่อร้าน + หมายเลขโต๊ะ) */
function printTableQR(tableNum) {
  const dataUrl = getQrDataUrl(tableNum);
  const url = getTableOrderUrl(tableNum);
  const token = getTableSessionToken(tableNum) || '-';
  const w = window.open('', '_blank', 'width=420,height=580');
  if (!w) {
    alert('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ (ถูกบล็อกป๊อปอัป)');
    return;
  }
  const safeUrl = String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const qrBlock = dataUrl
    ? '<img id="qr-img" src="' + dataUrl + '" alt="QR โต๊ะ ' + tableNum + '" width="220" height="220" />'
    : '<div id="qr-print-target" style="width:220px;height:220px;margin:0 auto;"></div>';
  const needLib = !dataUrl;
  const html = [
    '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>',
    '<title>พิมพ์ QR โต๊ะ ' + tableNum + '</title>',
    needLib ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>' : '',
    '<style>',
    '@page { margin: 8mm; size: A6; }',
    '* { box-sizing: border-box; }',
    "body { font-family: Sarabun, Tahoma, sans-serif; text-align: center; color: #2c1810; margin: 0; padding: 16px; background: #fff; }",
    '.card { border: 2px solid #5D4037; border-radius: 16px; padding: 22px 16px; max-width: 320px; margin: 0 auto; }',
    '.brand { font-size: 22px; font-weight: 700; margin-bottom: 4px; }',
    '.sub { font-size: 12px; color: #666; margin-bottom: 10px; }',
    '.table-no { font-size: 28px; font-weight: 800; margin: 6px 0 14px; color: #5D4037; }',
    '.qr-wrap { display: flex; justify-content: center; align-items: center; min-height: 220px; margin-bottom: 10px; }',
    '.hint { font-size: 12px; color: #555; line-height: 1.45; }',
    '.token { font-size: 10px; color: #999; margin-top: 8px; word-break: break-all; }',
    '.actions { margin-top: 18px; }',
    '.actions button { font-family: inherit; font-size: 14px; padding: 8px 18px; border-radius: 8px; border: 1px solid #5D4037; background: #5D4037; color: #fff; cursor: pointer; margin: 0 4px; }',
    '.actions button.secondary { background: #fff; color: #5D4037; }',
    '@media print { .actions { display: none !important; } body { padding: 0; } }',
    '</style></head><body>',
    '<div class="card">',
    '<div class="brand">☕ Coffee House</div>',
    '<div class="sub">สแกนเพื่อสั่งอาหาร</div>',
    '<div class="table-no">โต๊ะ ' + tableNum + '</div>',
    '<div class="qr-wrap">' + qrBlock + '</div>',
    '<div class="hint">เปิดกล้องมือถือสแกน QR<br/>แล้วเลือกเมนูได้เลย</div>',
    '<div class="token">รหัส: ' + token + '</div>',
    '</div>',
    '<div class="actions">',
    '<button onclick="window.print()">🖨️ พิมพ์</button>',
    '<button class="secondary" onclick="window.close()">ปิด</button>',
    '</div>',
    '<script>(function(){',
    "var url = '" + safeUrl + "';",
    'function tryMake(){',
    "var el = document.getElementById('qr-print-target');",
    'if (!el) return;',
    "if (typeof QRCode === 'undefined') { setTimeout(tryMake, 200); return; }",
    "new QRCode(el, { text: url, width: 220, height: 220, colorDark: '#3d2314', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });",
    '}',
    "if (document.getElementById('qr-print-target')) tryMake();",
    '})();<\/script>',
    '</body></html>'
  ].join('');
  w.document.write(html);
  w.document.close();
  setTimeout(function() { try { w.focus(); } catch (e) {} }, 250);
}




// ===== Reset ทั้งหมด (ต้องใส่รหัสผ่าน) =====
async function resetAllData() {
  const pw = prompt('กรุณากรอกรหัสผ่านเพื่อรีเซ็ตออเดอร์:\n(รหัสเดียวกับหน้าผู้ขาย)');
  if (pw === null) return;
  if (pw !== 'admin123') {
    alert('รหัสผ่านไม่ถูกต้อง');
    return;
  }
  if (!confirm('ยืนยันรีเซ็ตออเดอร์?\n\n- ออเดอร์ทั้งหมดจะถูกลบ\n- คำขอเช็คบิลจะถูกลบ\n- ตะกร้าจะว่าง\n- หมายเลขออเดอร์เริ่มที่ 000 ใหม่\n- QR ทุกโต๊ะจะถูกสร้างใหม่\n\n(สินค้าและหมวดหมู่จะไม่ถูกรีเซ็ต)')) {
    return;
  }

  if (firebaseReady && db) {
    await db.ref('orders').set(null);
    await db.ref('billRequests').set(null);
    await db.ref('meta/orderCounter').set(0);
    const seeded = {};
    for (let i = 1; i <= TOTAL_TABLES; i++) seeded[String(i)] = generateSessionToken();
    await db.ref('tableSessions').set(seeded);
    ordersCache = [];
    billRequestsCache = {};
    tableSessionsCache = seeded;
  } else {
    localStorage.removeItem(STORAGE_KEYS.orders);
    localStorage.removeItem(STORAGE_KEYS.billRequests);
    localStorage.removeItem('coffee_order_counter');
    const seeded = {};
    for (let i = 1; i <= TOTAL_TABLES; i++) seeded[String(i)] = generateSessionToken();
    localStorage.setItem(STORAGE_KEYS.tableSessions, JSON.stringify(seeded));
  }
  localStorage.removeItem(STORAGE_KEYS.cart);
  localStorage.removeItem(STORAGE_KEYS.tableSession);

  alert('รีเซ็ตออเดอร์เรียบร้อยแล้ว');
  location.reload();
}

// ===== Init =====
function initBuyer() {
  initFirebase();
  if (firebaseReady) {
    startFirebaseListeners();
  } else {
    startRealtimeSync(); // fallback localStorage cross-tab
  }
  renderTableBadge();
  renderProducts();
  setupFilters();
  updateCartUI();
  updateBuyerBillButton();

  document.getElementById('buyer-bill-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openBuyerBillModal();
  });
  document.getElementById('close-buyer-bill')?.addEventListener('click', closeBuyerBillModal);

  document.getElementById('cart-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openCart();
  });
  document.getElementById('close-cart')?.addEventListener('click', closeCart);
  document.getElementById('checkout-btn')?.addEventListener('click', openCheckout);
  document.getElementById('close-checkout')?.addEventListener('click', closeCheckout);
  document.getElementById('checkout-form')?.addEventListener('submit', placeOrder);
  document.getElementById('close-success')?.addEventListener('click', closeSuccess);
  document.getElementById('track-from-success')?.addEventListener('click', () => {
    const oid = document.getElementById('order-id-display')?.textContent || '';
    closeSuccess();
    openTrack();
    const input = document.getElementById('track-order-id');
    if (input) {
      input.value = oid;
      searchOrder();
    }
  });

  // Note modal (add to cart)
  document.getElementById('close-note')?.addEventListener('click', closeNoteModal);
  document.getElementById('confirm-add-cart')?.addEventListener('click', confirmAddToCart);
  document.getElementById('note-qty-minus')?.addEventListener('click', () => {
    if (pendingQty > 1) {
      pendingQty--;
      document.getElementById('note-qty-value').textContent = pendingQty;
    }
  });
  document.getElementById('note-qty-plus')?.addEventListener('click', () => {
    pendingQty++;
    document.getElementById('note-qty-value').textContent = pendingQty;
  });
  document.querySelectorAll('.quick-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const noteInput = document.getElementById('item-note');
      const tagNote = tag.dataset.note;
      if (!noteInput) return;
      // toggle tag
      if (tag.classList.contains('active')) {
        tag.classList.remove('active');
        noteInput.value = noteInput.value.replace(tagNote, '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim();
      } else {
        tag.classList.add('active');
        noteInput.value = noteInput.value ? noteInput.value + ', ' + tagNote : tagNote;
      }
    });
  });

  // Track order
  document.getElementById('track-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openTrack();
  });
  document.getElementById('close-track')?.addEventListener('click', closeTrack);
  document.getElementById('track-search-btn')?.addEventListener('click', searchOrder);
  document.getElementById('track-order-id')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchOrder();
  });

  // close modal on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
        if (modal.id === 'track-modal') stopTrackPolling();
      }
    });
  });
}

function initAdmin() {
  initFirebase();
  if (firebaseReady) {
    startFirebaseListeners();
  } else {
    startRealtimeSync();
  }
  if (isAdminLoggedIn()) {
    showAdminDashboard();
  }

  document.getElementById('login-btn')?.addEventListener('click', loginAdmin);
  document.getElementById('admin-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginAdmin();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logoutAdmin);
  document.getElementById('reset-all-btn')?.addEventListener('click', resetAllData);

  setupTabs();
  setupOrderFilters();

  document.getElementById('product-form')?.addEventListener('submit', saveProduct);
  document.getElementById('cancel-edit')?.addEventListener('click', cancelEdit);
  document.getElementById('close-order-detail')?.addEventListener('click', closeOrderDetail);
  document.getElementById('close-bill')?.addEventListener('click', closeBillModal);
  document.getElementById('bill-request-goto')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="tables"]')?.click();
  });
  document.getElementById('add-category-btn')?.addEventListener('click', addCategory);
  document.getElementById('new-category-name')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
  });
  document.getElementById('product-image-file')?.addEventListener('change', onImageFileSelected);
  document.getElementById('clear-image-btn')?.addEventListener('click', clearProductImage);

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
  });
}

// Auto init based on page
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('product-grid')) {
    initBuyer();
  }
  // admin init is called from admin.html
});
