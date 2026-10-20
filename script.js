let cart = [];
let customers = [];
let currentCustomer = null;
let sales = 0;
let expenses = 0;
let salesHistory = [];
let staffHistory = [];

function getLocalDateKey(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
}

let currentBusinessDate = getLocalDateKey();

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function saveCustomers() {
    const customer = getSelectedCustomer();
    if (!customer || !customer.id) return Promise.resolve();
    return PalmVillaApi.updateCart(customer.id, customer.cart || [], customer.version).then((result) => {
        customer.version = result.version;
    }).catch((error) => {
        console.error("Cart save failed:", error);
        alert(`Your cart could not be saved: ${error.message}`);
        throw error;
    });
}

function getSelectedCustomer() {
    if (currentCustomer === null || !customers[currentCustomer]) {
        return null;
    }

    return customers[currentCustomer];
}

function syncCartWithCustomer() {
    const customer = getSelectedCustomer();

    if (customer) {
        cart = Array.isArray(customer.cart) ? customer.cart : [];
    } else {
        cart = [];
    }

    displayCart();
}

function rollOverBusinessDayIfNeeded() {
    const dateKey = getLocalDateKey();
    if (dateKey === currentBusinessDate) return;

    currentBusinessDate = dateKey;
    loadData();
}

const menuPrices = {
    // Shared source of truth: edit these naira amounts to update every menu and cart total.
    "Isi Ewu": 9000,
    "Nkwobi": 3000,
    "Pepper Soup": 2500,
    "Catfish Peppersoup": 16000,
    "Ugba": 4000,
    "Assorted Pomo": 200,
    "Abacha": 6000,
    "Panla": 1500,
    "Palm Wine": 3000,
    "Gulder": 1500,
    "Desperado": 1500,
    "Budweiser": 1500,
    "Heineken": 1500,
    "Trophy": 1200,
    "Goldberg": 1300,
    "Star": 1500,
    "33": 1300,
    "Small Stout": 1200,
    "Big Stout": 2000,
    "Smire Off Ice": 1200,
    "Gordon's": 10000,
    "Best Whiskey": 2500,
    "Longrider": 1600,
    "Legend": 1500,
    "Eagle": 1200,
    "Castle Lite": 1300,
    "Table Water": 300,
    "Coke": 700,
    "Fanta": 700,
    "Sprite": 700,
    "Pepsi": 700,
    "Malt": 1000,
    "Fayrouz": 1000
};

