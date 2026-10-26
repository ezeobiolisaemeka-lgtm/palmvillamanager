const COOKIE = "palmvilla_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const STATIC_FILES = new Set([
  "/index.html", "/orders.html", "/debts.html", "/debts.js", "/login.html", "/login.js",
  "/script.js", "/style.css", "/manifest.json", "/logo-192.svg", "/logo-512.svg",
  "/sw.js", "/migration.html", "/migration.js", "/api.js"
]);
const PROTECTED = { "/index.html": "manager", "/debts.html": "manager", "/orders.html": "staff" };

const iso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const timezone = env => env.BUSINESS_TIME_ZONE || "Africa/Lagos";
function businessDate(env, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone(env), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function cookieValue(request) {
  return (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
}
function cookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function passwordHash(password) {
  const iterations = 120000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, 256);
  return `pbkdf2$${iterations}$${hex(salt)}$${hex(bits)}`;
}
async function checkPassword(password, stored) {
  const [scheme, count, saltHex, expected] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !/^\d+$/.test(count) || !/^[a-f\d]{32}$/.test(saltHex) || !/^[a-f\d]{64}$/.test(expected)) return false;
  const salt = Uint8Array.from(saltHex.match(/../g), x => parseInt(x, 16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(count), hash: "SHA-256" }, material, 256);
  const actual = hex(bits);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return mismatch === 0;
}
async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 10 * 1024 * 1024) throw fail("Request body is too large.", 413);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw fail("Request body must be valid JSON."); }
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw fail("Request origin rejected.", 403);
}
function needUser(user) { if (!user) throw fail("Sign in required.", 401); }
function needManager(user) { needUser(user); if (user.role !== "manager") throw fail("Manager access required.", 403); }
function clean(value, label, max = 120) {
  const out = String(value ?? "").trim();
  if (!out || out.length > max) throw fail(`${label} is required and must be under ${max} characters.`);
  return out;
}
function safeUser(row) { return { id: row.id, username: row.username, role: row.role }; }
function mapCustomer(row) {
  return { id: row.id, name: row.name, table: row.table_name, cart: JSON.parse(row.cart_json), orders: JSON.parse(row.orders_json),
    owed: Number(row.owed) || 0, paid: Number(row.paid) || 0, payments: JSON.parse(row.payments_json || "[]"),
    version: row.version, closed: Boolean(row.closed) };
}
async function audit(env, userId, action, details) {
  await env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)")
    .bind(uuid(), userId, action, JSON.stringify(details), iso()).run();
}
async function currentUser(request, env) {
  const raw = cookieValue(request);
  if (!raw) return null;
  const tokenHash = await hmac(env.SESSION_SECRET, raw);
  return env.DB.prepare(`SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(tokenHash, Date.now()).first();
}
async function createInitialManager(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw fail("Configure a session secret of at least 32 characters before using the app.", 500);
  const manager = await env.DB.prepare("SELECT id FROM users WHERE role='manager' AND active=1 LIMIT 1").first();
  if (manager || !env.MANAGER_USERNAME || !env.MANAGER_PASSWORD) return;
  const username = String(env.MANAGER_USERNAME).trim();
  if (username.length < 3 || env.MANAGER_PASSWORD.length < 12) throw fail("Set an initial manager username (3+ characters) and password (12+ characters).", 500);
  try {
    await env.DB.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'manager',?)")
      .bind(uuid(), username, await passwordHash(env.MANAGER_PASSWORD), iso()).run();
  } catch (e) {
    if (!String(e.message).includes("UNIQUE")) throw e;
  }
}
async function customerById(env, id) { return env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(id).first(); }
async function resolveItems(env, cart, errorMessage, allowEmpty = false) {
  if (!Array.isArray(cart) || (!allowEmpty && cart.length === 0) || cart.length > 100) throw fail(errorMessage);
  if (cart.length === 0) return [];
  const names = [...new Set(cart.map(item => clean(item.name, "Item name", 100)))];
  const placeholders = names.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT name,price FROM menu_items WHERE active=1 AND name IN (${placeholders})`).bind(...names).all();
  const prices = new Map(result.results.map(row => [row.name, row.price]));
  return cart.map(item => {
    const name = clean(item.name, "Item name", 100), qty = Number(item.qty), price = prices.get(name);
    if (price === undefined || !Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw fail(errorMessage);
    return { name, price, qty };
  });
}

async function state(env, user) {
  const today = businessDate(env);
  const [customersQ, daily, imported, salesQ, expenseSum, menuQ, drinksQ, expensesQ, auditsQ] = await Promise.all([
    env.DB.prepare("SELECT * FROM customers ORDER BY closed ASC,created_at DESC").all(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) sales,COUNT(*) sale_count FROM sales WHERE business_date=?").bind(today).first(),
    env.DB.prepare("SELECT * FROM legacy_imports WHERE business_date=?").bind(today).first(),
    env.DB.prepare("SELECT * FROM sales WHERE business_date=? ORDER BY created_at DESC").bind(today).all(),
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE business_date=?").bind(today).first(),
    env.DB.prepare("SELECT name,price FROM menu_items WHERE active=1 ORDER BY rowid").all(),
    user.role === "manager" ? env.DB.prepare("SELECT *,bought-sold stock,sold*sell_price sales,sold*(sell_price-buy_price) profit FROM drinks_inventory ORDER BY created_at DESC").all() : { results: [] },
    user.role === "manager" ? env.DB.prepare("SELECT description,amount,created_at FROM expenses WHERE business_date=? ORDER BY created_at DESC").bind(today).all() : { results: [] },
    env.DB.prepare("SELECT action,details_json,created_at FROM audit_log WHERE action IN ('customer.created','cart.item_added','cart.cleared') ORDER BY created_at DESC LIMIT 1000").all()
  ]);
  const customers = customersQ.results.map(mapCustomer);
  const sales = salesQ.results;
  const salesHistory = sales.flatMap(sale => JSON.parse(sale.items_json).map(item => ({ name: item.name, qty: item.qty, total: item.price * item.qty })));
  if (imported) salesHistory.unshift(...JSON.parse(imported.sales_items_json));
  const staffHistory = sales.map(sale => ({ customerName: sale.customer_name, table: sale.table_name,
    items: JSON.parse(sale.items_json).map(item => ({ ...item, total: item.price * item.qty })), total: sale.total,
    time: new Date(sale.created_at).toLocaleString("en-NG", { timeZone: timezone(env) }), status: "Completed" }));
  for (const event of auditsQ.results) {
    if (businessDate(env, new Date(event.created_at)) !== today) continue;
    const detail = JSON.parse(event.details_json);
    if (event.action === "customer.created") {
      const c = customers.find(x => x.id === detail.customerId);
      if (c) staffHistory.push({ customerName: c.name, table: c.table, items: [], total: 0,
        time: new Date(event.created_at).toLocaleString("en-NG", { timeZone: timezone(env) }), status: "Created" });
    } else {
      const c = customers.find(x => x.id === detail.customerId);
      staffHistory.push({ customerName: c?.name || "Customer", table: c?.table || "N/A",
        items: Array.isArray(detail.items) ? detail.items : [], total: Number(detail.total) || 0,
        time: new Date(event.created_at).toLocaleString("en-NG", { timeZone: timezone(env) }),
        status: event.action === "cart.item_added" ? "Updated" : "Cleared" });
    }
  }
  if (imported) staffHistory.push(...JSON.parse(imported.staff_history_json));
  const totalSales = Number(daily.sales) + Number(imported?.sales || 0);
  const totalExpenses = user.role === "manager" ? Number(expenseSum.total) + Number(imported?.expenses || 0) : 0;
  return { date: today, sales: totalSales, expenses: totalExpenses, profit: totalSales - totalExpenses, salesHistory, staffHistory,
    customers, menuPrices: Object.fromEntries(menuQ.results.map(row => [row.name, row.price])),
    drinks: drinksQ.results.map(x => ({ brand:x.brand,bought:x.bought,buyPrice:x.buy_price,sold:x.sold,sellPrice:x.sell_price,stock:x.stock,
      purchaseCost:x.bought*x.buy_price,sales:x.sales,profit:x.profit })), expensesList: expensesQ.results };
}

async function api(request, env, url) {
  const method = request.method;
  const path = url.pathname;
  if (["POST","PUT","PATCH","DELETE"].includes(method)) sameOrigin(request);
  const body = ["POST","PUT","PATCH"].includes(method) ? await bodyJson(request) : {};
  if (method === "GET" && path === "/api/health") return json({ status: "ok" });
  await createInitialManager(env);
  const user = await currentUser(request, env);
  if (method === "GET" && path === "/api/session") return json({ user: user ? safeUser(user) : null });
  if (method === "POST" && path === "/api/login") {
    const username = String(body.username || "").trim(), password = String(body.password || "");
    if (username.length > 50) return json({ error: "Username must be 50 characters or fewer." }, 400);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = await digest(`${ip}:${username.toLowerCase()}`);
    const limit = await env.DB.prepare("SELECT count,expires_at FROM login_attempts WHERE attempt_key=?").bind(key).first();
    if (limit && limit.expires_at > Date.now() && limit.count >= 8) return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
    const account = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1").bind(username).first();
    if (password.length > 1024 || !account || !(await checkPassword(password, account.password_hash))) {
      await env.DB.prepare(`INSERT INTO login_attempts(attempt_key,count,expires_at) VALUES(?,1,?)
        ON CONFLICT(attempt_key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`)
        .bind(key, Date.now()+900000, Date.now(), Date.now()).run();
      return json({ error: "Incorrect username or password." }, 401);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key=?").bind(key).run();
    const raw = randomToken(), expires = Date.now() + SESSION_MS;
    await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .bind(await hmac(env.SESSION_SECRET, raw), account.id, expires, iso()).run();
    return json({ user: safeUser(account) }, 200, { "Set-Cookie": cookie(raw, SESSION_MS/1000) });
  }
  if (method === "POST" && path === "/api/logout") {
    if (user) await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash=?").bind(user.id, await hmac(env.SESSION_SECRET, cookieValue(request))).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  needUser(user);
  if (method === "GET" && path === "/api/state") return json(await state(env, user));

  if (method === "GET" && path === "/api/debts") {
    needManager(user);
    const rows = (await env.DB.prepare("SELECT * FROM customers ORDER BY owed DESC,created_at DESC").all()).results;
    const customers = rows.map(mapCustomer);
    const today = businessDate(env);
    return json({ customers, totalOutstanding: customers.reduce((s,c)=>s+c.owed,0),
      cashCollectedToday: customers.reduce((s,c)=>s+c.payments.filter(p=>p.time&&Number.isFinite(Date.parse(p.time))&&businessDate(env,new Date(p.time))===today).reduce((a,p)=>a+(Number(p.amount)||0),0),0),
      creditSales: customers.reduce((s,c)=>s+c.orders.filter(o=>o.isCredit||Number(o.owed)>0).reduce((a,o)=>a+(Number(o.total)||0),0),0),
      debtorCount: customers.filter(c=>c.owed>0).length });
  }
  if (method === "GET" && path === "/api/reports") {
    needManager(user);
    const date=url.searchParams.get("date")||businessDate(env);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||businessDate(env,new Date(`${date}T12:00:00.000Z`))!==date) return json({error:"Choose a valid report date."},400);
    const [salesQ,expensesQ,legacy]=await Promise.all([
      env.DB.prepare("SELECT * FROM sales WHERE business_date=? ORDER BY created_at DESC").bind(date).all(),
      env.DB.prepare("SELECT description,amount,created_at FROM expenses WHERE business_date=? ORDER BY created_at DESC").bind(date).all(),
      env.DB.prepare("SELECT * FROM legacy_imports WHERE business_date=?").bind(date).first()
    ]);
    const sales=salesQ.results, expenses=expensesQ.results, legacyHistory=legacy?JSON.parse(legacy.staff_history_json):[];
    const totalSales=sales.reduce((s,x)=>s+x.total,0)+Number(legacy?.sales||0), totalExpenses=expenses.reduce((s,x)=>s+x.amount,0)+Number(legacy?.expenses||0);
    return json({date,sales:totalSales,expenses:totalExpenses,profit:totalSales-totalExpenses,
      saleCount:sales.length+legacyHistory.filter(x=>Number(x.total)>0).length,
      salesItems:[...legacyHistory.filter(x=>Number(x.total)>0).map(x=>({time:x.time||"Imported historical sale",customer:x.customerName||"Imported customer",table:x.table||"N/A",items:x.items||[],total:Number(x.total)})),
        ...sales.map(x=>({time:new Date(x.created_at).toLocaleString("en-NG",{timeZone:timezone(env)}),customer:x.customer_name,table:x.table_name,items:JSON.parse(x.items_json),total:x.total}))],
      expensesList:[...(legacy&&Number(legacy.expenses)>0?[{description:"Imported previous browser expenses",amount:legacy.expenses}]:[]),...expenses]});
  }

  if (method === "POST" && path === "/api/migrate-local") {
    needManager(user);
    const envelope=body.snapshot;
    if(!envelope||typeof envelope!=="object"||Array.isArray(envelope))return json({error:"Choose a Palm Villa export file."},400);
    const snapshot=envelope.storage&&typeof envelope.storage==="object"?envelope.storage:envelope;
    const data=snapshot.palmVillaData&&typeof snapshot.palmVillaData==="object"?snapshot.palmVillaData:{};
    const date=/^\d{4}-\d{2}-\d{2}$/.test(data.date||"")?data.date:businessDate(env);
    if(businessDate(env,new Date(`${date}T12:00:00.000Z`))!==date)return json({error:"The export contains an invalid business date."},400);
    const source=JSON.stringify(snapshot),hash=await digest(source);
    if(await env.DB.prepare("SELECT digest FROM legacy_imports WHERE digest=?").bind(hash).first())return json({alreadyImported:true,date});
    if(await env.DB.prepare("SELECT digest FROM legacy_imports WHERE business_date=?").bind(date).first())return json({error:`A browser export for ${date} was already imported. The existing import was left unchanged.`},409);
    const totalSales=Number(data.sales||0),totalExpenses=Number(data.expenses||0);
    if(![totalSales,totalExpenses].every(Number.isSafeInteger)||totalSales<0||totalExpenses<0)return json({error:"The export contains invalid daily totals."},400);
    const salesItems=Array.isArray(data.salesHistory)?data.salesHistory.slice(0,5000).map(x=>({name:String(x.name||"Imported item").slice(0,100),qty:Math.max(0,Math.min(999,Number(x.qty)||0)),total:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(x.total)||0))})):[];
    const staffHistory=Array.isArray(data.staffHistory)?data.staffHistory.slice(0,5000).map(x=>({
      customerName:String(x.customerName||"Walk-in").slice(0,120),table:String(x.table||"N/A").slice(0,40),
      items:Array.isArray(x.items)?x.items.slice(0,100).map(line=>({name:String(line.name||"Imported item").slice(0,100),qty:Math.max(0,Math.min(999,Number(line.qty)||0)),price:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(line.price)||0))})):[],
      total:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(x.total)||0)),time:String(x.time||"Imported historical record").slice(0,100),status:String(x.status||"Imported").slice(0,40)
    })):[];
    const oldCustomers=Array.isArray(snapshot.palmVillaCustomers)?snapshot.palmVillaCustomers.slice(0,200):[];
    const oldDrinks=Array.isArray(snapshot.palmVillaDrinks)?snapshot.palmVillaDrinks.slice(0,200):[];
    const menuRows=await env.DB.prepare("SELECT name,price FROM menu_items WHERE active=1").all();
    const menuPrices=new Map(menuRows.results.map(row=>[row.name,row.price]));
    const time=iso(), statements=[env.DB.prepare("INSERT INTO legacy_imports(digest,business_date,sales,expenses,sales_items_json,staff_history_json,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(hash,date,totalSales,totalExpenses,JSON.stringify(salesItems),JSON.stringify(staffHistory),user.id,time)];
    for(const old of oldCustomers){
      const name=String(old.name||"").trim().slice(0,120);if(!name)continue;
      const table=String(old.table||"N/A").trim().slice(0,40)||"N/A";
      const cart=[];for(const line of (Array.isArray(old.cart)?old.cart:[]).slice(0,100)){const itemName=String(line.name||""),qty=Number(line.qty),price=menuPrices.get(itemName);if(price!==undefined&&Number.isSafeInteger(qty)&&qty>0&&qty<=999)cart.push({name:itemName,price,qty});}
      const orders=(Array.isArray(old.orders)?old.orders:[]).slice(0,500).map(order=>({
        items:Array.isArray(order.items)?order.items.slice(0,100).map(line=>({name:String(line.name||"Imported item").slice(0,100),qty:Math.max(0,Math.min(999,Number(line.qty)||0)),price:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(line.price)||0))})):[],
        total:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(order.total)||0)),paid:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(order.paid)||0)),owed:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(order.owed)||0)),
        isCredit:Boolean(order.isCredit||Number(order.owed)>0),time:String(order.time||"Imported historical record").slice(0,100),date:String(order.date||"Imported historical record").slice(0,100),status:String(order.status||(Number(order.owed)>0?"Unpaid":"Paid")).slice(0,40)}));
      const payments=(Array.isArray(old.payments)?old.payments:[]).slice(0,1000).flatMap(p=>{const amount=Number(p.amount);return Number.isSafeInteger(amount)&&amount>0?[{amount,time:String(p.time||"Imported historical payment").slice(0,100)}]:[];});
      const owed=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(old.owed)||0)),paid=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(old.paid)||0)),id=uuid();
      statements.push(env.DB.prepare("INSERT INTO customers(id,name,table_name,cart_json,orders_json,owed,paid,payments_json,created_by,created_at,updated_at,closed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id,name,table,JSON.stringify(cart),JSON.stringify(orders),owed,paid,JSON.stringify(payments),user.id,time,time,cart.length?0:1));
    }
    for(const drink of oldDrinks){const brand=String(drink.brand||"").trim().slice(0,120),bought=Number(drink.bought),buyPrice=Number(drink.buyPrice),sold=Number(drink.sold),sellPrice=Number(drink.sellPrice);
      if(brand&&[bought,buyPrice,sold,sellPrice].every(Number.isSafeInteger)&&bought>0&&buyPrice>0&&sold>=0&&sold<=bought&&sellPrice>0)statements.push(env.DB.prepare("INSERT INTO drinks_inventory(id,brand,bought,buy_price,sold,sell_price,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),brand,bought,buyPrice,sold,sellPrice,user.id,time));}
    statements.push(env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"legacy_data.imported",JSON.stringify({date,customerCount:oldCustomers.length,drinkCount:oldDrinks.length,digest:hash}),time));
    await env.DB.batch(statements);
    return json({imported:true,date,customers:oldCustomers.length,drinks:oldDrinks.length},201);
  }

  if (method === "POST" && path === "/api/customers") {
    const name=clean(body.name,"Customer name"), table=clean(body.table,"Table"), id=uuid(), time=iso();
    await env.DB.prepare("INSERT INTO customers(id,name,table_name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,name,table,user.id,time,time).run();
    await audit(env,user.id,"customer.created",{customerId:id,table});
    return json(mapCustomer(await customerById(env,id)),201);
  }
  let match=path.match(/^\/api\/customers\/([0-9a-f-]+)\/cart$/i);
  if(method==="PUT"&&match){
    const customer=await customerById(env,match[1]); if(!customer)return json({error:"Customer not found."},404);
    if(!Array.isArray(body.items)||body.items.length>100)return json({error:"Invalid cart."},400);
    const items=await resolveItems(env,body.items,"Cart contains an unavailable item or invalid quantity.",true);
    if(!Number.isSafeInteger(Number(body.version)))return json({error:"Cart version is missing. Reload the order and try again."},400);
    const result=await env.DB.prepare("UPDATE customers SET cart_json=?,updated_at=?,version=version+1,closed=0 WHERE id=? AND version=?")
      .bind(JSON.stringify(items),iso(),customer.id,Number(body.version)).run();
    if(!result.meta.changes)return json({error:"Another device changed this order. Reload it before making more changes."},409);
    return json({cart:items,version:customer.version+1});
  }
  match=path.match(/^\/api\/customers\/([0-9a-f-]+)\/payments$/i);
  if(method==="POST"&&match){
    needManager(user);const c=await customerById(env,match[1]);if(!c)return json({error:"Customer not found."},404);
    const amount=Number(body.amount),owed=Number(c.owed)||0;if(!Number.isSafeInteger(amount)||amount<=0||amount>owed)return json({error:`Enter a whole amount from ₦1 to ₦${owed.toLocaleString()}.`},400);
    const payment={amount,time:iso()},payments=JSON.parse(c.payments_json||"[]"),orders=JSON.parse(c.orders_json);payments.push(payment);let remaining=amount;
    for(const order of orders){const due=Number(order.owed)||0;if(due<=0||remaining<=0)continue;const applied=Math.min(due,remaining);order.owed=due-applied;order.paid=(Number(order.paid)||0)+applied;order.status=order.owed>0?"Unpaid":"Paid";remaining-=applied;}
    await env.DB.batch([env.DB.prepare("UPDATE customers SET owed=owed-?,paid=paid+?,payments_json=?,orders_json=?,updated_at=? WHERE id=?").bind(amount,amount,JSON.stringify(payments),JSON.stringify(orders),payment.time,c.id),
      env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"customer.payment_recorded",JSON.stringify({customerId:c.id,amount}),payment.time)]);
    return json({payment,owed:owed-amount},201);
  }

  if(method==="POST"&&path==="/api/sales"){
    const customer=body.customerId?await customerById(env,body.customerId):null;if(body.customerId&&!customer)return json({error:"Customer not found."},404);
    const cart=customer?JSON.parse(customer.cart_json):body.items;if(!Array.isArray(cart)||cart.length===0||cart.length>100)return json({error:"Cart is empty or invalid."},400);
    const items=await resolveItems(env,cart,"Sale contains an unavailable item or invalid quantity.");
    const total=items.reduce((s,x)=>s+x.price*x.qty,0);if(!Number.isSafeInteger(total))return json({error:"Sale total exceeds allowed limits."},400);
    const paid=body.amountPaid===undefined?total:Number(body.amountPaid);if(!Number.isSafeInteger(paid)||paid<0||paid>total)return json({error:"Amount paid must be a whole amount between ₦0 and the sale total."},400);
    const owed=total-paid,id=uuid(),time=iso(),customerName=customer?.name||"Walk-in",table=customer?.table_name||"Walk-in", stmts=[];
    stmts.push(env.DB.prepare("INSERT INTO sales(id,customer_id,customer_name,table_name,items_json,total,cashier_id,created_at,business_date) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id,customer?.id||null,customerName,table,JSON.stringify(items),total,user.id,time,businessDate(env)));
    if(customer){const orders=JSON.parse(customer.orders_json);orders.push({items,total,paid,owed,isCredit:owed>0,time,date:new Intl.DateTimeFormat("en-NG",{timeZone:timezone(env),day:"2-digit",month:"short",year:"numeric"}).format(new Date(time)),status:owed>0?"Unpaid":"Paid"});
      const payments=JSON.parse(customer.payments_json||"[]");if(paid>0)payments.push({amount:paid,time});
      stmts.push(env.DB.prepare("UPDATE customers SET cart_json='[]',orders_json=?,owed=owed+?,paid=paid+?,payments_json=?,updated_at=?,version=version+1,closed=1 WHERE id=?")
        .bind(JSON.stringify(orders),owed,paid,JSON.stringify(payments),time,customer.id));}
    stmts.push(env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"sale.completed",JSON.stringify({saleId:id,total,itemCount:items.length}),time));
    await env.DB.batch(stmts);return json({id,total,amountPaid:paid,amountOwed:owed,items,customerName,table,createdAt:time},201);
  }
  if(method==="POST"&&path==="/api/expenses"){
    needManager(user);const amount=Number(body.amount);if(!Number.isSafeInteger(amount)||amount<1)return json({error:"Enter a valid whole-naira amount."},400);
    const description=clean(body.description||"General expense","Expense description"),id=uuid(),time=iso();
    await env.DB.batch([env.DB.prepare("INSERT INTO expenses(id,description,amount,created_by,created_at,business_date) VALUES(?,?,?,?,?,?)").bind(id,description,amount,user.id,time,businessDate(env)),
      env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"expense.created",JSON.stringify({expenseId:id,amount}),time)]);
    return json({id,amount,description},201);
  }
  if(method==="POST"&&path==="/api/drinks"){
    needManager(user);const brand=clean(body.brand,"Drink brand"),bought=Number(body.bought),buyPrice=Number(body.buyPrice),sold=Number(body.sold),sellPrice=Number(body.sellPrice);
    if(![bought,buyPrice,sold,sellPrice].every(Number.isSafeInteger)||bought<1||buyPrice<1||sold<0||sold>bought||sellPrice<1)return json({error:"Enter valid stock quantities and prices."},400);
    const id=uuid(),time=iso();await env.DB.batch([env.DB.prepare("INSERT INTO drinks_inventory(id,brand,bought,buy_price,sold,sell_price,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,brand,bought,buyPrice,sold,sellPrice,user.id,time),
      env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"inventory.created",JSON.stringify({inventoryId:id,brand,bought,sold}),time)]);
    return json({id,brand,bought,buyPrice,sold,sellPrice,stock:bought-sold},201);
  }
  if(method==="POST"&&path==="/api/menu-prices"){
    needManager(user);const name=clean(body.name,"Menu item"),price=Number(body.price);if(!Number.isSafeInteger(price)||price<0)return json({error:"Price must be a whole-naira amount."},400);
    const result=await env.DB.prepare("UPDATE menu_items SET price=? WHERE name=?").bind(price,name).run();if(!result.meta.changes)return json({error:"Menu item not found."},404);
    await audit(env,user.id,"menu.price_changed",{name,price});return json({name,price});
  }
  if(method==="POST"&&path==="/api/activity"){
    if(!["item-added","cart-cleared"].includes(body.action))return json({error:"Unsupported activity."},400);
    const customerId=body.customerId?String(body.customerId):null;if(customerId&&!await customerById(env,customerId))return json({error:"Customer not found."},404);
    const items=Array.isArray(body.items)?body.items.slice(0,100).map(x=>({name:String(x.name||"").slice(0,100),qty:Math.max(0,Math.min(999,Number(x.qty)||0)),price:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(x.price)||0))})):[];
    const total=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Number(body.total)||0));await audit(env,user.id,body.action==="item-added"?"cart.item_added":"cart.cleared",{customerId,items,total});return json({ok:true},201);
  }

  if(method==="POST"&&path==="/api/users"){
    needManager(user);const username=clean(body.username,"Username",50),password=String(body.password||""),role=body.role==="manager"?"manager":"staff";
    if(username.length<3||password.length<12||password.length>1024)return json({error:"Username must be at least 3 characters and password at least 12 characters."},400);
    const id=uuid();try{await env.DB.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)").bind(id,username,await passwordHash(password),role,iso()).run();}
    catch(e){if(String(e.message).includes("UNIQUE"))return json({error:"That username is already in use."},409);throw e;}
    await audit(env,user.id,"user.created",{userId:id,username,role});return json({id,username,role},201);
  }
  if(method==="GET"&&path==="/api/users"){
    needManager(user);const q=await env.DB.prepare("SELECT id,username,role,active,created_at FROM users ORDER BY role,username COLLATE NOCASE").all();
    return json({users:q.results.map(x=>({...x,active:Boolean(x.active)}))});
  }
  match=path.match(/^\/api\/users\/([0-9a-f-]+)$/i);
  if(method==="PATCH"&&match){
    needManager(user);if(typeof body.active!=="boolean")return json({error:"Choose whether the account should be active."},400);
    const target=await env.DB.prepare("SELECT id,username,role,active FROM users WHERE id=?").bind(match[1]).first();if(!target)return json({error:"Account not found."},404);
    if(!body.active&&target.id===user.id)return json({error:"You cannot disable the account you are using."},400);
    if(!body.active&&target.role==="manager"){const n=await env.DB.prepare("SELECT COUNT(*) count FROM users WHERE role='manager' AND active=1").first();if(n.count<=1)return json({error:"Keep at least one active manager account."},400);}
    const stmts=[env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(body.active?1:0,target.id)];if(!body.active)stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id));
    stmts.push(env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,body.active?"user.enabled":"user.disabled",JSON.stringify({userId:target.id,username:target.username}),iso()));
    await env.DB.batch(stmts);return json({id:target.id,username:target.username,role:target.role,active:body.active});
  }
  match=path.match(/^\/api\/users\/([0-9a-f-]+)\/password$/i);
  if(method==="POST"&&match){
    needManager(user);if(match[1]===user.id)return json({error:"Use Change Password for your own account."},400);
    const password=String(body.password||"");if(password.length<12||password.length>1024)return json({error:"Temporary password must be 12 to 1024 characters."},400);
    const target=await env.DB.prepare("SELECT id,username FROM users WHERE id=?").bind(match[1]).first();if(!target)return json({error:"Account not found."},404);
    await env.DB.batch([env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(await passwordHash(password),target.id),env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id),
      env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"user.password_reset",JSON.stringify({userId:target.id,username:target.username}),iso())]);return json({ok:true});
  }
  if(method==="POST"&&path==="/api/account/password"){
    const password=String(body.currentPassword||""),next=String(body.newPassword||""),account=await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.id).first();
    if(!(await checkPassword(password,account.password_hash)))return json({error:"Current password is incorrect."},401);if(next.length<12||next.length>1024)return json({error:"New password must be at least 12 characters."},400);
    await env.DB.batch([env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(await passwordHash(next),user.id),env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
      env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user.id,"account.password_changed","{}",iso())]);return json({ok:true},200,{"Set-Cookie":cookie("",0)});
  }
  return json({error:"API route not found."},404);
}

