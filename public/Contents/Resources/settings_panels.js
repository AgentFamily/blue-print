// helper functions for the Settings modal panels (accounts, pipelines & vault)
// these are referenced from Homepage.html.

async function renderAccountsPanel() {
  const container = el("accountsPanel");
  if (!container) return;
  container.innerHTML = `<div class="hint">Loading…</div>`;
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) throw new Error(res.statusText);
    let accounts = await res.json();
    if (!Array.isArray(accounts)) accounts = [];
    if (accounts.length === 0) {
      container.innerHTML = `<div class="row" style="margin-bottom:8px;">` +
                            `<button id="connectAccountBtn" class="btn tiny green">Connect new</button>` +
                            `</div>` +
                            `<div class="hint">No connected accounts.</div>`;
      const btn = el("connectAccountBtn");
      if (btn) {
        btn.addEventListener("click", async () => {
          const prov = prompt("Provider (e.g. hubspot, cloudflare)");
          if (!prov) return;
          const mode = prompt("Connection mode (oauth/apikey)", "apikey");
          if (mode === "apikey") {
            const key = prompt("Enter API key or token reference");
            if (!key) return;
            await fetch("/api/accounts/connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: prov, tokenRef: key }),
            });
            renderAccountsPanel();
          } else if (mode === "oauth") {
            const res2 = await fetch("/api/accounts/connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: prov, mode: "oauth" }),
            });
            if (res2.ok) {
              const data = await res2.json();
              if (data && data.redirect) {
                window.location = data.redirect;
              }
            }
          }
        });
      }
      return;
    }
    let html = `<div class=\"row\" style=\"margin-bottom:8px;\">` +
               `<button id=\"connectAccountBtn\" class=\"btn tiny green\">Connect new</button>` +
              `</div>` +
              `<div class=\"row\"><strong>Provider</strong><strong>Status</strong><strong>Last Sync</strong><strong>Actions</strong></div>`;
    for (const acct of accounts) {
      const status = acct.status || "disconnected";
      const color = status === "connected" ? "green" : status === "error" ? "red" : status === "expired" ? "orange" : "gray";
      const last = acct.lastSyncAt ? new Date(acct.lastSyncAt).toLocaleString() : "–";
      html += `<div class=\"row\" style=\"align-items:center;gap:8px;\">` +
              `<span>${acct.provider}</span>` +
              `<span class=\"btn ${color}\" style=\"pointer-events:none;opacity:0.75;\">${status}</span>` +
              `<span>${last}</span>` +
              `<span>` +
              `<button class=\"btn tiny\" data-provider=\"${acct.provider}\" data-action=\"test\">Test</button>` +
              `<button class=\"btn tiny secondary\" data-provider=\"${acct.provider}\" data-action=\"disconnect\">Disconnect</button>` +
              `</span>` +
              `</div>`;
    }
    container.innerHTML = html;
    container.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const prov = btn.getAttribute("data-provider");
        const act = btn.getAttribute("data-action");
        if (!prov || !act) return;
        btn.disabled = true;
        try {
          await fetch(`/api/accounts/${act}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: prov }),
          });
        } catch (err) {
          console.error(err);
        }
        renderAccountsPanel();
      });
    });
    const connectBtn = el("connectAccountBtn");
    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        const prov = prompt("Provider (e.g. hubspot, cloudflare)");
        if (!prov) return;
        const mode = prompt("Connection mode (oauth/apikey)", "apikey");
        if (mode === "apikey") {
          const key = prompt("Enter API key or token reference");
          if (!key) return;
          await fetch("/api/accounts/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: prov, tokenRef: key }),
          });
          renderAccountsPanel();
        } else if (mode === "oauth") {
          const res3 = await fetch("/api/accounts/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: prov, mode: "oauth" }),
          });
          if (res3.ok) {
            const data = await res3.json();
            if (data && data.redirect) {
              window.location = data.redirect;
            }
          }
        }
      });
    }
  } catch (err) {
    container.innerHTML = `<div class=\"notice error\">${err.message}</div>`;
  }
}