function synchronizeMenuPrices() {
    const priceSelect = document.getElementById("priceEditorItem");
    if (priceSelect) {
        const selected = priceSelect.value;
        priceSelect.innerHTML = Object.keys(menuPrices).map(name =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)} — ₦${menuPrices[name].toLocaleString()}</option>`
        ).join("");
        if (Object.prototype.hasOwnProperty.call(menuPrices, selected)) priceSelect.value = selected;
    }
    document.querySelectorAll(".item button[onclick]").forEach((button) => {
        const handler = button.getAttribute("onclick") || "";
        const match = handler.match(/^addToCart\('((?:\\.|[^'])*)',\s*\d+\)$/);
        if (!match) return;

        const itemName = match[1].replace(/\\'/g, "'");
        if (!Object.prototype.hasOwnProperty.call(menuPrices, itemName)) return;

        const price = menuPrices[itemName];
        const priceElement = button.closest(".item")?.querySelector("p");
        if (priceElement) priceElement.textContent = `₦${price.toLocaleString()}`;
        button.onclick = () => addToCart(itemName, price);
    });
}

async function updateMenuPrice() {
    const itemName = document.getElementById("priceEditorItem")?.value;
    const field = document.getElementById("priceEditorAmount");
    const amount = Number(field?.value);
    if (!itemName || !Number.isSafeInteger(amount) || amount < 0) {
        alert("Choose a menu item and enter a valid whole-naira price.");
        return;
    }
    try {
        await PalmVillaApi.updatePrice(itemName, amount);
        menuPrices[itemName] = amount;
        synchronizeMenuPrices();
        field.value = "";
        alert(`${itemName} price updated to ₦${amount.toLocaleString()}.`);
    } catch (error) {
        alert(`Price was not saved: ${error.message}`);
    }
}

async function createStaffAccount() {
    const username = prompt("New staff username:");
    if (username === null) return;
    const password = prompt("Set a temporary password (at least 12 characters):");
    if (password === null) return;
    try {
        const account = await PalmVillaApi.createUser({ username, password, role: "staff" });
        alert(`Staff account ${account.username} is ready. Share the temporary password privately and ask them to change it after signing in.`);
        loadStaffAccounts();
    } catch (error) {
        alert(`Staff account was not created: ${error.message}`);
    }
}

async function loadStaffAccounts() {
    const list = document.getElementById("staffAccountsList");
    if (!list) return;
    list.textContent = "Loading accounts…";
    try {
        const result = await PalmVillaApi.getUsers();
        list.replaceChildren();
        result.users.forEach((user) => {
            const row = document.createElement("div");
            row.className = "staff-account-row";
            const details = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = user.username;
            const role = document.createElement("span");
            role.textContent = `${user.role} · ${user.active ? "Active" : "Disabled"}`;
            details.append(name, role);
            row.append(details);
            if (user.role === "staff") {
                const passwordButton = document.createElement("button");
                passwordButton.type = "button";
                passwordButton.textContent = "Reset password";
                passwordButton.onclick = () => resetStaffPassword(user.id, user.username);
                const stateButton = document.createElement("button");
                stateButton.type = "button";
                stateButton.textContent = user.active ? "Disable" : "Enable";
                stateButton.onclick = () => setStaffAccountActive(user.id, user.active);
                row.append(passwordButton, stateButton);
            }
            list.append(row);
        });
        if (!result.users.length) list.textContent = "No accounts found.";
    } catch (error) {
        list.textContent = `Accounts could not be loaded: ${error.message}`;
    }
}

async function resetStaffPassword(userId, username) {
    const password = prompt(`Set a temporary password for ${username} (at least 12 characters):`);
    if (password === null) return;
    try {
        await PalmVillaApi.resetUserPassword(userId, password);
        alert(`Password reset for ${username}. Share the new temporary password privately.`);
    } catch (error) {
        alert(`Password was not reset: ${error.message}`);
    }
}

async function setStaffAccountActive(userId, isActive) {
    const action = isActive ? "disable" : "enable";
    if (!confirm(`Are you sure you want to ${action} this staff account?`)) return;
    try {
        await PalmVillaApi.setUserActive(userId, !isActive);
        await loadStaffAccounts();
    } catch (error) {
        alert(`Account was not changed: ${error.message}`);
    }
}

async function changeAccountPassword() {
    const currentPassword = prompt("Enter your current password:");
    if (currentPassword === null) return;
    const newPassword = prompt("Enter a new password (at least 12 characters):");
    if (newPassword === null) return;
    try {
        await PalmVillaApi.changePassword(currentPassword, newPassword);
        alert("Password changed. Please sign in again with the new password.");
        window.location.replace("/login.html");
    } catch (error) {
        alert(`Password was not changed: ${error.message}`);
    }
}

function initializeMenuFilters() {
    const searchInput = document.getElementById("menuSearch");
    const filterButtons = [...document.querySelectorAll("[data-category-filter]")];
    const sections = [...document.querySelectorAll("[data-staff-menu-section]")];
    if (!searchInput || !sections.length) return;

    let activeCategory = "all";
    const applyFilters = () => {
        const query = searchInput.value.trim().toLocaleLowerCase();
        let visibleItems = 0;

        sections.forEach((section) => {
            let visibleInSection = 0;
            const categoryMatches = activeCategory === "all" || section.dataset.category === activeCategory;
            section.querySelectorAll(".item").forEach((item) => {
                const matches = categoryMatches && item.textContent.toLocaleLowerCase().includes(query);
                item.hidden = !matches;
                if (matches) visibleInSection += 1;
            });
            section.hidden = visibleInSection === 0;
            visibleItems += visibleInSection;
        });

        const emptyState = document.getElementById("menuNoResults");
        if (emptyState) emptyState.hidden = visibleItems > 0;
    };

    searchInput.addEventListener("input", applyFilters);
    filterButtons.forEach((button) => {
        button.addEventListener("click", () => {
            activeCategory = button.dataset.categoryFilter;
            filterButtons.forEach((tab) => {
                const selected = tab === button;
                tab.classList.toggle("is-active", selected);
                tab.setAttribute("aria-pressed", String(selected));
            });
            applyFilters();
        });
    });
}

function initializeManagerMenuSearch() {
    const searchInput = document.getElementById("managerMenuSearch");
    const menuSection = document.getElementById("menuSection");
    if (!searchInput || !menuSection) return;

    const items = [...menuSection.querySelectorAll(".item")];
    const groups = [...menuSection.querySelectorAll(".menu-group")];
    const emptyState = document.getElementById("managerMenuNoResults");

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLocaleLowerCase();
        let visibleCount = 0;

        items.forEach((item) => {
            item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
            if (!item.hidden) visibleCount += 1;
        });

        groups.forEach((group) => {
            group.hidden = !group.querySelector(".item:not([hidden])");
        });

        if (emptyState) emptyState.hidden = visibleCount > 0;
    });
}


// ===============================
// LOAD SAVED DATA
// ===============================

async function loadData({ quiet = false } = {}) {
    try {
        const state = await PalmVillaApi.getState();
        const priorCustomerId = getSelectedCustomer()?.id;
        currentBusinessDate = state.date;
        const reportDate = document.getElementById("reportDate");
        if (reportDate && !reportDate.value) reportDate.value = state.date;
        sales = state.sales;
        expenses = state.expenses;
        salesHistory = state.salesHistory || [];
        staffHistory = state.staffHistory || [];
        customers = state.customers || [];
        drinks = state.drinks || [];
        Object.assign(menuPrices, state.menuPrices || {});
        currentCustomer = priorCustomerId
            ? customers.findIndex(customer => customer.id === priorCustomerId)
            : null;
        if (currentCustomer < 0) currentCustomer = null;
        synchronizeMenuPrices();
        displayDrinks();
        displayCustomers();
        updateDashboard();
        displaySalesHistory();
        displayStaffHistory();
        syncCartWithCustomer();
        if (typeof loadSummary === "function") loadSummary();
        if (document.getElementById("staffAccountsList")) loadStaffAccounts();
    } catch (error) {
        console.error("Unable to load Palm Villa data:", error);
        if (!quiet) document.body.innerHTML = `<main class="login-page"><section class="login-card"><h1>Could not load business data</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">Try again</button></section></main>`;
    }
}

