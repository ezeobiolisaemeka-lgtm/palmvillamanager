let cart = [];
let customers = JSON.parse(localStorage.getItem("palmVillaCustomers")) || [];
let currentCustomer = null;
let sales = 0;
let expenses = 0;
let salesHistory = [];
let staffHistory = [];

const today = new Date().toISOString().split("T")[0];

function saveCustomers() {
    localStorage.setItem("palmVillaCustomers", JSON.stringify(customers));
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


// ===============================
// LOAD SAVED DATA
// ===============================

function loadData() {

    let savedData = JSON.parse(localStorage.getItem("palmVillaData"));

    if (savedData && savedData.date === today) {

        sales = savedData.sales || 0;
        expenses = savedData.expenses || 0;
        salesHistory = savedData.salesHistory || [];
        staffHistory = savedData.staffHistory || [];

    } else {

        sales = 0;
        expenses = 0;
        salesHistory = [];
        staffHistory = [];
        saveData();
    }

    customers = JSON.parse(localStorage.getItem("palmVillaCustomers")) || [];
    updateDashboard();
    displaySalesHistory();
    displayStaffHistory();
    displayCustomers();
    syncCartWithCustomer();
}


// ===============================
// SAVE DATA
// ===============================

function saveData() {

    let data = {

        date: today,

        sales: sales,

        expenses: expenses,

        salesHistory: salesHistory,
        staffHistory: staffHistory

    };

    localStorage.setItem(
        "palmVillaData",
        JSON.stringify(data)
    );
}


// ===============================
// ADD TO CART
// ===============================

function addToCart(itemName, price, qty = 1) {

    const customer = getSelectedCustomer();

    if (!customer) {
        alert("Please select or create a customer first.");
        return;
    }

    // Special-case: Assorted Pomo allows selecting arbitrary quantity (each ₦200)
    // If a qty is not provided (or is 0), prompt staff for desired amount.
    if (itemName === "Assorted Pomo" && (!qty || qty <= 0)) {
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
    saveCustomers();
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
    saveData();
    displayStaffHistory();
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

                <h3>${item.name}</h3>

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
        saveCustomers();
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
        saveCustomers();
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

function completeSale() {

    if (cart.length === 0) {

        alert("Cart is empty!");

        return;
    }

    let total = 0;

    cart.forEach(item => {

        total += item.price * item.qty;

    });

    const customerName = currentCustomer !== null && customers[currentCustomer]
        ? customers[currentCustomer].name
        : "Walk-in";

    const customerTable = currentCustomer !== null && customers[currentCustomer]
        ? customers[currentCustomer].table
        : "Walk-in";

    // Add to total sales

    sales += total;

    // Save every item

    cart.forEach(item => {

        salesHistory.push({

            name: item.name,

            qty: item.qty,

            total: item.price * item.qty

        });

    });

    staffHistory.push({
        customerName: customerName,
        table: customerTable,
        items: cart.map(item => ({
            name: item.name,
            qty: item.qty,
            price: Number(item.price),
            total: Number(item.price) * Number(item.qty)
        })),
        total: Number(total),
        time: new Date().toLocaleString([], {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    });

    if (currentCustomer !== null && customers[currentCustomer]) {
        customers[currentCustomer].orders.push({
            items: cart.map(item => ({ ...item })),
            total: total,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        customers[currentCustomer].cart = [];
        saveCustomers();
        displayCustomers();
        if (typeof loadSummary === "function") {
            loadSummary();
        }
    }

    saveData();

    updateDashboard();

    displaySalesHistory();
    displayStaffHistory();

    showReceipt(cart, total, customerName);
    alert("Sale Completed Successfully!");


    cart = [];

    displayCart();
}

function clearCart() {
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
        saveData();
    }

    if (customer) {
        customer.cart = [];
        saveCustomers();
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
                <span>${item.name} x${item.qty}</span>
                <span>₦${itemTotal.toLocaleString()}</span>
            </div>
        `;
    }).join("");

    receiptContent.innerHTML = `
        <p><strong>Customer:</strong> ${customerName}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        ${rows}
        <div class="receipt-total">Total: ₦${total.toLocaleString()}</div>
    `;

    receipt.classList.remove("hidden");
}

function resetToday() {
    const confirmed = confirm("Reset all today's sales, expenses, and customer data?");

    if (!confirmed) return;

    sales = 0;
    expenses = 0;
    salesHistory = [];
    staffHistory = [];
    customers = [];
    currentCustomer = null;
    cart = [];
    localStorage.removeItem("palmVillaCustomers");
    saveData();
    displayCustomers();
    displayCart();
    updateDashboard();
    displaySalesHistory();
    displayStaffHistory();
    alert("Today's data has been reset.");
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

        row.insertCell(0).innerHTML =
            item.name;

        row.insertCell(1).innerHTML =
            item.qty;

        row.insertCell(2).innerHTML =
            "₦" + Number(item.total || 0).toLocaleString();

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

        row.insertCell(0).innerHTML = entry.time || 'N/A';
        row.insertCell(1).innerHTML = entry.customerName || 'Walk-in';
        row.insertCell(2).innerHTML = entry.table || 'N/A';
        row.insertCell(3).innerHTML = entry.status || 'Completed';
        row.insertCell(4).innerHTML = itemsText;
        row.insertCell(5).innerHTML = "₦" + Number(entry.total || 0).toLocaleString();
    });

}


// ===============================
// ADD EXPENSE
// ===============================

function addExpense() {

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


    expenses += amount;


    saveData();

    updateDashboard();


    alert("Expense Added Successfully!");

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

function viewReport() {

    alert(

        "🌴 PALM VILLA DAILY REPORT\n\n" +

        "Sales: ₦" +
        sales.toLocaleString() +

        "\nExpenses: ₦" +
        expenses.toLocaleString() +

        "\nProfit: ₦" +
        (sales - expenses).toLocaleString()

    );

}

function openWorkerOrders() {
    window.location.href = "orders.html?summary=1";
}


// ===============================
// START SYSTEM
// ===============================

loadData();
// ===============================
// DRINKS INVENTORY
// ===============================

let drinks = JSON.parse(localStorage.getItem("palmVillaDrinks")) || [];

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

    let stock = bought - sold;

    let purchaseCost = bought * buyPrice;

    let sales = sold * sellPrice;

    let costOfSoldDrinks = sold * buyPrice;

    let profit = sales - costOfSoldDrinks;

    drinks.push({
        brand: brand,
        bought: bought,
        buyPrice: buyPrice,
        sold: sold,
        sellPrice: sellPrice,
        stock: stock,
        purchaseCost: purchaseCost,
        sales: sales,
        profit: profit
    });
    localStorage.setItem(
    "palmVillaDrinks",
    JSON.stringify(drinks)
);

    displayDrinks();
    updateDrinkSummary();

    alert("Drink added successfully!");

    document.getElementById("drinkBrand").value = "";
    document.getElementById("drinkBought").value = "";
    document.getElementById("drinkBuyPrice").value = "";
    document.getElementById("drinkSold").value = "";
    document.getElementById("drinkSellPrice").value = "";
}


function displayDrinks() {

    let list = document.getElementById("drinksList");
    if (!list) return;

    list.innerHTML = "";

    drinks.forEach(function(drink) {
        

        list.innerHTML += `
            <div class="drink-item">

                <h3>${drink.brand}</h3>

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
function createCustomer() {

    let name = document.getElementById("customerName").value.trim();
    let table = document.getElementById("tableNumber").value;

    if (name === "") {
        alert("Please enter a customer name.");
        return;
    }

    customers.push({
        name: name,
        table: table,
        cart: [],
        orders: []
    });

    const newCustomer = customers[customers.length - 1];
    staffHistory.push({
        type: "customer-created",
        status: "Created",
        customerName: name,
        table: table,
        items: [],
        total: 0,
        time: new Date().toLocaleString([], {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    });
    saveData();

    currentCustomer = customers.length - 1;
    saveCustomers();
    displayCustomers();
    syncCartWithCustomer();
    displayStaffHistory();
    if (typeof loadSummary === "function") {
        loadSummary();
    }

    document.getElementById("customerName").value = "";
    alert(name + " is now selected for ordering.");
}

function displayCustomers() {

    let list = document.getElementById("customerList");

    if (!list) return;

    list.innerHTML = "";

    if (customers.length === 0) {
        list.textContent = "No active customers.";
        return;
    }

    customers.forEach((customer, index) => {
        let activeClass = currentCustomer === index ? "style=\"border-left-color:#00ff88; background:#2a3b2a;\"" : "";
        const currentItems = (customer.cart || []).map(item => `${item.name} x${item.qty}`).join(", ") || "No items yet";

        list.innerHTML += `
            <div class="customer-card" ${activeClass} onclick="selectCustomer(${index})">
                <strong>${customer.name}</strong><br>
                ${customer.table}<br>
                <small>${customer.orders.length} order(s)</small>
                <div style="margin-top:8px; font-size:12px; color:#dbeafe;">${currentItems}</div>
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