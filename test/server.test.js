"use strict";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmvilla-test-"));
let db;
let handleApi;
let handleRequest;
let staticFiles;
let managerCookie;
let staffCookie;

function mockRequest(method, body = {}, cookie = "", urlPath = "/") {
  const chunks = ["POST", "PUT", "PATCH"].includes(method) ? [Buffer.from(JSON.stringify(body))] : [];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = urlPath;
  req.headers = { cookie, host: "localhost" };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(body = "") {
      this.body = body.toString();
      return this;
    }
  };
}

async function api(urlPath, { method = "GET", body = {}, cookie = "" } = {}) {
  const req = mockRequest(method, body, cookie, urlPath);
  const res = mockResponse();
  await handleRequest(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, headers: res.headers, json, body: res.body };
}

async function signIn(username, password) {
  const response = await api("/api/login", { method: "POST", body: { username, password } });
  assert.equal(response.status, 200, response.json?.error || "Sign-in failed.");
  return response.headers["Set-Cookie"].split(";")[0];
}

before(async () => {
  process.env.PALMVILLA_TESTING = "1";
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-only-secret-with-more-than-thirty-two-characters";
  process.env.MANAGER_USERNAME = "owner";
  process.env.MANAGER_PASSWORD = "temporary-test-manager-password";
  process.env.DATABASE_PATH = path.join(tempDir, "palmvilla.sqlite");
  process.env.BACKUP_PATH = path.join(tempDir, "backups");
  ({ db, handleApi, handleRequest, staticFiles } = require("../server.js"));
  managerCookie = await signIn("owner", "temporary-test-manager-password");
});

