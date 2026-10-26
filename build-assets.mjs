import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "orders.html", "debts.html", "debts.js", "login.html", "login.js",
  "script.js", "style.css", "manifest.json", "logo-192.svg", "logo-512.svg", "sw.js",
  "migration.html", "migration.js", "api.js"
];

await rm(new URL("../public/", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
for (const file of files) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(`../public/${file}`, import.meta.url));
}
console.log(`Prepared ${files.length} allowlisted Palm Villa frontend files.`);