// Business records are authoritative in the shared, authenticated server database.


// ===============================
// ADD TO CART
// ===============================

function addToCart(itemName, price, qty = 1) {
    rollOverBusinessDayIfNeeded();

    price = menuPrices[itemName] ?? price;

    const customer = getSelectedCustomer();

    if (!customer) {
        alert("Please select or create a customer first.");
        return;
    }

    // Special-case: Assorted Pomo allows selecting arbitrary quantity (each ₦200)
    // If a qty is not provided (or is 0), prompt staff for desired amount.
    if (itemName === "Assorted Pomo" && (!qty || qty <= 1)) {
        let input = prompt("Enter number of Pomo pieces (each ₦200):", "1");
        if (!input) return;
        let parsed = parseInt(input);
        if (isNaN(parsed) || parsed <= 0) {
            alert('Please enter a valid positive number');
            return;
        }
        qty = parsed;
    }

    let existingItem = customer.cart.find(item => item.name === itemName);

    if (existingItem) {
        existingItem.qty += qty;
    } else {
        customer.cart.push({
            name: itemName,
            price: price,
            qty: qty
        });
    }

    cart = customer.cart;
    saveCustomers().catch(() => {});
    displayCart();
    displayCustomers();
    if (typeof loadSummary === "function") {
        loadSummary();
    }

    staffHistory.push({
        type: "item-added",
        status: "Updated",
        customerName: customer.name,
        table: customer.table,
        items: cart.map(item => ({
            name: item.name,
            qty: item.qty,
            price: Number(item.price),
            total: Number(item.price) * Number(item.qty)
        })),
        total: cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty)), 0),
        time: new Date().toLocaleString([], {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    });
    displayStaffHistory();
    PalmVillaApi.logActivity("item-added", customer.id, cart, cart.reduce((sum, item) => sum + item.price * item.qty, 0))
        .catch((error) => console.warn("Activity log failed:", error));
}


