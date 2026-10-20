"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "Africa/Lagos";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DB_PATH = path.resolve(ROOT, process.env.DATABASE_PATH || "../palmvilla-data/palmvilla.sqlite");
const BACKUP_PATH = path.resolve(ROOT, process.env.BACKUP_PATH || "../palmvilla-backups");
const COOKIE_NAME = "palmvilla_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const isProduction = process.env.NODE_ENV === "production";

if (SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
process.umask(0o077);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('manager', 'staff')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    name TEXT PRIMARY KEY,
    price INTEGER NOT NULL CHECK (price >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    cart_json TEXT NOT NULL DEFAULT '[]',
    orders_json TEXT NOT NULL DEFAULT '[]',
    owed INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    payments_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 0),
    cashier_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    business_date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    business_date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drinks_inventory (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    bought INTEGER NOT NULL CHECK (bought > 0),
    buy_price INTEGER NOT NULL CHECK (buy_price > 0),
    sold INTEGER NOT NULL CHECK (sold >= 0 AND sold <= bought),
    sell_price INTEGER NOT NULL CHECK (sell_price > 0),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS legacy_imports (
    digest TEXT PRIMARY KEY,
    business_date TEXT NOT NULL UNIQUE,
    sales INTEGER NOT NULL,
    expenses INTEGER NOT NULL,
    sales_items_json TEXT NOT NULL,
    staff_history_json TEXT NOT NULL,
    imported_by TEXT NOT NULL REFERENCES users(id),
    imported_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sales_business_date_idx ON sales(business_date);
  CREATE INDEX IF NOT EXISTS expenses_business_date_idx ON expenses(business_date);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);
const customerColumns = new Set(db.prepare("PRAGMA table_info(customers)").all().map(column => column.name));
if (!customerColumns.has("version")) db.exec("ALTER TABLE customers ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
if (!customerColumns.has("owed")) db.exec("ALTER TABLE customers ADD COLUMN owed INTEGER NOT NULL DEFAULT 0");
if (!customerColumns.has("paid")) db.exec("ALTER TABLE customers ADD COLUMN paid INTEGER NOT NULL DEFAULT 0");
if (!customerColumns.has("payments_json")) db.exec("ALTER TABLE customers ADD COLUMN payments_json TEXT NOT NULL DEFAULT '[]'");
if (!customerColumns.has("closed")) db.exec("ALTER TABLE customers ADD COLUMN closed INTEGER NOT NULL DEFAULT 0");

const initialMenu = {
  "Isi Ewu": 9000, "Nkwobi": 3000, "Pepper Soup": 2500,
  "Catfish Peppersoup": 16000, "Ugba": 4000, "Assorted Pomo": 200,
  "Abacha": 6000, "Panla": 1500, "Palm Wine": 3000,
  Gulder: 1500, Desperado: 1500, Budweiser: 1500, Heineken: 1500,
  Trophy: 1200, Goldberg: 1300, Star: 1500, "33": 1300,
  "Small Stout": 1200, "Big Stout": 2000, "Smire Off Ice": 1200,
  "Gordon's": 10000, "Best Whiskey": 2500, Longrider: 1600,
  Legend: 1500, Eagle: 1200, "Castle Lite": 1300, "Table Water": 300,
  Coke: 700, Fanta: 700, Sprite: 700, Pepsi: 700, Malt: 1000, Fayrouz: 1000
};
const upsertMenuItem = db.prepare("INSERT OR IGNORE INTO menu_items(name, price) VALUES (?, ?)");
for (const [name, price] of Object.entries(initialMenu)) upsertMenuItem.run(name, price);

function nowIso() { return new Date().toISOString(); }
function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function tokenHash(token) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}
function safeUser(row) { return { id: row.id, username: row.username, role: row.role }; }
function cookieOptions(maxAge) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isProduction ? "; Secure" : ""}`;
}
function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(payload));
}
function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => part.trim().split(/=(.*)/s)).filter(([key, value]) => key && value !== undefined));
}
function getUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  return db.prepare(`SELECT users.id, users.username, users.role FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1`)
    .get(tokenHash(token), Date.now()) || null;
}
function requireUser(user) {
  if (!user) throw Object.assign(new Error("Sign in required."), { status: 401 });
}
function requireManager(user) {
  requireUser(user);
  if (user.role !== "manager") throw Object.assign(new Error("Manager access required."), { status: 403 });
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}
function requireSameOrigin(req) {
  if (!req.headers.origin) return;
  const expected = `${isProduction ? "https" : "http"}://${req.headers.host}`;
  if (req.headers.origin !== expected) throw Object.assign(new Error("Request origin rejected."), { status: 403 });
}
function audit(actorId, action, details) {
  db.prepare("INSERT INTO audit_log(id, actor_id, action, details_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), actorId, action, JSON.stringify(details), nowIso());
}
function mapCustomer(row) {
  return {
    id: row.id, name: row.name, table: row.table_name,
    cart: JSON.parse(row.cart_json), orders: JSON.parse(row.orders_json),
    owed: Number(row.owed) || 0, paid: Number(row.paid) || 0, payments: JSON.parse(row.payments_json || "[]"),
    version: row.version, closed: Boolean(row.closed)
  };
}
function loadState(user) {
  const today = businessDate();
  const customers = db.prepare("SELECT * FROM customers ORDER BY closed ASC, created_at DESC").all().map(mapCustomer);
  const daily = db.prepare(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS sale_count
    FROM sales WHERE business_date = ?`).get(today);
  const imported = db.prepare("SELECT * FROM legacy_imports WHERE business_date = ?").get(today);
  const currentSales = db.prepare("SELECT * FROM sales WHERE business_date = ? ORDER BY created_at DESC").all(today);
  const salesHistory = currentSales.flatMap(sale => JSON.parse(sale.items_json).map(item => ({
    name: item.name, qty: item.qty, total: item.price * item.qty
  })));
  if (imported) salesHistory.unshift(...JSON.parse(imported.sales_items_json));
  const staffHistory = currentSales.map(sale => ({
    customerName: sale.customer_name, table: sale.table_name,
    items: JSON.parse(sale.items_json).map(item => ({ ...item, total: item.price * item.qty })),
    total: sale.total, time: new Date(sale.created_at).toLocaleString("en-NG", { timeZone: TIME_ZONE }), status: "Completed"
  }));
  const recentCustomerEvents = db.prepare(`SELECT details_json, created_at FROM audit_log
    WHERE action = 'customer.created' ORDER BY created_at DESC LIMIT 1000`)
    .all().filter(event => businessDate(new Date(event.created_at)) === today).map(event => {
      const details = JSON.parse(event.details_json);
      const customer = loadCustomer(details.customerId);
      return customer ? {
        customerName: customer.name, table: customer.table_name, items: [], total: 0,
        time: new Date(event.created_at).toLocaleString("en-NG", { timeZone: TIME_ZONE }), status: "Created"
      } : null;
    }).filter(Boolean);
  staffHistory.push(...recentCustomerEvents);
  const recentCartEvents = db.prepare(`SELECT action, details_json, created_at FROM audit_log
    WHERE action IN ('cart.item_added','cart.cleared') ORDER BY created_at DESC LIMIT 1000`)
    .all().filter(event => businessDate(new Date(event.created_at)) === today).map(event => {
      const details = JSON.parse(event.details_json);
      const customer = details.customerId ? loadCustomer(details.customerId) : null;
      return {
        customerName: customer?.name || "Customer", table: customer?.table_name || "N/A",
        items: Array.isArray(details.items) ? details.items : [],
        total: Number(details.total) || 0,
        time: new Date(event.created_at).toLocaleString("en-NG", { timeZone: TIME_ZONE }),
        status: event.action === "cart.item_added" ? "Updated" : "Cleared"
      };
    });
  staffHistory.push(...recentCartEvents);
  if (imported) staffHistory.push(...JSON.parse(imported.staff_history_json));
  const currentExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE business_date = ?").get(today).total;
  const menu = db.prepare("SELECT name, price FROM menu_items WHERE active = 1 ORDER BY rowid").all();
  const drinks = user.role === "manager" ? db.prepare("SELECT *, (bought-sold) AS stock, (sold*sell_price) AS sales, (sold*(sell_price-buy_price)) AS profit FROM drinks_inventory ORDER BY created_at DESC").all() : [];
  const expenses = user.role === "manager" ? db.prepare("SELECT description, amount, created_at FROM expenses WHERE business_date = ? ORDER BY created_at DESC").all(today) : [];
  const visibleExpenses = user.role === "manager" ? Number(currentExpenses) + Number(imported?.expenses || 0) : 0;
  const totalSales = Number(daily.sales) + Number(imported?.sales || 0);
  return {
    date: today, sales: totalSales, expenses: visibleExpenses,
    profit: totalSales - visibleExpenses, salesHistory, staffHistory,
    customers, menuPrices: Object.fromEntries(menu.map(item => [item.name, item.price])),
    drinks: drinks.map(item => ({ brand: item.brand, bought: item.bought, buyPrice: item.buy_price, sold: item.sold, sellPrice: item.sell_price, stock: item.stock, purchaseCost: item.bought * item.buy_price, sales: item.sales, profit: item.profit })),
    expensesList: expenses
  };
}
function validateString(value, label, max = 120) {
  const clean = String(value ?? "").trim();
  if (!clean || clean.length > max) throw Object.assign(new Error(`${label} is required and must be under ${max} characters.`), { status: 400 });
  return clean;
}
function loadCustomer(id) {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
}

function seedManager() {
  const username = String(process.env.MANAGER_USERNAME || "").trim();
  const password = String(process.env.MANAGER_PASSWORD || "");
  if (!username && !password) return;
  if (username.length < 3 || password.length < 12) throw new Error("Initial manager username must be at least 3 characters and password at least 12 characters.");
  const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (existing) return;
  db.prepare("INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'manager', ?)")
    .run(crypto.randomUUID(), username, hashPassword(password), nowIso());
  console.log(`Initial manager account created for ${username}. Remove its password from .env after this first run.`);
}
seedManager();
if (!db.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1 LIMIT 1").get()) {
  throw new Error("Set MANAGER_USERNAME and MANAGER_PASSWORD to create the initial manager account, then restart.");
}

function backupDatabase() {
  fs.mkdirSync(BACKUP_PATH, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(BACKUP_PATH, `palmvilla-${businessDate()}-${stamp}.sqlite`);
  const escapedPath = destination.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
  const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_PATH)) {
    if (!/^palmvilla-\d{4}-\d{2}-\d{2}-.+\.sqlite$/.test(file)) continue;
    const backupFile = path.join(BACKUP_PATH, file);
    if (fs.statSync(backupFile).mtimeMs < retentionCutoff) fs.unlinkSync(backupFile);
  }
  console.log(`Database backup created: ${destination}`);
}
let lastBackupDate = null;
function runDailyBackup() {
  const today = businessDate();
  if (today === lastBackupDate) return;
  try {
    fs.mkdirSync(BACKUP_PATH, { recursive: true, mode: 0o700 });
    const existingBackup = fs.readdirSync(BACKUP_PATH).some(file => file.startsWith(`palmvilla-${today}-`) && file.endsWith(".sqlite"));
    if (existingBackup) {
      lastBackupDate = today;
      return;
    }
    backupDatabase();
    lastBackupDate = today;
  } catch (error) {
    console.error("Database backup failed:", error);
  }
}

const loginFailures = new Map();
function loginRateLimited(key) {
  const record = loginFailures.get(key);
  if (!record) return false;
  if (record.until <= Date.now()) { loginFailures.delete(key); return false; }
  return record.count >= 8;
}
function recordLoginFailure(key) {
  const record = loginFailures.get(key) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
  record.count += 1;
  loginFailures.set(key, record);
}

async function handleApi(req, res, url) {
  const user = getUser(req);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) requireSameOrigin(req);
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/health") return sendJson(res, 200, { status: "ok" });
  if (route === "POST /api/login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (username.length > 50) return sendJson(res, 400, { error: "Username must be 50 characters or fewer." });
    const key = `${req.socket.remoteAddress || "unknown"}:${username.toLowerCase()}`;
    if (loginRateLimited(key)) return sendJson(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
    const account = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1").get(username);
    if (password.length > 1024 || !account || !verifyPassword(password, account.password_hash)) {
      recordLoginFailure(key);
      return sendJson(res, 401, { error: "Incorrect username or password." });
    }
    loginFailures.delete(key);
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
    db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash(rawToken), account.id, expiresAt, nowIso());
    return sendJson(res, 200, { user: safeUser(account) }, {
      "Set-Cookie": `${COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${isProduction ? "; Secure" : ""}`
    });
  }
  if (route === "POST /api/logout") {
    if (user) db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash = ?").run(user.id, tokenHash(parseCookies(req.headers.cookie)[COOKIE_NAME]));
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieOptions(0) });
  }
  if (route === "GET /api/session") {
    return sendJson(res, 200, { user: user ? safeUser(user) : null });
  }
  requireUser(user);
  if (route === "GET /api/state") return sendJson(res, 200, loadState(user));

  if (route === "GET /api/debts") {
    requireManager(user);
    const customers = db.prepare("SELECT * FROM customers ORDER BY owed DESC, created_at DESC").all().map(mapCustomer);
    const totalOutstanding = customers.reduce((sum, customer) => sum + customer.owed, 0);
    const cashCollectedToday = customers.reduce((sum, customer) => sum + customer.payments
      .filter(payment => payment.time && Number.isFinite(Date.parse(payment.time)) && businessDate(new Date(payment.time)) === businessDate())
      .reduce((paymentTotal, payment) => paymentTotal + (Number(payment.amount) || 0), 0), 0);
    const creditSales = customers.reduce((sum, customer) => sum + customer.orders
      .filter(order => order.isCredit || Number(order.owed) > 0)
      .reduce((orderTotal, order) => orderTotal + (Number(order.total) || 0), 0), 0);
    return sendJson(res, 200, {
      customers, totalOutstanding, cashCollectedToday, creditSales,
      debtorCount: customers.filter(customer => customer.owed > 0).length
    });
  }

  if (req.method === "GET" && url.pathname === "/api/reports") {
    requireManager(user);
    const date = url.searchParams.get("date") || businessDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || businessDate(new Date(`${date}T12:00:00.000Z`)) !== date) {
      return sendJson(res, 400, { error: "Choose a valid report date." });
    }
    const daySales = db.prepare("SELECT * FROM sales WHERE business_date = ? ORDER BY created_at DESC").all(date);
    const dayExpenses = db.prepare("SELECT description, amount, created_at FROM expenses WHERE business_date = ? ORDER BY created_at DESC").all(date);
    const imported = db.prepare("SELECT * FROM legacy_imports WHERE business_date = ?").get(date);
    const totalSales = daySales.reduce((sum, sale) => sum + sale.total, 0) + Number(imported?.sales || 0);
    const totalExpenses = dayExpenses.reduce((sum, expense) => sum + expense.amount, 0) + Number(imported?.expenses || 0);
    return sendJson(res, 200, {
      date, sales: totalSales, expenses: totalExpenses, profit: totalSales - totalExpenses,
      saleCount: daySales.length + (imported ? JSON.parse(imported.staff_history_json).filter(item => Number(item.total) > 0).length : 0),
      salesItems: [
        ...(imported ? JSON.parse(imported.staff_history_json).filter(item => Number(item.total) > 0).map(item => ({
          time: item.time || "Imported historical sale",
          customer: item.customerName || "Imported customer", table: item.table || "N/A",
          items: item.items || [], total: Number(item.total)
        })) : []),
        ...daySales.map(sale => ({
        time: new Date(sale.created_at).toLocaleString("en-NG", { timeZone: TIME_ZONE }),
        customer: sale.customer_name, table: sale.table_name,
        items: JSON.parse(sale.items_json), total: sale.total
        }))
      ],
      expensesList: [
        ...(imported && Number(imported.expenses) > 0 ? [{ description: "Imported previous browser expenses", amount: imported.expenses }] : []),
        ...dayExpenses
      ]
    });
  }

  if (route === "POST /api/migrate-local") {
    requireManager(user);
    const envelope = body.snapshot;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return sendJson(res, 400, { error: "Choose a Palm Villa export file." });
    const snapshot = envelope.storage && typeof envelope.storage === "object" ? envelope.storage : envelope;
    const sourceData = snapshot.palmVillaData && typeof snapshot.palmVillaData === "object" ? snapshot.palmVillaData : {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(sourceData.date || "") ? sourceData.date : businessDate();
    if (businessDate(new Date(`${date}T12:00:00.000Z`)) !== date) return sendJson(res, 400, { error: "The export contains an invalid business date." });
    const digest = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    if (db.prepare("SELECT digest FROM legacy_imports WHERE digest = ?").get(digest)) return sendJson(res, 200, { alreadyImported: true, date });
    if (db.prepare("SELECT digest FROM legacy_imports WHERE business_date = ?").get(date)) {
      return sendJson(res, 409, { error: `A browser export for ${date} was already imported. The existing import was left unchanged.` });
    }
    const oldSales = Number(sourceData.sales || 0), oldExpenses = Number(sourceData.expenses || 0);
    if (![oldSales, oldExpenses].every(Number.isSafeInteger) || oldSales < 0 || oldExpenses < 0) {
      return sendJson(res, 400, { error: "The export contains invalid daily totals." });
    }
    const oldSalesHistory = Array.isArray(sourceData.salesHistory) ? sourceData.salesHistory.slice(0, 5000).map(item => ({
      name: String(item.name || "Imported item").slice(0, 100),
      qty: Math.max(0, Math.min(999, Number(item.qty) || 0)),
      total: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(item.total) || 0))
    })) : [];
    const oldStaffHistory = Array.isArray(sourceData.staffHistory) ? sourceData.staffHistory.slice(0, 5000).map(item => ({
      customerName: String(item.customerName || "Walk-in").slice(0, 120),
      table: String(item.table || "N/A").slice(0, 40),
      items: Array.isArray(item.items) ? item.items.slice(0, 100).map(line => ({
        name: String(line.name || "Imported item").slice(0, 100),
        qty: Math.max(0, Math.min(999, Number(line.qty) || 0)),
        price: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(line.price) || 0))
      })) : [],
      total: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(item.total) || 0)),
      time: String(item.time || "Imported historical record").slice(0, 100),
      status: String(item.status || "Imported").slice(0, 40)
    })) : [];
    const oldCustomers = Array.isArray(snapshot.palmVillaCustomers) ? snapshot.palmVillaCustomers.slice(0, 2000) : [];
    const oldDrinks = Array.isArray(snapshot.palmVillaDrinks) ? snapshot.palmVillaDrinks.slice(0, 2000) : [];
    const timestamp = nowIso();
    const insertCustomer = db.prepare(`INSERT INTO customers(id,name,table_name,cart_json,orders_json,owed,paid,payments_json,created_by,created_at,updated_at,closed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDrink = db.prepare(`INSERT INTO drinks_inventory(id,brand,bought,buy_price,sold,sell_price,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO legacy_imports(digest,business_date,sales,expenses,sales_items_json,staff_history_json,imported_by,imported_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(digest, date, oldSales, oldExpenses, JSON.stringify(oldSalesHistory), JSON.stringify(oldStaffHistory), user.id, timestamp);
      for (const oldCustomer of oldCustomers) {
        const name = String(oldCustomer.name || "").trim().slice(0, 120);
        if (!name) continue;
        const table = String(oldCustomer.table || "N/A").trim().slice(0, 40) || "N/A";
        const cart = (Array.isArray(oldCustomer.cart) ? oldCustomer.cart : []).slice(0, 100).flatMap(item => {
          const menuItem = db.prepare("SELECT price FROM menu_items WHERE name = ? AND active = 1").get(String(item.name || ""));
          const qty = Number(item.qty);
          return menuItem && Number.isSafeInteger(qty) && qty > 0 && qty <= 999 ? [{ name: String(item.name), price: menuItem.price, qty }] : [];
        });
        const orders = (Array.isArray(oldCustomer.orders) ? oldCustomer.orders : []).slice(0, 500).map(order => ({
          items: Array.isArray(order.items) ? order.items.slice(0, 100).map(item => ({
            name: String(item.name || "Imported item").slice(0, 100),
            qty: Math.max(0, Math.min(999, Number(item.qty) || 0)),
            price: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(item.price) || 0))
          })) : [],
          total: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(order.total) || 0)),
          paid: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(order.paid) || 0)),
          owed: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(order.owed) || 0)),
          isCredit: Boolean(order.isCredit || Number(order.owed) > 0),
          time: String(order.time || "Imported historical record").slice(0, 100),
          date: String(order.date || "Imported historical record").slice(0, 100),
          status: String(order.status || (Number(order.owed) > 0 ? "Unpaid" : "Paid")).slice(0, 40)
        }));
        const owed = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(oldCustomer.owed) || 0));
        const paid = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(oldCustomer.paid) || 0));
        const payments = (Array.isArray(oldCustomer.payments) ? oldCustomer.payments : []).slice(0, 5000).flatMap(payment => {
          const amount = Number(payment.amount);
          if (!Number.isSafeInteger(amount) || amount <= 0) return [];
          return [{ amount, time: String(payment.time || "Imported historical payment").slice(0, 100) }];
        });
        insertCustomer.run(crypto.randomUUID(), name, table, JSON.stringify(cart), JSON.stringify(orders), owed, paid,
          JSON.stringify(payments), user.id, timestamp, timestamp, cart.length ? 0 : 1);
      }
      for (const drink of oldDrinks) {
        const brand = String(drink.brand || "").trim().slice(0, 120);
        const bought = Number(drink.bought), buyPrice = Number(drink.buyPrice), sold = Number(drink.sold), sellPrice = Number(drink.sellPrice);
        if (brand && [bought, buyPrice, sold, sellPrice].every(Number.isSafeInteger) && bought > 0 && buyPrice > 0 && sold >= 0 && sold <= bought && sellPrice > 0) {
          insertDrink.run(crypto.randomUUID(), brand, bought, buyPrice, sold, sellPrice, user.id, timestamp);
        }
      }
      audit(user.id, "legacy_data.imported", { date, customerCount: oldCustomers.length, drinkCount: oldDrinks.length, digest });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return sendJson(res, 201, { imported: true, date, customers: oldCustomers.length, drinks: oldDrinks.length });
  }

  if (route === "POST /api/customers") {
    const name = validateString(body.name, "Customer name");
    const table = validateString(body.table, "Table");
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(`INSERT INTO customers(id,name,table_name,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).run(id, name, table, user.id, timestamp, timestamp);
    audit(user.id, "customer.created", { customerId: id, table });
    return sendJson(res, 201, mapCustomer(loadCustomer(id)));
  }

  const cartRoute = url.pathname.match(/^\/api\/customers\/([0-9a-f-]+)\/cart$/i);
  if (req.method === "PUT" && cartRoute) {
    const customer = loadCustomer(cartRoute[1]);
    if (!customer) return sendJson(res, 404, { error: "Customer not found." });
    if (!Array.isArray(body.items) || body.items.length > 100) return sendJson(res, 400, { error: "Invalid cart." });
    const menu = db.prepare("SELECT price FROM menu_items WHERE name = ? AND active = 1");
    const items = body.items.map(item => {
      const name = validateString(item.name, "Item name", 100);
      const qty = Number(item.qty);
      const menuItem = menu.get(name);
      if (!menuItem || !Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw Object.assign(new Error("Cart contains an unavailable item or invalid quantity."), { status: 400 });
      return { name, price: menuItem.price, qty };
    });
    if (!Number.isSafeInteger(Number(body.version))) return sendJson(res, 400, { error: "Cart version is missing. Reload the order and try again." });
    const update = db.prepare("UPDATE customers SET cart_json = ?, updated_at = ?, version = version + 1, closed = 0 WHERE id = ? AND version = ?")
    .run(JSON.stringify(items), nowIso(), customer.id, Number(body.version));
    if (!update.changes) return sendJson(res, 409, { error: "Another device changed this order. Reload it before making more changes." });
    return sendJson(res, 200, { cart: items, version: customer.version + 1 });
  }

  const paymentRoute = url.pathname.match(/^\/api\/customers\/([0-9a-f-]+)\/payments$/i);
  if (req.method === "POST" && paymentRoute) {
    requireManager(user);
    const customer = loadCustomer(paymentRoute[1]);
    if (!customer) return sendJson(res, 404, { error: "Customer not found." });
    const amount = Number(body.amount);
    const currentOwed = Number(customer.owed) || 0;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > currentOwed) {
      return sendJson(res, 400, { error: `Enter a whole amount from ₦1 to ₦${currentOwed.toLocaleString()}.` });
    }
    const payment = { amount, time: nowIso() };
    const payments = JSON.parse(customer.payments_json || "[]");
    payments.push(payment);
    const orders = JSON.parse(customer.orders_json);
    let remaining = amount;
    for (const order of orders) {
      const orderOwed = Number(order.owed) || 0;
      if (orderOwed <= 0 || remaining <= 0) continue;
      const applied = Math.min(orderOwed, remaining);
      order.owed = orderOwed - applied;
      order.paid = (Number(order.paid) || 0) + applied;
      order.status = order.owed > 0 ? "Unpaid" : "Paid";
      remaining -= applied;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE customers SET owed = owed - ?, paid = paid + ?, payments_json = ?, orders_json = ?, updated_at = ? WHERE id = ?")
        .run(amount, amount, JSON.stringify(payments), JSON.stringify(orders), payment.time, customer.id);
      audit(user.id, "customer.payment_recorded", { customerId: customer.id, amount });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return sendJson(res, 201, { payment, owed: currentOwed - amount });
  }

  if (route === "POST /api/sales") {
    const customer = body.customerId ? loadCustomer(body.customerId) : null;
    if (body.customerId && !customer) return sendJson(res, 404, { error: "Customer not found." });
    const cart = customer ? JSON.parse(customer.cart_json) : body.items;
    if (!Array.isArray(cart) || cart.length === 0 || cart.length > 100) return sendJson(res, 400, { error: "Cart is empty or invalid." });
    const selectPrice = db.prepare("SELECT price FROM menu_items WHERE name = ? AND active = 1");
    const items = cart.map(item => {
      const name = validateString(item.name, "Item name", 100);
      const qty = Number(item.qty);
      const entry = selectPrice.get(name);
      if (!entry || !Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw Object.assign(new Error("Sale contains an unavailable item or invalid quantity."), { status: 400 });
      return { name, price: entry.price, qty };
    });
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (!Number.isSafeInteger(total)) return sendJson(res, 400, { error: "Sale total exceeds allowed limits." });
    const amountPaid = body.amountPaid === undefined ? total : Number(body.amountPaid);
    if (!Number.isSafeInteger(amountPaid) || amountPaid < 0 || amountPaid > total) {
      return sendJson(res, 400, { error: "Amount paid must be a whole amount between ₦0 and the sale total." });
    }
    const amountOwed = total - amountPaid;
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const customerName = customer?.name || "Walk-in";
    const table = customer?.table_name || "Walk-in";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO sales(id,customer_id,customer_name,table_name,items_json,total,cashier_id,created_at,business_date)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, customer?.id || null, customerName, table, JSON.stringify(items), total, user.id, timestamp, businessDate());
      if (customer) {
        const orders = JSON.parse(customer.orders_json);
        orders.push({ items, total, paid: amountPaid, owed: amountOwed, isCredit: amountOwed > 0,
          time: timestamp, date: new Intl.DateTimeFormat("en-NG", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(new Date(timestamp)),
          status: amountOwed > 0 ? "Unpaid" : "Paid" });
        const payments = JSON.parse(customer.payments_json || "[]");
        if (amountPaid > 0) payments.push({ amount: amountPaid, time: timestamp });
        db.prepare("UPDATE customers SET cart_json = '[]', orders_json = ?, owed = owed + ?, paid = paid + ?, payments_json = ?, updated_at = ?, version = version + 1, closed = 1 WHERE id = ?")
          .run(JSON.stringify(orders), amountOwed, amountPaid, JSON.stringify(payments), timestamp, customer.id);
      }
      audit(user.id, "sale.completed", { saleId: id, total, itemCount: items.length });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return sendJson(res, 201, { id, total, amountPaid, amountOwed, items, customerName, table, createdAt: timestamp });
  }

  if (route === "POST /api/expenses") {
    requireManager(user);
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount < 1) return sendJson(res, 400, { error: "Enter a valid whole-naira amount." });
    const description = validateString(body.description || "General expense", "Expense description");
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(`INSERT INTO expenses(id,description,amount,created_by,created_at,business_date)
      VALUES(?,?,?,?,?,?)`).run(id, description, amount, user.id, timestamp, businessDate());
    audit(user.id, "expense.created", { expenseId: id, amount });
    return sendJson(res, 201, { id, amount, description });
  }

  if (route === "POST /api/drinks") {
    requireManager(user);
    const brand = validateString(body.brand, "Drink brand");
    const bought = Number(body.bought), buyPrice = Number(body.buyPrice), sold = Number(body.sold), sellPrice = Number(body.sellPrice);
    if (![bought, buyPrice, sold, sellPrice].every(Number.isSafeInteger) || bought < 1 || buyPrice < 1 || sold < 0 || sold > bought || sellPrice < 1) {
      return sendJson(res, 400, { error: "Enter valid stock quantities and prices." });
    }
    const id = crypto.randomUUID(), timestamp = nowIso();
    db.prepare(`INSERT INTO drinks_inventory(id,brand,bought,buy_price,sold,sell_price,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, brand, bought, buyPrice, sold, sellPrice, user.id, timestamp);
    audit(user.id, "inventory.created", { inventoryId: id, brand, bought, sold });
    return sendJson(res, 201, { id, brand, bought, buyPrice, sold, sellPrice, stock: bought - sold });
  }

  if (route === "POST /api/menu-prices") {
    requireManager(user);
    const name = validateString(body.name, "Menu item");
    const price = Number(body.price);
    if (!Number.isSafeInteger(price) || price < 0) return sendJson(res, 400, { error: "Price must be a whole-naira amount." });
    const result = db.prepare("UPDATE menu_items SET price = ? WHERE name = ?").run(price, name);
    if (!result.changes) return sendJson(res, 404, { error: "Menu item not found." });
    audit(user.id, "menu.price_changed", { name, price });
    return sendJson(res, 200, { name, price });
  }

  if (route === "POST /api/activity") {
    const action = body.action;
    if (!["item-added", "cart-cleared"].includes(action)) return sendJson(res, 400, { error: "Unsupported activity." });
    const customerId = body.customerId ? String(body.customerId) : null;
    if (customerId && !loadCustomer(customerId)) return sendJson(res, 404, { error: "Customer not found." });
    const items = Array.isArray(body.items) ? body.items.slice(0, 100).map(item => ({
      name: String(item.name || "").slice(0, 100),
      qty: Math.max(0, Math.min(999, Number(item.qty) || 0)),
      price: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(item.price) || 0))
    })) : [];
    const total = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(body.total) || 0));
    audit(user.id, action === "item-added" ? "cart.item_added" : "cart.cleared", { customerId, items, total });
    return sendJson(res, 201, { ok: true });
  }

  if (route === "POST /api/users") {
    requireManager(user);
    const username = validateString(body.username, "Username", 50);
    const password = String(body.password || "");
    const role = body.role === "manager" ? "manager" : "staff";
    if (username.length < 3 || password.length < 12) return sendJson(res, 400, { error: "Username must be at least 3 characters and password at least 12 characters." });
    try {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
        .run(id, username, hashPassword(password), role, nowIso());
      audit(user.id, "user.created", { userId: id, username, role });
      return sendJson(res, 201, { id, username, role });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return sendJson(res, 409, { error: "That username is already in use." });
      throw error;
    }
  }

  if (route === "GET /api/users") {
    requireManager(user);
    const accounts = db.prepare("SELECT id, username, role, active, created_at FROM users ORDER BY role, username COLLATE NOCASE").all();
    return sendJson(res, 200, { users: accounts.map(account => ({ ...account, active: Boolean(account.active) })) });
  }

  const accountRoute = url.pathname.match(/^\/api\/users\/([0-9a-f-]+)$/i);
  if (req.method === "PATCH" && accountRoute) {
    requireManager(user);
    if (typeof body.active !== "boolean") return sendJson(res, 400, { error: "Choose whether the account should be active." });
    const target = db.prepare("SELECT id, username, role, active FROM users WHERE id = ?").get(accountRoute[1]);
    if (!target) return sendJson(res, 404, { error: "Account not found." });
    if (!body.active && target.id === user.id) return sendJson(res, 400, { error: "You cannot disable the account you are using." });
    if (!body.active && target.role === "manager") {
      const activeManagers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='manager' AND active=1").get().count;
      if (activeManagers <= 1) return sendJson(res, 400, { error: "Keep at least one active manager account." });
    }
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(body.active ? 1 : 0, target.id);
    if (!body.active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    audit(user.id, body.active ? "user.enabled" : "user.disabled", { userId: target.id, username: target.username });
    return sendJson(res, 200, { id: target.id, username: target.username, role: target.role, active: body.active });
  }

  const passwordRoute = url.pathname.match(/^\/api\/users\/([0-9a-f-]+)\/password$/i);
  if (req.method === "POST" && passwordRoute) {
    requireManager(user);
    if (passwordRoute[1] === user.id) return sendJson(res, 400, { error: "Use Change Password for your own account." });
    const password = String(body.password || "");
    if (password.length < 12 || password.length > 1024) return sendJson(res, 400, { error: "Temporary password must be 12 to 1024 characters." });
    const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(passwordRoute[1]);
    if (!target) return sendJson(res, 404, { error: "Account not found." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), target.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    audit(user.id, "user.password_reset", { userId: target.id, username: target.username });
    return sendJson(res, 200, { ok: true });
  }

  if (route === "POST /api/account/password") {
    requireUser(user);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const account = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id);
    if (!verifyPassword(currentPassword, account.password_hash)) return sendJson(res, 401, { error: "Current password is incorrect." });
    if (newPassword.length < 12) return sendJson(res, 400, { error: "New password must be at least 12 characters." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    audit(user.id, "account.password_changed", {});
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieOptions(0) });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"
};
const protectedFiles = new Map([["/index.html", "manager"], ["/orders.html", "staff"], ["/debts.html", "manager"]]);
const staticFiles = new Set([
  "/index.html", "/orders.html", "/debts.html", "/debts.js", "/login.html", "/login.js", "/script.js", "/style.css",
  "/manifest.json", "/logo-192.svg", "/logo-512.svg", "/sw.js", "/qr.html", "/qr.png",
  "/migration.html", "/migration.js", "/api.js"
]);
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (!["GET", "HEAD"].includes(req.method)) return sendJson(res, 405, { error: "Method not allowed." });
    let relative;
    try { relative = decodeURIComponent(url.pathname === "/" ? "/orders.html" : url.pathname); }
    catch { return res.writeHead(400).end("Bad request"); }
    if (!staticFiles.has(relative)) return res.writeHead(404).end("Not found");
    const requiredRole = protectedFiles.get(relative);
    if (requiredRole) {
      const user = getUser(req);
      if (!user) return res.writeHead(302, { Location: "/login.html?next=%2Findex.html" }).end();
      if (requiredRole === "manager" && user.role !== "manager") return res.writeHead(302, { Location: "/orders.html" }).end();
    }
    const filePath = path.resolve(ROOT, `.${relative}`);
    if (!filePath.startsWith(ROOT + path.sep)) return res.writeHead(403).end("Forbidden");
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.writeHead(404).end("Not found"); }
    if (!stat.isFile()) return res.writeHead(404).end("Not found");
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const cacheControl = filePath.endsWith("sw.js") ? "no-cache" : "no-store";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      "Cache-Control": cacheControl
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? "Server error." : error.message });
    else res.end();
  }
}
const server = http.createServer(handleRequest);

const cleanup = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
setInterval(() => cleanup.run(Date.now()), 60 * 60 * 1000).unref();
runDailyBackup();
setInterval(runDailyBackup, 60 * 60 * 1000).unref();
if (process.env.PALMVILLA_TESTING !== "1") {
  server.on("error", error => {
    console.error(`Palm Villa server could not listen on ${HOST}:${PORT}:`, error.message);
    process.exitCode = 1;
    db.close();
  });
  server.listen(PORT, HOST, () => console.log(`Palm Villa server listening on ${HOST}:${PORT}`));
}

module.exports = { db, handleApi, handleRequest, staticFiles };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close(() => { db.close(); process.exit(0); });
});