async function renderPipelinesPanel() {
  const container = el("pipelinesPanel");
  if (!container) return;
  container.innerHTML = `<div class="hint">Loading…</div>`;
  try {
    const res = await fetch("/api/pipelines/runs");
    if (!res.ok) throw new Error(res.statusText);
    const runs = await res.json();
    if (!Array.isArray(runs) || runs.length === 0) {
      container.innerHTML = `<div class="row" style="margin-bottom:8px;">` +
                            `<button id="newPipelineRunBtn" class="btn tiny green">New run</button>` +
                            `</div>` +
                            `<div class="hint">No pipeline runs yet. Try <code>kpi-pipeline</code>.</div>`;
      const btn = el("newPipelineRunBtn");
      if (btn) {
        btn.addEventListener("click", async () => {
          const pipeline = prompt("Pipeline ID to run (e.g. kpi-pipeline)", "kpi-pipeline");
          if (!pipeline) return;
          const inputStr = prompt("JSON input (or leave blank)", "{}");
          let input = {};
          try { input = inputStr ? JSON.parse(inputStr) : {}; } catch {}
          await fetch("/api/pipelines/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pipelineId: pipeline, input }),
          });
          renderPipelinesPanel();
        });
      }
      return;
    }
    let html = `<div class="row" style="margin-bottom:8px;">` +
               `<button id="newPipelineRunBtn" class="btn tiny green">New run</button>` +
              `</div>` +
              `<div class="row"><strong>Run ID</strong><strong>Pipeline</strong><strong>Status</strong></div>`;
    for (const r of runs) {
      html += `<div class="row" style="gap:8px;align-items:center;">` +
              `<span>${r.runId}</span>` +
              `<span>${r.pipelineId}</span>` +
              `<span>${r.status}</span>` +
              `</div>`;
    }
    container.innerHTML = html;
    const newBtn = el("newPipelineRunBtn");
    if (newBtn) {
      newBtn.addEventListener("click", async () => {
        const pipeline = prompt("Pipeline ID to run (e.g. kpi-pipeline)", "kpi-pipeline");
        if (!pipeline) return;
        const inputStr = prompt("JSON input (or leave blank)", "{}");
        let input = {};
        try { input = inputStr ? JSON.parse(inputStr) : {}; } catch {}
        await fetch("/api/pipelines/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pipelineId: pipeline, input }),
          });
        renderPipelinesPanel();
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}

const VAULT_PASS_HEADER = "X-AgentC-Vault-Pass";
const VAULT_RECORD_VERSION = 1;

const vaultSession = {
  unlocked: false,
  passphrase: "",
  entries: [],
};

function vaultSetStatus(message, isError = false) {
  try {
    if (typeof setStatusRight === "function") setStatusRight(String(message || ""), Boolean(isError));
  } catch {
    // ignore
  }
}

function vaultEscapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function vaultNormalizeType(value) {
  const t = String(value || "").trim().toLowerCase();
  if (t === "api" || t === "token" || t === "login") return t;
  return "login";
}

function vaultTypeLabel(value) {
  const type = vaultNormalizeType(value);
  if (type === "api") return "API key";
  if (type === "token") return "Token / secret";
  return "Username + password";
}

function vaultMaskSecret(value) {
  const s = String(value || "");
  if (!s) return "(empty)";
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

function vaultSlug(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "secret";
}

function vaultChooseName(label, existingNames) {
  const used = existingNames instanceof Set ? existingNames : new Set();
  const base = vaultSlug(label);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function vaultParseEntry(name, rawValue) {
  let parsed = null;
  const rawText = String(rawValue ?? "");
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const updatedAtRaw = Number(parsed.updatedAt);
    const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
    return {
      name: String(name || ""),
      label: String(parsed.label || name || "").trim() || String(name || ""),
      type: vaultNormalizeType(parsed.type),
      username: String(parsed.username || "").trim(),
      secret: String(parsed.secret ?? parsed.value ?? ""),
      notes: String(parsed.notes || "").trim(),
      updatedAt,
    };
  }
  return {
    name: String(name || ""),
    label: String(name || "Secret"),
    type: "token",
    username: "",
    secret: rawText,
    notes: "",
    updatedAt: Date.now(),
  };
}

function vaultPickOpenAIEntry(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const looksLikeOpenAI = (entry) => {
    const hay = `${entry?.label || ""} ${entry?.name || ""}`.toLowerCase();
    return /openai|chatgpt|gpt/.test(hay);
  };
  const hasSk = (entry) => /^sk-(proj-)?/i.test(String(entry?.secret || "").trim());
  return (
    list.find((entry) => entry.type === "api" && looksLikeOpenAI(entry) && hasSk(entry)) ||
    list.find((entry) => hasSk(entry)) ||
    list.find((entry) => entry.type === "api" && String(entry.secret || "").trim()) ||
    null
  );
}

window.getVaultOpenAIKey = function getVaultOpenAIKey() {
  if (!vaultSession.unlocked) return "";
  const entry = vaultPickOpenAIEntry(vaultSession.entries);
  return String(entry?.secret || "").trim();
};

async function vaultCopyText(value) {
  const text = String(value || "");
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }
  try {
    const node = document.createElement("textarea");
    node.value = text;
    node.setAttribute("readonly", "true");
    node.style.position = "fixed";
    node.style.left = "-9999px";
    document.body.appendChild(node);
    node.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(node);
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function vaultRequestJson(path, init = {}) {
  if (!vaultSession.unlocked || !vaultSession.passphrase) {
    throw new Error("Unlock the vault first.");
  }
  const headers = new Headers(init.headers || {});
  headers.set(VAULT_PASS_HEADER, vaultSession.passphrase);
  if (init.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(String(json?.error || text || res.statusText || `HTTP ${res.status}`));
  }
  return json;
}

async function vaultLoadEntries() {
  const names = await vaultRequestJson("/api/vault/list");
  if (!Array.isArray(names) || names.length === 0) {
    vaultSession.entries = [];
    return;
  }
  const entries = await Promise.all(
    names.map(async (nameRaw) => {
      const name = String(nameRaw || "").trim();
      if (!name) return null;
      try {
        const data = await vaultRequestJson(`/api/vault/get?name=${encodeURIComponent(name)}`);
        return vaultParseEntry(name, data?.value);
      } catch {
        return null;
      }
    })
  );
  vaultSession.entries = entries
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function vaultResetEditor() {
  const nameInput = el("vaultEntryNameInput");
  const labelInput = el("vaultLabelInput");
  const typeInput = el("vaultTypeInput");
  const userInput = el("vaultUsernameInput");
  const secretInput = el("vaultSecretInput");
  const notesInput = el("vaultNotesInput");
  const saveBtn = el("vaultSaveBtn");
  if (nameInput) nameInput.value = "";
  if (labelInput) labelInput.value = "";
  if (typeInput) typeInput.value = "login";
  if (userInput) userInput.value = "";
  if (secretInput) {
    secretInput.value = "";
    secretInput.placeholder = "Secret value";
  }
  if (notesInput) notesInput.value = "";
  if (saveBtn) saveBtn.textContent = "Save Secret";
}

function vaultFillEditor(name) {
  const entry = (vaultSession.entries || []).find((item) => String(item?.name || "") === String(name || ""));
  if (!entry) return;
  const nameInput = el("vaultEntryNameInput");
  const labelInput = el("vaultLabelInput");
  const typeInput = el("vaultTypeInput");
  const userInput = el("vaultUsernameInput");
  const secretInput = el("vaultSecretInput");
  const notesInput = el("vaultNotesInput");
  const saveBtn = el("vaultSaveBtn");
  if (nameInput) nameInput.value = entry.name;
  if (labelInput) labelInput.value = entry.label || "";
  if (typeInput) typeInput.value = vaultNormalizeType(entry.type);
  if (userInput) userInput.value = entry.username || "";
  if (secretInput) {
    secretInput.value = "";
    secretInput.placeholder = "Leave blank to keep current secret";
  }
  if (notesInput) notesInput.value = entry.notes || "";
  if (saveBtn) saveBtn.textContent = "Update Secret";
  labelInput?.focus?.();
}

async function vaultDeleteEntry(name) {
  const key = String(name || "").trim();
  if (!key) return;
  const target = (vaultSession.entries || []).find((item) => String(item?.name || "") === key);
  const label = target?.label || key;
  if (!confirm(`Delete vault secret "${label}"?`)) return;
  await vaultRequestJson("/api/vault/delete", {
    method: "POST",
    body: JSON.stringify({ name: key }),
  });
  await vaultLoadEntries();
  vaultSetStatus("Vault entry deleted.");
}

async function vaultSaveFromEditor() {
  const name = String(el("vaultEntryNameInput")?.value || "").trim();
  const label = String(el("vaultLabelInput")?.value || "").trim();
  const type = vaultNormalizeType(el("vaultTypeInput")?.value || "login");
  const username = String(el("vaultUsernameInput")?.value || "").trim();
  const secretRaw = String(el("vaultSecretInput")?.value || "");
  const notes = String(el("vaultNotesInput")?.value || "").trim();

  if (!label) {
    vaultSetStatus("Vault label is required.", true);
    el("vaultLabelInput")?.focus?.();
    return;
  }

  const existingNames = new Set((vaultSession.entries || []).map((entry) => String(entry?.name || "").trim()).filter(Boolean));
  const current = (vaultSession.entries || []).find((entry) => String(entry?.name || "") === name);
  const secret = secretRaw || String(current?.secret || "");
  if (!secret) {
    vaultSetStatus("Secret value is required.", true);
    el("vaultSecretInput")?.focus?.();
    return;
  }

  const finalName = name || vaultChooseName(label, existingNames);
  const payload = {
    version: VAULT_RECORD_VERSION,
    type,
    label,
    username,
    secret,
    notes,
    updatedAt: Date.now(),
  };

  await vaultRequestJson("/api/vault/set", {
    method: "POST",
    body: JSON.stringify({
      name: finalName,
      value: JSON.stringify(payload),
    }),
  });

  await vaultLoadEntries();
  vaultResetEditor();
  vaultSetStatus(name ? "Vault entry updated." : "Vault entry saved.");
}

async function vaultUnlockFromInput() {
  const input = el("vaultPassphraseInput");
  const passphrase = String(input?.value || "").trim();
  if (!passphrase) {
    vaultSetStatus("Enter the configured vault password.", true);
    input?.focus?.();
    return;
  }
  vaultSession.unlocked = true;
  vaultSession.passphrase = passphrase;
  try {
    await vaultLoadEntries();
    vaultSetStatus("Vault unlocked.");
    if (input) input.value = "";
    renderVaultPanel();
  } catch (err) {
    vaultSession.unlocked = false;
    vaultSession.passphrase = "";
    vaultSession.entries = [];
    vaultSetStatus(String(err?.message || err) || "Could not unlock vault.", true);
    renderVaultPanel();
  }
}

function vaultLock() {
  vaultSession.unlocked = false;
  vaultSession.passphrase = "";
  vaultSession.entries = [];
  vaultSetStatus("Vault locked.");
}

// vault panel
async function renderVaultPanel() {
  const container = el("vaultPanel");
  if (!container) return;

  if (!vaultSession.unlocked) {
    container.innerHTML = `
      <div class="field full">
        <label for="vaultPassphraseInput">Vault password</label>
        <div class="template-row">
          <input id="vaultPassphraseInput" type="password" autocomplete="off" placeholder="Enter vault password" />
          <button id="vaultUnlockBtn" class="btn tiny green" type="button">Unlock</button>
        </div>
        <div class="hint">Vault stores usernames/passwords, API keys, and tokens. Enter the configured server password.</div>
      </div>
    `;
    el("vaultUnlockBtn")?.addEventListener("click", vaultUnlockFromInput);
    el("vaultPassphraseInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      vaultUnlockFromInput();
    });
    return;
  }

  const entries = Array.isArray(vaultSession.entries) ? vaultSession.entries : [];
  const cards = entries.length
    ? entries
        .map((entry) => {
          const username = entry.username ? ` • ${vaultEscapeHTML(entry.username)}` : "";
          const notes = entry.notes
            ? `<div class="hint" style="margin-top:4px">${vaultEscapeHTML(entry.notes)}</div>`
            : "";
          return `
            <div style="border:1px solid rgba(15,23,42,.12);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.74);margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="min-width:0;">
                  <div style="font-size:13px;color:rgba(15,23,42,.92)">${vaultEscapeHTML(entry.label)}</div>
                  <div class="hint">${vaultEscapeHTML(vaultTypeLabel(entry.type))}${username} • ${vaultEscapeHTML(vaultMaskSecret(entry.secret))}</div>
                  ${notes}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  <button class="btn tiny secondary" data-vault-action="edit" data-vault-name="${vaultEscapeHTML(entry.name)}" type="button">Edit</button>
                  <button class="btn tiny secondary" data-vault-action="copy-user" data-vault-name="${vaultEscapeHTML(entry.name)}" type="button">Copy User</button>
                  <button class="btn tiny secondary" data-vault-action="copy-secret" data-vault-name="${vaultEscapeHTML(entry.name)}" type="button">Copy Secret</button>
                  <button class="btn tiny secondary" data-vault-action="delete" data-vault-name="${vaultEscapeHTML(entry.name)}" type="button">Delete</button>
                </div>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="hint">No secrets stored yet.</div>`;

  container.innerHTML = `
    <div class="field full">
      <label>Vault</label>
      <div class="template-row">
        <span class="hint">Unlocked • ${entries.length} secret${entries.length === 1 ? "" : "s"}</span>
        <button id="vaultRefreshBtn" class="btn tiny secondary" type="button">Refresh</button>
        <button id="vaultLockBtn" class="btn tiny secondary" type="button">Lock</button>
      </div>
    </div>
    <div class="field full">
      <label for="vaultLabelInput">Save secret</label>
      <input id="vaultEntryNameInput" type="hidden" />
      <input id="vaultLabelInput" type="text" maxlength="120" placeholder="Service / label (e.g. OpenAI API)" />
      <div class="template-row" style="margin-top:8px;">
        <select id="vaultTypeInput" aria-label="Vault secret type">
          <option value="login">Username + Password</option>
          <option value="api">API Key</option>
          <option value="token">Token / Secret</option>
        </select>
        <input id="vaultUsernameInput" type="text" maxlength="200" placeholder="Username / email (optional)" />
      </div>
      <div class="template-row" style="margin-top:8px;">
        <input id="vaultSecretInput" type="password" autocomplete="off" placeholder="Secret value" />
        <button id="vaultRevealBtn" class="btn tiny secondary" type="button">Show</button>
      </div>
      <textarea id="vaultNotesInput" maxlength="600" placeholder="Notes (optional)" style="margin-top:8px;"></textarea>
      <div class="template-row" style="margin-top:8px;">
        <button id="vaultSaveBtn" class="btn tiny green" type="button">Save Secret</button>
        <button id="vaultResetBtn" class="btn tiny secondary" type="button">Clear</button>
      </div>
    </div>
    <div class="field full">
      <label>Stored secrets</label>
      <div id="vaultEntriesList">${cards}</div>
      <div class="hint" style="margin-top:6px;">Tip: name a key with "OpenAI" and type "API Key" so chat can auto-use it while the vault is unlocked.</div>
    </div>
  `;

  el("vaultLockBtn")?.addEventListener("click", () => {
    vaultLock();
    renderVaultPanel();
  });
  el("vaultRefreshBtn")?.addEventListener("click", async () => {
    try {
      await vaultLoadEntries();
      vaultSetStatus("Vault refreshed.");
      renderVaultPanel();
    } catch (err) {
      vaultSetStatus(String(err?.message || err), true);
    }
  });
  el("vaultSaveBtn")?.addEventListener("click", async () => {
    try {
      await vaultSaveFromEditor();
      renderVaultPanel();
    } catch (err) {
      vaultSetStatus(String(err?.message || err) || "Could not save vault entry.", true);
    }
  });
  el("vaultResetBtn")?.addEventListener("click", vaultResetEditor);
  el("vaultRevealBtn")?.addEventListener("click", () => {
    const input = el("vaultSecretInput");
    const btn = el("vaultRevealBtn");
    if (!input) return;
    const show = String(input.type || "password") === "password";
    input.type = show ? "text" : "password";
    if (btn) btn.textContent = show ? "Hide" : "Show";
  });

  container.querySelectorAll("button[data-vault-action][data-vault-name]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = String(btn.getAttribute("data-vault-action") || "").trim();
      const name = String(btn.getAttribute("data-vault-name") || "").trim();
      if (!action || !name) return;
      const entry = (vaultSession.entries || []).find((item) => String(item?.name || "") === name);
      if (!entry) return;
      try {
        if (action === "edit") {
          vaultFillEditor(name);
          return;
        }
        if (action === "copy-user") {
          const ok = await vaultCopyText(entry.username || "");
          vaultSetStatus(ok ? "Username copied." : "Could not copy username.", !ok);
          return;
        }
        if (action === "copy-secret") {
          const ok = await vaultCopyText(entry.secret || "");
          vaultSetStatus(ok ? "Secret copied." : "Could not copy secret.", !ok);
          return;
        }
        if (action === "delete") {
          await vaultDeleteEntry(name);
          renderVaultPanel();
        }
      } catch (err) {
        vaultSetStatus(String(err?.message || err) || "Vault action failed.", true);
      }
    });
  });
}