// ===============================
// DISPLAY CART
// ===============================

function displayCart() {

    let cartDiv = document.getElementById("cart");
    const totalEl = document.getElementById("total");

    if (!cartDiv) return;

    cartDiv.innerHTML = "";

    let total = 0;

    if (cart.length === 0) {
        cartDiv.innerHTML = "<p class='empty-cart'>No items yet.</p>";
        if (totalEl) totalEl.innerHTML = "₦0";
        return;
    }

    cart.forEach((item, index) => {

        let subTotal = item.price * item.qty;

        total += subTotal;

        cartDiv.innerHTML += `

            <div class="cart-item">

                <h3>${escapeHtml(item.name)}</h3>

                <button onclick="decreaseQty(${index})">
                    ➖
                </button>

                <span>${item.qty}</span>

                <button onclick="increaseQty(${index})">
                    ➕
                </button>

                <p>
                    ₦${subTotal.toLocaleString()}
                </p>

            </div>

        `;

    });

    if (totalEl) {
        totalEl.innerHTML = "₦" + total.toLocaleString();
    }
}


// ===============================
// INCREASE QUANTITY
// ===============================

function increaseQty(index) {

    cart[index].qty++;

    if (currentCustomer !== null && customers[currentCustomer]) {
        customers[currentCustomer].cart = cart;
        saveCustomers().catch(() => {});
    }

    displayCart();
    displayCustomers();
    if (typeof loadSummary === "function") {
        loadSummary();
    }
}


// ===============================
// DECREASE QUANTITY
// ===============================

function decreaseQty(index) {

    if (cart[index].qty > 1) {

        cart[index].qty--;

    } else {

        cart.splice(index, 1);

    }

    if (currentCustomer !== null && customers[currentCustomer]) {
        customers[currentCustomer].cart = cart;
        saveCustomers().catch(() => {});
    }

    displayCart();
    displayCustomers();
    if (typeof loadSummary === "function") {
        loadSummary();
    }
}


// ===============================
// COMPLETE SALE
// ===============================

async function completeSale() {
    rollOverBusinessDayIfNeeded();
    const customer = getSelectedCustomer();
    if (!customer || cart.length === 0) {
        alert("Select a customer with items before completing a sale.");
        return;
    }

    try {
        await saveCustomers();
        const cartTotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
        const amountInput = prompt(`Sale total: ₦${cartTotal.toLocaleString()}\nHow much did the customer pay now?`, String(cartTotal));
        if (amountInput === null) return;
        const amountPaid = Number(amountInput.trim());
        if (!/^\d+$/.test(amountInput.trim()) || !Number.isSafeInteger(amountPaid) || amountPaid > cartTotal) {
            alert("Enter a whole amount between ₦0 and the sale total.");
            return;
        }
        const sale = await PalmVillaApi.completeSale(customer.id, amountPaid);
        showReceipt(sale.items, sale.total, sale.customerName);
        currentCustomer = null;
        cart = [];
        await loadData();
        alert(sale.amountOwed > 0
            ? `Sale completed. Customer still owes ₦${sale.amountOwed.toLocaleString()}.`
            : "Sale completed and saved.");
    } catch (error) {
        alert(`Sale was not completed: ${error.message}`);
    }
}

