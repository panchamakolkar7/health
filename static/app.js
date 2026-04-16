/**
 * Smart Medicine Reminder — app.js
 * Pure Vanilla JS: no frameworks, no build step.
 * Communicates with the FastAPI backend via fetch().
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════════════ */
let allMedicines = [];   // full list from /api/medicines
let deleteTarget  = null; // id of medicine pending deletion

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  setTodayLabel();
  initTabs();
  loadDashboard();
  lucide.createIcons();  // render all <i data-lucide="…"> icons
});

/** Display today's date in the header */
function setTodayLabel() {
  const el = document.getElementById("today-label");
  el.textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;

      // Toggle active button
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Toggle active section
      document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
      document.getElementById(`tab-${tab}`).classList.add("active");

      // Load data for the tab
      if (tab === "dashboard")  loadDashboard();
      if (tab === "medicines")  loadMedicines();

      lucide.createIcons();
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  const container = document.getElementById("dashboard-list");
  container.innerHTML = skeletons(4);          // show loading placeholders

  try {
    const items = await api("GET", "/api/dashboard");
    renderDashboard(items);
  } catch (e) {
    container.innerHTML = errorState("Could not load today's schedule.");
  }
}

function renderDashboard(items) {
  const container = document.getElementById("dashboard-list");

  // Update stats
  const taken   = items.filter(i => i.is_taken).length;
  const pending = items.length - taken;
  document.getElementById("stat-total").textContent   = items.length;
  document.getElementById("stat-taken").textContent   = taken;
  document.getElementById("stat-pending").textContent = pending;

  // Progress bar
  const pct = items.length ? Math.round((taken / items.length) * 100) : 0;
  document.getElementById("progress-fill").style.width  = pct + "%";
  document.getElementById("progress-label").textContent = `${pct}% complete`;

  // Cards
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="pill" style="display:block;margin:0 auto 1rem"></i>
        <h3>No medicines scheduled</h3>
        <p>Go to the <strong>Medicines</strong> tab to add your first medicine.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="med-card ${item.is_taken ? "taken" : ""}" id="card-${item.id}">
      <button class="take-btn"
              onclick="toggleTaken(${item.id})"
              title="${item.is_taken ? "Mark as pending" : "Mark as taken"}">
        <i data-lucide="${item.is_taken ? "check" : "circle"}"></i>
      </button>

      <div class="med-card-body">
        <div class="med-card-name">${esc(item.name)}</div>
        <div class="med-card-meta">
          <span class="badge badge-blue">
            <i data-lucide="pill"></i> ${esc(item.dosage)}
          </span>
          <span class="badge ${item.is_taken ? "badge-green" : "badge-amber"}">
            <i data-lucide="clock"></i> ${fmt12h(item.time_of_day)}
          </span>
          <span class="badge ${item.is_taken ? "badge-green" : "badge-amber"}">
            ${item.is_taken ? "✓ Taken" : "⏳ Pending"}
          </span>
        </div>
        ${item.notes ? `<div class="med-card-notes">${esc(item.notes)}</div>` : ""}
        ${item.is_taken && item.taken_at
          ? `<div class="med-card-footer">Logged at ${fmtTime(item.taken_at)}</div>`
          : ""}
      </div>
    </div>
  `).join("");

  lucide.createIcons();
}

/** Toggle taken/pending for a medicine */
async function toggleTaken(id) {
  try {
    const res = await api("POST", `/api/medicines/${id}/take`);
    showToast(res.message, res.status === "taken" ? "success" : "info");
    loadDashboard(); // refresh dashboard
  } catch (e) {
    showToast("Could not update status.", "error");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MEDICINES LIST
═══════════════════════════════════════════════════════════════════════════ */
async function loadMedicines() {
  const container = document.getElementById("medicines-list");
  container.innerHTML = `<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>`;

  try {
    allMedicines = await api("GET", "/api/medicines");
    renderMedicines();
  } catch (e) {
    container.innerHTML = errorState("Could not load medicines.");
  }
}

function renderMedicines() {
  const container = document.getElementById("medicines-list");

  if (!allMedicines.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="clipboard-list" style="display:block;margin:0 auto 1rem"></i>
        <h3>No medicines added yet</h3>
        <p>Click <strong>Add Medicine</strong> to get started.</p>
      </div>`;
    lucide.createIcons();
    return;
  }

  container.innerHTML = `
    <table class="medicines-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Dosage</th>
          <th>Time</th>
          <th>Notes</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${allMedicines.map(m => `
          <tr>
            <td class="med-name">${esc(m.name)}</td>
            <td>${esc(m.dosage)}</td>
            <td>${fmt12h(m.time_of_day)}</td>
            <td class="notes-cell">${m.notes ? esc(m.notes) : '<span style="color:var(--muted)">—</span>'}</td>
            <td>
              <div class="actions">
                <button class="btn-icon" onclick="openModal(${m.id})" title="Edit">
                  <i data-lucide="pencil"></i>
                </button>
                <button class="btn-icon danger" onclick="openDelModal(${m.id}, '${esc(m.name)}')" title="Delete">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;

  lucide.createIcons();
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADD / EDIT MODAL
═══════════════════════════════════════════════════════════════════════════ */
function openModal(id = null) {
  const modal = document.getElementById("med-modal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  document.getElementById("modal-title").textContent = id ? "Edit Medicine" : "Add Medicine";
  document.getElementById("med-id").value      = "";
  document.getElementById("med-name").value    = "";
  document.getElementById("med-dosage").value  = "";
  document.getElementById("med-time").value    = "08:00";
  document.getElementById("med-notes").value   = "";

  if (id) {
    // Populate form with existing data
    const med = allMedicines.find(m => m.id === id);
    if (med) {
      document.getElementById("med-id").value     = med.id;
      document.getElementById("med-name").value   = med.name;
      document.getElementById("med-dosage").value = med.dosage;
      document.getElementById("med-time").value   = med.time_of_day;
      document.getElementById("med-notes").value  = med.notes || "";
    }
  }

  lucide.createIcons();
  document.getElementById("med-name").focus();
}

function closeModal() {
  const modal = document.getElementById("med-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function saveMedicine() {
  const id     = document.getElementById("med-id").value;
  const name   = document.getElementById("med-name").value.trim();
  const dosage = document.getElementById("med-dosage").value.trim();
  const time   = document.getElementById("med-time").value;
  const notes  = document.getElementById("med-notes").value.trim();

  // Client-side validation
  if (!name || !dosage || !time) {
    showToast("Please fill in all required fields.", "error");
    return;
  }

  const payload = { name, dosage, time_of_day: time, notes: notes || null };

  try {
    if (id) {
      await api("PUT", `/api/medicines/${id}`, payload);
      showToast("Medicine updated successfully!", "success");
    } else {
      await api("POST", "/api/medicines", payload);
      showToast("Medicine added successfully! 💊", "success");
    }
    closeModal();
    loadMedicines();
  } catch (e) {
    showToast("Could not save. Please try again.", "error");
  }
}

// Allow pressing Enter in name/dosage fields to save
["med-name", "med-dosage", "med-notes"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) saveMedicine();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE MODAL
═══════════════════════════════════════════════════════════════════════════ */
function openDelModal(id, name) {
  deleteTarget = id;
  document.getElementById("del-med-name").textContent = name;
  const modal = document.getElementById("del-modal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  lucide.createIcons();
}

function closeDelModal() {
  deleteTarget = null;
  const modal = document.getElementById("del-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function confirmDelete() {
  if (!deleteTarget) return;
  try {
    await api("DELETE", `/api/medicines/${deleteTarget}`);
    showToast("Medicine deleted.", "info");
    closeDelModal();
    loadMedicines();
  } catch (e) {
    showToast("Could not delete. Please try again.", "error");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLOSE MODALS ON OVERLAY CLICK
═══════════════════════════════════════════════════════════════════════════ */
document.getElementById("med-modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById("del-modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeDelModal();
});

/* ═══════════════════════════════════════════════════════════════════════════
   API HELPER
═══════════════════════════════════════════════════════════════════════════ */
/**
 * Generic fetch wrapper.
 * @param {string} method   HTTP method
 * @param {string} path     API path (e.g. /api/dashboard)
 * @param {object} [body]   Optional JSON body
 * @returns {Promise<any>}  Parsed JSON response
 */
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);

  if (res.status === 204) return null; // No Content (DELETE)

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
═══════════════════════════════════════════════════════════════════════════ */
let toastTimer;

/**
 * Show a temporary toast message.
 * @param {string} message
 * @param {"success"|"error"|"info"} [type]
 */
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className   = `toast ${type} show`;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
═══════════════════════════════════════════════════════════════════════════ */

/** Escape HTML to prevent XSS */
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Convert "HH:MM" (24-hour) to "H:MM AM/PM" for display.
 * Falls back to original string if format is unrecognised.
 */
function fmt12h(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return timeStr;
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour  = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Format an ISO datetime string to a short local time (e.g. "2:30 PM") */
function fmtTime(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit",
  });
}

/** Generate N skeleton loader placeholders */
function skeletons(n) {
  return Array(n).fill('<div class="skeleton"></div>').join("");
}

/** Generic error state HTML */
function errorState(msg) {
  return `
    <div class="empty-state" style="grid-column:1/-1">
      <i data-lucide="alert-circle" style="display:block;margin:0 auto 1rem;color:var(--danger)"></i>
      <h3>Something went wrong</h3>
      <p>${msg}</p>
    </div>`;
}