async function fetchHandler(request, env) {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/")) return await api(request,env,url);
    if (!["GET","HEAD"].includes(request.method)) return json({error:"Method not allowed."},405);
    let path;try{path=decodeURIComponent(url.pathname==="/"?"/orders.html":url.pathname);}catch{return new Response("Bad request",{status:400});}
    if(!STATIC_FILES.has(path))return new Response("Not found",{status:404});
    const role=PROTECTED[path];if(role){const user=await currentUser(request,env);if(!user)return Response.redirect(new URL("/login.html?next=%2Findex.html",url),302);if(role==="manager"&&user.role!=="manager")return Response.redirect(new URL("/orders.html",url),302);}
    const assetUrl=new URL(path,url);const response=await env.ASSETS.fetch(new Request(assetUrl,{method:request.method,headers:request.headers}));
    const headers=new Headers(response.headers);headers.set("X-Content-Type-Options","nosniff");headers.set("X-Frame-Options","DENY");headers.set("Referrer-Policy","strict-origin-when-cross-origin");
    headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    headers.set("Cache-Control",path==="/sw.js"?"no-cache":"no-store");return new Response(response.body,{status:response.status,headers});
  } catch(error) {
    const status=error.status||500;if(status>=500)console.error(error);return json({error:status>=500?"Server error.":error.message},status);
  }
}
export default { fetch: fetchHandler };