function clearCart() {
    rollOverBusinessDayIfNeeded();
    const customer = getSelectedCustomer();
    const customerName = customer ? customer.name : "Walk-in";
    const customerTable = customer ? customer.table : "Walk-in";
    const clearedItems = cart.map(item => ({
        name: item.name,
        qty: item.qty,
        price: Number(item.price),
        total: Number(item.price) * Number(item.qty)
    }));
    const clearedTotal = cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty)), 0);

    if (cart.length > 0) {
        staffHistory.push({
            type: "cart-cleared",
            status: "Cleared",
            customerName: customerName,
            table: customerTable,
            items: clearedItems,
            total: Number(clearedTotal),
            time: new Date().toLocaleString([], {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        });
        PalmVillaApi.logActivity("cart-cleared", customer?.id, clearedItems, clearedTotal)
            .catch((error) => console.warn("Activity log failed:", error));
    }

    if (customer) {
        customer.cart = [];
        saveCustomers().catch(() => {});
    }

    cart = [];
    displayCart();
    displayCustomers();
    displayStaffHistory();
    if (typeof loadSummary === "function") {
        loadSummary();
    }
}

function hideReceipt() {
    const receipt = document.getElementById("receipt");
    if (receipt) {
        receipt.classList.add("hidden");
    }
}

function showReceipt(items, total, customerName = "Walk-in") {
    const receipt = document.getElementById("receipt");
    const receiptContent = document.getElementById("receiptContent");

    if (!receipt || !receiptContent) return;

    const rows = items.map(item => {
        const itemTotal = item.price * item.qty;
        return `
            <div class="receipt-row">
                <span>${escapeHtml(item.name)} x${Number(item.qty) || 0}</span>
                <span>₦${itemTotal.toLocaleString()}</span>
            </div>
        `;
    }).join("");

    receiptContent.innerHTML = `
        <p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        ${rows}
        <div class="receipt-total">Total: ₦${total.toLocaleString()}</div>
    `;

    receipt.classList.remove("hidden");
}

function resetToday() {
    alert("Business records are kept permanently. Daily reports roll over automatically at midnight.");
}


// ===============================
// SALES HISTORY
// ===============================

function displaySalesHistory() {

    let table = document.getElementById("salesTable");
    if (!table) return;

    table.innerHTML = `

        <tr>

            <th>Item</th>

            <th>Qty</th>

            <th>Total</th>

        </tr>

    `;


    salesHistory.forEach(item => {

        let row = table.insertRow();

        row.insertCell(0).textContent = item.name;
        row.insertCell(1).textContent = item.qty;
        row.insertCell(2).textContent = "₦" + Number(item.total || 0).toLocaleString();

    });

}

function displayStaffHistory() {

    let table = document.getElementById("staffHistoryTable");
    if (!table) return;

    table.innerHTML = `
        <tr>
            <th>Time</th>
            <th>Customer</th>
            <th>Table</th>
            <th>Status</th>
            <th>Items</th>
            <th>Total</th>
        </tr>
    `;

    staffHistory.forEach(entry => {
        let row = table.insertRow();
        const itemsText = (entry.items || []).map(item => `${item.name} x${item.qty}`).join(', ') || 'No items';

        row.insertCell(0).textContent = entry.time || 'N/A';
        row.insertCell(1).textContent = entry.customerName || 'Walk-in';
        row.insertCell(2).textContent = entry.table || 'N/A';
        row.insertCell(3).textContent = entry.status || 'Completed';
        row.insertCell(4).textContent = itemsText;
        row.insertCell(5).textContent = "₦" + Number(entry.total || 0).toLocaleString();
    });

}


// ===============================
// ADD EXPENSE
// ===============================

function addExpense() {
    rollOverBusinessDayIfNeeded();

    let amount =
        prompt("Enter expense amount:");


    if (amount === null) {

        return;

    }


    amount = Number(amount);


    if (isNaN(amount) || amount <= 0) {

        alert("Please enter a valid amount.");

        return;

    }


    const description = prompt("What was this expense for?", "General expense");
    if (description === null) return;
    PalmVillaApi.addExpense(amount, description)
        .then(() => loadData())
        .then(() => alert("Expense saved."))
        .catch((error) => alert(`Expense was not saved: ${error.message}`));

}


// ===============================
// DASHBOARD
// ===============================

function updateDashboard() {

    const salesEl = document.getElementById("sales");
    const expensesEl = document.getElementById("expenses");
    const profitEl = document.getElementById("profit");

    if (salesEl) salesEl.innerHTML = "₦" + sales.toLocaleString();
    if (expensesEl) expensesEl.innerHTML = "₦" + expenses.toLocaleString();
    if (profitEl) profitEl.innerHTML = "₦" + (sales - expenses).toLocaleString();

}


// ===============================
// ADD SALE BUTTON
// ===============================

function addSale() {

    alert(
        "Select items from the menu and click Complete Sale."
    );

}


// ===============================
// REPORT
// ===============================

async function viewReport() {
    const reportDate = document.getElementById("reportDate")?.value;
    const output = document.getElementById("reportResult");
    if (!reportDate || !output) return;
    output.textContent = "Loading report…";
    try {
        const report = await PalmVillaApi.getReport(reportDate);
        output.innerHTML = `<h3>Report for ${escapeHtml(report.date)}</h3>
            <p>Sales: ₦${Number(report.sales).toLocaleString()} · ${report.saleCount} completed sale(s)</p>
            <p>Expenses: ₦${Number(report.expenses).toLocaleString()}</p>
            <p>Profit: ₦${Number(report.profit).toLocaleString()}</p>
            <h4>Sales</h4>${report.salesItems.map(sale => `<div class="report-sale"><p>${escapeHtml(sale.time)} · ${escapeHtml(sale.customer)} (${escapeHtml(sale.table)}) · ₦${Number(sale.total).toLocaleString()}</p>${(sale.items || []).map(item => `<small>${escapeHtml(item.name)} × ${Number(item.qty) || 0}</small>`).join(" · ")}</div>`).join("") || "<p>No sales for this date.</p>"}
            <h4>Expenses</h4>${report.expensesList.map(item => `<p>${escapeHtml(item.description)} · ₦${Number(item.amount).toLocaleString()}</p>`).join("") || "<p>No expenses for this date.</p>"}`;
    } catch (error) {
        output.textContent = `Report could not be loaded: ${error.message}`;
    }
}

function openWorkerOrders() {
    window.location.href = "orders.html?summary=1";
}


// ===============================
// START SYSTEM
// ===============================

loadData();
synchronizeMenuPrices();
initializeMenuFilters();
initializeManagerMenuSearch();
window.setInterval(() => {
    rollOverBusinessDayIfNeeded();
    if (!PalmVillaApi.hasPendingCartWrites()) loadData({ quiet: true });
}, 5_000);
// ===============================
// DRINKS INVENTORY
// ===============================

let drinks = [];

function addDrink() {

    let brand = document.getElementById("drinkBrand").value.trim();
    let bought = Number(document.getElementById("drinkBought").value);
    let buyPrice = Number(document.getElementById("drinkBuyPrice").value);
    let sold = Number(document.getElementById("drinkSold").value);
    let sellPrice = Number(document.getElementById("drinkSellPrice").value);

    if (!brand) {
        alert("Please enter the drink brand.");
        return;
    }

    if (bought <= 0 || buyPrice <= 0 || sold < 0 || sellPrice <= 0) {
        alert("Please enter valid drink information.");
        return;
    }

    if (sold > bought) {
        alert("Quantity sold cannot be greater than quantity bought.");
        return;
    }

    PalmVillaApi.addDrink({ brand, bought, buyPrice, sold, sellPrice })
        .then(() => loadData())
        .then(() => {
            alert("Drink inventory saved.");
            document.getElementById("drinkBrand").value = "";
            document.getElementById("drinkBought").value = "";
            document.getElementById("drinkBuyPrice").value = "";
            document.getElementById("drinkSold").value = "";
            document.getElementById("drinkSellPrice").value = "";
        })
        .catch((error) => alert(`Drink inventory was not saved: ${error.message}`));
}


function displayDrinks() {

    let list = document.getElementById("drinksList");
    if (!list) return;

    list.innerHTML = "";

    drinks.forEach(function(drink) {


        list.innerHTML += `
            <div class="drink-item">

                <h3>${escapeHtml(drink.brand)}</h3>

                <p>Bought: ${drink.bought}</p>

                <p>Sold: ${drink.sold}</p>

                <p>Remaining Stock: ${drink.stock}</p>

                <p>Buying Price: ₦${drink.buyPrice.toLocaleString()}</p>

                <p>Selling Price: ₦${drink.sellPrice.toLocaleString()}</p>

                <p>Total Sales: ₦${drink.sales.toLocaleString()}</p>

                <p>Profit: ₦${drink.profit.toLocaleString()}</p>

            </div>
        `;

    });
    updateDrinkSummary();
}
function updateDrinkSummary() {

    const boughtEl = document.getElementById("totalDrinksBought");
    const soldEl = document.getElementById("totalDrinksSold");
    const stockEl = document.getElementById("totalDrinksStock");
    const salesEl = document.getElementById("totalDrinksSales");
    const profitEl = document.getElementById("totalDrinksProfit");

    if (!boughtEl || !soldEl || !stockEl || !salesEl || !profitEl) return;

    let totalBought = 0;
    let totalSold = 0;
    let totalStock = 0;
    let totalSales = 0;
    let totalProfit = 0;

    drinks.forEach(function(drink) {

        totalBought += drink.bought;
        totalSold += drink.sold;
        totalStock += drink.stock;
        totalSales += drink.sales;
        totalProfit += drink.profit;

    });

    boughtEl.textContent = totalBought;
    soldEl.textContent = totalSold;
    stockEl.textContent = totalStock;
    salesEl.textContent = "₦" + totalSales.toLocaleString();
    profitEl.textContent = "₦" + totalProfit.toLocaleString();
}
if (document.getElementById("drinksList")) {
    displayDrinks();
    updateDrinkSummary();
}
async function createCustomer() {
    rollOverBusinessDayIfNeeded();

    let name = document.getElementById("customerName").value.trim();
    let table = document.getElementById("tableNumber").value;

    if (name === "") {
        alert("Please enter a customer name.");
        return;
    }

    try {
        const newCustomer = await PalmVillaApi.createCustomer(name, table);
        customers.unshift(newCustomer);
        currentCustomer = 0;
        document.getElementById("customerName").value = "";
        displayCustomers();
        syncCartWithCustomer();
        displayStaffHistory();
        if (typeof loadSummary === "function") loadSummary();
        alert(name + " is now selected for ordering.");
    } catch (error) {
        alert(`Customer order could not be created: ${error.message}`);
    }
}

function displayCustomers() {

    let list = document.getElementById("customerList");

    if (!list) return;

    list.innerHTML = "";

    const openCustomers = customers.map((customer, index) => ({ customer, index })).filter(({ customer }) => !customer.closed);
    if (openCustomers.length === 0) {
        list.textContent = "No active customers.";
        return;
    }

    openCustomers.forEach(({ customer, index }) => {
        let activeClass = currentCustomer === index ? "style=\"border-left-color:#00ff88; background:#2a3b2a;\"" : "";
        const currentItems = (customer.cart || []).map(item => `${item.name} x${item.qty}`).join(", ") || "No items yet";

        list.innerHTML += `
            <div class="customer-card" ${activeClass} onclick="selectCustomer(${index})">
                <strong>${escapeHtml(customer.name)}</strong><br>
                ${escapeHtml(customer.table)}<br>
                <small>${customer.orders.length} order(s)</small>
                <div style="margin-top:8px; font-size:12px; color:#dbeafe;">${escapeHtml(currentItems)}</div>
            </div>
        `;

    });

}

function selectCustomer(index) {

    currentCustomer = index;
    displayCustomers();
    syncCartWithCustomer();
    if (typeof loadSummary === "function") {
        loadSummary();
    }
    alert(customers[index].name + "'s order is now open.");

}
