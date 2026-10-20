"use strict";

(() => {
  let ledger = { customers: [], totalOutstanding: 0, cashCollectedToday: 0, creditSales: 0, debtorCount: 0 };
  const money = value => `₦${Number(value || 0).toLocaleString()}`;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  async function loadLedger() {
    try {
      ledger = await PalmVillaApi.getDebts();
      document.getElementById("totalDebt").textContent = money(ledger.totalOutstanding);
      document.getElementById("cashToday").textContent = money(ledger.cashCollectedToday);
      document.getElementById("creditSales").textContent = money(ledger.creditSales);
      document.getElementById("debtorCount").textContent = String(ledger.debtorCount);
      renderDebtList();
    } catch (error) {
      if (error.status !== 401) {
        document.getElementById("debtsList").innerHTML = `<p role="alert">Could not load ledger: ${escapeHtml(error.message)}</p>`;
      }
    }
  }

  function renderDebtList() {
    const search = document.getElementById("customerSearch").value.trim().toLowerCase();
    const filter = document.getElementById("statusFilter").value;
    const customers = ledger.customers.filter(customer => {
      const text = `${customer.name} ${customer.table}`.toLowerCase();
      const owes = Number(customer.owed) > 0;
      return (!search || text.includes(search))
        && (filter === "all" || (filter === "owing" && owes) || (filter === "paid" && !owes && customer.orders.length > 0));
    });
    const list = document.getElementById("debtsList");
    if (!customers.length) {
      list.innerHTML = '<div class="empty">No matching customer found.</div>';
      return;
    }
    list.innerHTML = customers.map(customer => {
      const orderHtml = customer.orders.map(order => {
        const items = (order.items || []).map(item => `<li>${escapeHtml(item.name)} × ${Number(item.qty) || 0} — ${money((Number(item.price) || 0) * (Number(item.qty) || 0))}</li>`).join("");
        return `<div class="ledger-order"><strong>${escapeHtml(order.date || order.time || "Order")}</strong>
          <ul class="ledger-orders">${items || "<li>No items recorded</li>"}</ul>
          <div><strong>Total:</strong> ${money(order.total)} · <strong>Paid:</strong> ${money(order.paid)} · <strong>Owed:</strong> ${money(order.owed)}</div></div>`;
      }).join("") || "<p>No orders recorded.</p>";
      const paymentHtml = customer.payments.map(payment => `<li>${escapeHtml(payment.time)} — ${money(payment.amount)}</li>`).join("") || "<li>No payments recorded</li>";
      const owed = Number(customer.owed) || 0;
      return `<article class="ledger-item">
        <h3>${escapeHtml(customer.name)}</h3>
        <div class="ledger-meta">Table: ${escapeHtml(customer.table)} · Orders: ${customer.orders.length}</div>
        ${orderHtml}
        <div class="payment-row"><strong>Payment history</strong></div>
        <ul class="ledger-orders">${paymentHtml}</ul>
        <div class="${owed > 0 ? "outstanding-amount" : "paid-amount"}">Outstanding balance: ${money(owed)}</div>
        ${owed > 0 ? `<div class="payment-row"><button type="button" data-record-payment="${escapeHtml(customer.id)}">✅ Record Payment</button></div>` : ""}
      </article>`;
    }).join("");
  }

  async function exportLedgerCsv() {
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Customer", "Table", "Orders", "Credit Sales", "Paid", "Owed", "Items"]];
    ledger.customers.forEach(customer => {
      const creditOrders = customer.orders.filter(order => order.isCredit || Number(order.owed) > 0);
      const items = creditOrders.flatMap(order => order.items || []).map(item => `${item.name} x${item.qty}`).join(" | ");
      rows.push([customer.name, customer.table, customer.orders.length,
        creditOrders.reduce((total, order) => total + Number(order.total || 0), 0), customer.paid, customer.owed, items]);
    });
    const blob = new Blob([rows.map(row => row.map(quote).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "palm-villa-ledger.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById("customerSearch").addEventListener("input", renderDebtList);
  document.getElementById("statusFilter").addEventListener("change", renderDebtList);
  document.getElementById("exportLedgerBtn").addEventListener("click", exportLedgerCsv);
  document.getElementById("debtsList").addEventListener("click", async event => {
    const button = event.target.closest("[data-record-payment]");
    if (!button) return;
    const customer = ledger.customers.find(item => item.id === button.dataset.recordPayment);
    if (!customer) return;
    const raw = prompt(`Outstanding balance: ${money(customer.owed)}\nPayment amount:`, String(customer.owed));
    if (raw === null) return;
    const amount = Number(raw.trim());
    if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(amount) || amount <= 0 || amount > customer.owed) {
      alert(`Enter a whole amount between ₦1 and ${money(customer.owed)}.`);
      return;
    }
    try {
      await PalmVillaApi.recordPayment(customer.id, amount);
      await loadLedger();
      alert(`Payment for ${customer.name} recorded.`);
    } catch (error) {
      alert(`Payment was not recorded: ${error.message}`);
    }
  });
  loadLedger();
})();