after(() => {
  if (db) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("protects manager pages and does not serve private files", async () => {
  const managerResponse = mockResponse();
  await handleRequest(mockRequest("GET", {}, "", "/index.html"), managerResponse);
  assert.equal(managerResponse.statusCode, 302);
  assert.equal(managerResponse.headers.Location, "/login.html?next=%2Findex.html");
  assert.equal(staticFiles.has("/server.js"), false);
  assert.equal(staticFiles.has("/package.json"), false);
});

test("keeps staff and manager permissions separate", async () => {
  const created = await api("/api/users", {
    method: "POST", cookie: managerCookie,
    body: { username: "shiftstaff", password: "temporary-test-staff-password", role: "staff" }
  });
  assert.equal(created.status, 201);
  staffCookie = await signIn("shiftstaff", "temporary-test-staff-password");

  const deniedExpense = await api("/api/expenses", {
    method: "POST", cookie: staffCookie, body: { amount: 500, description: "Test" }
  });
  assert.equal(deniedExpense.status, 403);
});

test("validates server prices and stores sales in durable daily reports", async () => {
  const repriced = await api("/api/menu-prices", {
    method: "POST", cookie: managerCookie, body: { name: "Isi Ewu", price: 12500 }
  });
  assert.equal(repriced.status, 200);

  const createdCustomer = await api("/api/customers", {
    method: "POST", cookie: staffCookie, body: { name: "Demo Table", table: "Table 2" }
  });
  assert.equal(createdCustomer.status, 201);
  assert.equal(createdCustomer.json.version, 0);

  const cart = await api(`/api/customers/${createdCustomer.json.id}/cart`, {
    method: "PUT", cookie: staffCookie,
    body: { version: 0, items: [{ name: "Isi Ewu", qty: 2 }] }
  });
  assert.equal(cart.status, 200);
  assert.equal(cart.json.cart[0].price, 12500);

  const staleCart = await api(`/api/customers/${createdCustomer.json.id}/cart`, {
    method: "PUT", cookie: staffCookie,
    body: { version: 0, items: [{ name: "Isi Ewu", qty: 1 }] }
  });
  assert.equal(staleCart.status, 409);

  const sale = await api("/api/sales", {
    method: "POST", cookie: staffCookie, body: { customerId: createdCustomer.json.id }
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.json.total, 25000);

  const state = await api("/api/state", { cookie: managerCookie });
  assert.equal(state.json.sales, 25000);
  assert.equal(state.json.customers.find(customer => customer.id === createdCustomer.json.id).cart.length, 0);
  assert.equal(state.json.customers.find(customer => customer.id === createdCustomer.json.id).closed, true);

  const report = await api(`/api/reports?date=${state.json.date}`, { cookie: managerCookie });
  assert.equal(report.status, 200);
  assert.equal(report.json.sales, 25000);
  assert.equal(report.json.saleCount, 1);
});

test("imports a browser export once without discarding customer records", async () => {
  const state = await api("/api/state", { cookie: managerCookie });
  const snapshot = {
    palmVillaData: {
      date: state.json.date, sales: 7000, expenses: 500,
      salesHistory: [{ name: "Legacy Nkwobi", qty: 1, total: 3000 }],
      staffHistory: [{ customerName: "Legacy guest", table: "VIP", items: [], total: 7000, time: "Earlier" }]
    },
    palmVillaCustomers: [{
      name: "Legacy guest", table: "VIP", cart: [], owed: 2500, paid: 1000,
      orders: [{ items: [{ name: "Legacy Nkwobi", qty: 1, price: 5000 }], total: 5000, paid: 2500, owed: 2500, isCredit: true }],
      payments: [{ amount: 1000, time: "Earlier" }]
    }],
    palmVillaDrinks: []
  };
  const imported = await api("/api/migrate-local", { method: "POST", cookie: managerCookie, body: { snapshot } });
  assert.equal(imported.status, 201);
  assert.equal(imported.json.customers, 1);

  const repeated = await api("/api/migrate-local", { method: "POST", cookie: managerCookie, body: { snapshot } });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.alreadyImported, true);

  const report = await api(`/api/reports?date=${state.json.date}`, { cookie: managerCookie });
  assert.equal(report.json.sales, 32000);
  assert.equal(report.json.expenses, 500);
  const debtLedger = await api("/api/debts", { cookie: managerCookie });
  const legacyCustomer = debtLedger.json.customers.find(customer => customer.name === "Legacy guest");
  assert.equal(legacyCustomer.owed, 2500);
  assert.equal(legacyCustomer.paid, 1000);
  assert.equal(legacyCustomer.orders[0].isCredit, true);
});

test("lets managers revoke and reset staff access", async () => {
  const created = await api("/api/users", {
    method: "POST", cookie: managerCookie,
    body: { username: "formerstaff", password: "temporary-test-old-password", role: "staff" }
  });
  assert.equal(created.status, 201);
  const oldCookie = await signIn("formerstaff", "temporary-test-old-password");

  const reset = await api(`/api/users/${created.json.id}/password`, {
    method: "POST", cookie: managerCookie, body: { password: "temporary-test-new-password" }
  });
  assert.equal(reset.status, 200);
  const revoked = await api("/api/state", { cookie: oldCookie });
  assert.equal(revoked.status, 401);

  const newCookie = await signIn("formerstaff", "temporary-test-new-password");
  const disabled = await api(`/api/users/${created.json.id}`, {
    method: "PATCH", cookie: managerCookie, body: { active: false }
  });
  assert.equal(disabled.status, 200);
  const disabledRequest = await api("/api/state", { cookie: newCookie });
  assert.equal(disabledRequest.status, 401);
});

test("requires authentication and writes a daily SQLite backup", async () => {
  const denied = await api("/api/state");
  assert.equal(denied.status, 401);
  assert.equal(fs.readdirSync(path.join(tempDir, "backups")).length, 1);
});

test("records credit sales and manager payments in the protected debt ledger", async () => {
  const customer = await api("/api/customers", {
    method: "POST", cookie: staffCookie, body: { name: "Credit Table", table: "VIP" }
  });
  const cart = await api(`/api/customers/${customer.json.id}/cart`, {
    method: "PUT", cookie: staffCookie, body: { version: 0, items: [{ name: "Nkwobi", qty: 1 }] }
  });
  assert.equal(cart.status, 200);
  const sale = await api("/api/sales", {
    method: "POST", cookie: staffCookie, body: { customerId: customer.json.id, amountPaid: 1000 }
  });
  assert.equal(sale.status, 201);
  assert.ok(sale.json.amountOwed > 0);

  const staffLedger = await api("/api/debts", { cookie: staffCookie });
  assert.equal(staffLedger.status, 403);
  const managerLedger = await api("/api/debts", { cookie: managerCookie });
  const account = managerLedger.json.customers.find(row => row.id === customer.json.id);
  assert.equal(account.owed, sale.json.amountOwed);
  assert.equal(account.paid, 1000);
  assert.equal(managerLedger.json.creditSales, sale.json.total + 5000);

  const overpayment = await api(`/api/customers/${customer.json.id}/payments`, {
    method: "POST", cookie: managerCookie, body: { amount: sale.json.amountOwed + 1 }
  });
  assert.equal(overpayment.status, 400);
  const payment = await api(`/api/customers/${customer.json.id}/payments`, {
    method: "POST", cookie: managerCookie, body: { amount: sale.json.amountOwed }
  });
  assert.equal(payment.status, 201);
  const settled = await api("/api/debts", { cookie: managerCookie });
  const paidAccount = settled.json.customers.find(row => row.id === customer.json.id);
  assert.equal(paidAccount.owed, 0);
  assert.equal(paidAccount.orders[0].status, "Paid");
  assert.equal(paidAccount.payments.length, 2);
});
