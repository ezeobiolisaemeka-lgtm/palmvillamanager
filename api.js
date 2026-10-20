"use strict";

(() => {
  const pendingCartWrites = new Map();
  const cartVersions = new Map();

  async function request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("/login.html");
      throw new Error("Your session ended. Sign in again.");
    }
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  const sendJson = (method, body) => ({ method, body: JSON.stringify(body) });
  window.PalmVillaApi = Object.freeze({
    async getState() {
      const state = await request("/state");
      if (pendingCartWrites.size === 0) {
        cartVersions.clear();
        for (const customer of state.customers || []) cartVersions.set(customer.id, customer.version);
      }
      return state;
    },
    getReport: date => request(`/reports?date=${encodeURIComponent(date)}`),
    createCustomer: (name, table) => request("/customers", sendJson("POST", { name, table })),
    updateCart(customerId, items, version) {
      const previous = pendingCartWrites.get(customerId) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => request(
        `/customers/${encodeURIComponent(customerId)}/cart`,
        sendJson("PUT", { items: items.map(({ name, qty }) => ({ name, qty })), version: cartVersions.get(customerId) ?? version })
      )).then((result) => {
        cartVersions.set(customerId, result.version);
        return result;
      }).catch((error) => {
        if (error.status === 409) cartVersions.delete(customerId);
        throw error;
      });
      pendingCartWrites.set(customerId, next);
      next.finally(() => {
        if (pendingCartWrites.get(customerId) === next) pendingCartWrites.delete(customerId);
      }).catch(() => {});
      return next;
    },
    hasPendingCartWrites: () => pendingCartWrites.size > 0,
    completeSale: (customerId, amountPaid) => request("/sales", sendJson("POST", { customerId, amountPaid })),
    getDebts: () => request("/debts"),
    recordPayment: (customerId, amount) => request(`/customers/${encodeURIComponent(customerId)}/payments`, sendJson("POST", { amount })),
    addExpense: (amount, description) => request("/expenses", sendJson("POST", { amount, description })),
    addDrink: drink => request("/drinks", sendJson("POST", drink)),
    logActivity: (action, customerId, items = [], total = 0) => request("/activity", sendJson("POST", { action, customerId, items, total })),
    updatePrice: (name, price) => request("/menu-prices", sendJson("POST", { name, price })),
    createUser: user => request("/users", sendJson("POST", user)),
    getUsers: () => request("/users"),
    setUserActive: (userId, active) => request(`/users/${encodeURIComponent(userId)}`, sendJson("PATCH", { active })),
    resetUserPassword: (userId, password) => request(`/users/${encodeURIComponent(userId)}/password`, sendJson("POST", { password })),
    changePassword: (currentPassword, newPassword) => request("/account/password", sendJson("POST", { currentPassword, newPassword})),
    logout: async () => {
      await request("/logout", { method: "POST" });
      window.location.replace("/login.html");
    }
  });
})();
