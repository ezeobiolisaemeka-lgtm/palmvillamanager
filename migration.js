"use strict";

const exportButton = document.getElementById("exportLegacy");
const importButton = document.getElementById("importLegacy");
const fileInput = document.getElementById("legacyFile");
const status = document.getElementById("migrationStatus");
let parsedSnapshot = null;

function readLegacyStorage() {
  const result = {};
  for (const key of ["palmVillaData", "palmVillaCustomers", "palmVillaDrinks"]) {
    try {
      const stored = localStorage.getItem(key);
      result[key] = stored ? JSON.parse(stored) : null;
    } catch {
      throw new Error(`Could not read ${key}. Export cancelled so the data remains untouched.`);
    }
  }
  return result;
}

exportButton.addEventListener("click", () => {
  try {
    const snapshot = {
      format: "palmvilla-browser-export-v1",
      exportedAt: new Date().toISOString(),
      storage: readLegacyStorage()
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(blob);
    link.href = downloadUrl;
    link.download = `palmvilla-browser-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    status.textContent = "Export downloaded. Keep the file private; it contains business and customer records.";
  } catch (error) {
    status.textContent = error.message;
  }
});

fileInput.addEventListener("change", async () => {
  parsedSnapshot = null;
  importButton.disabled = true;
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    status.textContent = "Export files must be smaller than 10 MB.";
    fileInput.value = "";
    return;
  }
  try {
    const candidate = JSON.parse(await file.text());
    if (candidate.format === "palmvilla-browser-export-v1" && candidate.storage) {
      parsedSnapshot = candidate.storage;
    } else if (candidate.palmVillaData || candidate.palmVillaCustomers) {
      parsedSnapshot = candidate;
    } else {
      throw new Error("This file is not a Palm Villa browser export.");
    }
    const count = Array.isArray(parsedSnapshot.palmVillaCustomers) ? parsedSnapshot.palmVillaCustomers.length : 0;
    status.textContent = `Ready to import ${count} customer record(s) and this browser's saved daily figures. Import is one-time per business date.`;
    importButton.disabled = false;
  } catch (error) {
    status.textContent = error.message || "Could not read the export file.";
    fileInput.value = "";
  }
});

importButton.addEventListener("click", async () => {
  if (!parsedSnapshot) return;
  importButton.disabled = true;
  status.textContent = "Importing records…";
  try {
    const result = await fetch("/api/migrate-local", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: parsedSnapshot })
    });
    const response = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(response.error || `Import failed (${result.status}).`);
    status.textContent = response.alreadyImported
      ? `This export was already imported for ${response.date}. No duplicate records were created.`
      : `Import finished for ${response.date}. ${response.customers} customer record(s) and ${response.drinks} inventory record(s) were restored.`;
  } catch (error) {
    status.textContent = error.message || "Import failed.";
    importButton.disabled = false;
  }
});
