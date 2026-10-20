"use strict";

const form = document.getElementById("loginForm");
const errorMessage = document.getElementById("loginError");
const nextPage = new URLSearchParams(window.location.search).get("next");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Signing in…";
  errorMessage.textContent = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign in failed.");
    const target = result.user.role === "manager"
      ? "/index.html"
      : "/orders.html";
    const requestedTarget = nextPage === "/orders.html" || (result.user.role === "manager" && nextPage === "/index.html")
      ? nextPage
      : target;
    window.location.replace(requestedTarget);
  } catch (error) {
    errorMessage.textContent = error.message || "Unable to connect. Please try again.";
    button.disabled = false;
    button.textContent = "Sign in";
    form.elements.password.focus();
  }
});
