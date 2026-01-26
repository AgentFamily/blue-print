(function (global) {
  "use strict";

  function safeJsonParse(raw) {
    try {
      return JSON.parse(String(raw || ""));
    } catch {
      return null;
    }
  }

  function createOllamaNdjsonAccumulator() {
    let buffer = "";
    let content = "";
    let done = false;
    let lastEvent = null;
    let eventCount = 0;

    function consumeLine(line) {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;
      const evt = safeJsonParse(trimmed);
      if (!evt || typeof evt !== "object") return;
      lastEvent = evt;
      eventCount += 1;
      const delta = evt?.message?.content;
      if (typeof delta === "string" && delta) content += delta;
      if (evt.done === true) done = true;
    }

    return {
      pushText(text) {
        buffer += String(text || "");
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) consumeLine(line);
      },
      finish() {
        if (buffer) consumeLine(buffer);
        buffer = "";
      },
      getContent() {
        return content;
      },
      isDone() {
        return done;
      },
      getStats() {
        return {
          bufferedChars: buffer.length,
          contentChars: content.length,
          done,
          eventCount,
          lastEvent
        };
      }
    };
  }

  const api = {
    safeJsonParse,
    createOllamaNdjsonAccumulator
  };

  function createMagicAuthWidget() {
    const STORAGE = {
      jwt: "mkMagicJwtV1",
      email: "mkMagicEmailV1",
      address: "mkMagicWalletAddressV1"
    };

    const state = {
      open: false,
      loading: false,
      jwt: "",
      email: "",
      address: "",
      lastError: ""
    };

    let el = null;
    let magic = null;

    function loadFromStorage() {
      try {
        state.jwt = String(sessionStorage.getItem(STORAGE.jwt) || "");
      } catch {
        state.jwt = "";
      }
      try {
        state.email = String(localStorage.getItem(STORAGE.email) || "");
      } catch {
        state.email = "";
      }
      try {
        state.address = String(localStorage.getItem(STORAGE.address) || "");
      } catch {
        state.address = "";
      }
    }

    function saveToStorage() {
      try {
        if (state.jwt) sessionStorage.setItem(STORAGE.jwt, state.jwt);
        else sessionStorage.removeItem(STORAGE.jwt);
      } catch {
        // ignore
      }
      try {
        if (state.email) localStorage.setItem(STORAGE.email, state.email);
      } catch {
        // ignore
      }
      try {
        if (state.address) localStorage.setItem(STORAGE.address, state.address);
        else localStorage.removeItem(STORAGE.address);
      } catch {
        // ignore
      }
    }

    function ensureDom() {
      if (el) return el;

      const styleId = "mk-magic-auth-style";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          .mk-magic-btn{position:fixed;right:18px;bottom:18px;z-index:999999;display:flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(12,12,14,.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;cursor:pointer;box-shadow:0 18px 60px rgba(0,0,0,.55)}
          .mk-magic-btn:hover{transform:translateY(-1px)}
          .mk-magic-btn:active{transform:translateY(0)}
          .mk-magic-btn .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;margin-left:10px;box-shadow:0 0 0 3px rgba(239,68,68,.18)}
          .mk-magic-btn.signed-in .dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}
          .mk-magic-panel{position:fixed;right:18px;bottom:86px;z-index:999999;width:min(360px,calc(100vw - 36px));border-radius:16px;border:1px solid rgba(255,255,255,.14);background:rgba(12,12,14,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e5e7eb;box-shadow:0 18px 60px rgba(0,0,0,.6);padding:14px;display:none}
          .mk-magic-panel.open{display:block}
          .mk-magic-title{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650;margin-bottom:10px}
          .mk-magic-close{appearance:none;border:0;background:transparent;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px}
          .mk-magic-row{display:flex;gap:8px;align-items:center}
          .mk-magic-input,.mk-magic-textarea{width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e5e7eb;padding:10px 10px;font-size:13px;outline:none}
          .mk-magic-textarea{min-height:72px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
          .mk-magic-actions{display:flex;gap:8px;margin-top:10px}
          .mk-magic-action{flex:1;appearance:none;border:0;border-radius:12px;padding:10px 12px;font-weight:650;color:#fff;background:#2563eb;cursor:pointer}
          .mk-magic-action.secondary{background:transparent;border:1px solid rgba(255,255,255,.14);color:#e5e7eb}
          .mk-magic-action.danger{background:transparent;border:1px solid rgba(239,68,68,.35);color:#fca5a5}
          .mk-magic-action:disabled{opacity:.6;cursor:not-allowed}
          .mk-magic-meta{margin-top:10px;font-size:12px;color:#9ca3af;line-height:1.35}
          .mk-magic-error{margin-top:10px;border-radius:12px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.10);color:#fecaca;padding:10px;font-size:12px}
          .mk-magic-pill{display:inline-block;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);padding:4px 8px;border-radius:999px;font-size:12px;color:#cbd5e1}
        `;
        document.head.appendChild(style);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mk-magic-btn";
      btn.title = "Login / Wallet";
      btn.innerHTML = `<span style="font-weight:800;font-size:16px;letter-spacing:.2px">C</span><span class="dot"></span>`;

      const panel = document.createElement("div");
      panel.className = "mk-magic-panel";
      panel.innerHTML = `
        <div class="mk-magic-title">
          <div>Wallet / Login <span id="mkMagicStatus" class="mk-magic-pill" style="margin-left:8px">Signed out</span></div>
          <button class="mk-magic-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="mk-magic-row" style="margin-bottom:8px">
          <input id="mkMagicEmail" class="mk-magic-input" type="email" placeholder="Email for Magic Link" autocomplete="email" />
        </div>
        <div class="mk-magic-row" style="margin-bottom:8px">
          <textarea id="mkMagicJwt" class="mk-magic-textarea" placeholder="Optional: paste YOUR-AUTH-PROVIDER-JWT (if you already have one)"></textarea>
        </div>
        <div class="mk-magic-actions">
          <button id="mkMagicLogin" class="mk-magic-action" type="button">Log in</button>
          <button id="mkMagicLogout" class="mk-magic-action danger" type="button">Log out</button>
        </div>
        <div class="mk-magic-meta">
          Wallet: <span id="mkMagicAddress" class="mk-magic-pill">—</span>
          <div style="margin-top:6px">
            Requires <span class="mk-magic-pill">MAGIC_PUBLISHABLE_KEY</span> (+ optional <span class="mk-magic-pill">MAGIC_PROVIDER_ID</span>) on the local server.
          </div>
        </div>
        <div id="mkMagicError" class="mk-magic-error" style="display:none"></div>
      `;

      document.body.appendChild(btn);
      document.body.appendChild(panel);

      const close = panel.querySelector(".mk-magic-close");
      btn.addEventListener("click", () => {
        state.open = !state.open;
        render();
      });
      close?.addEventListener("click", () => {
        state.open = false;
        render();
      });

      const emailInput = panel.querySelector("#mkMagicEmail");
      const jwtInput = panel.querySelector("#mkMagicJwt");
      const loginBtn = panel.querySelector("#mkMagicLogin");
      const logoutBtn = panel.querySelector("#mkMagicLogout");

      emailInput?.addEventListener("input", (e) => {
        state.email = String(e?.target?.value || "");
        saveToStorage();
      });
      jwtInput?.addEventListener("input", (e) => {
        state.jwt = String(e?.target?.value || "");
        saveToStorage();
      });

      loginBtn?.addEventListener("click", async () => {
        await login();
      });
      logoutBtn?.addEventListener("click", async () => {
        await logout();
      });

      el = {
        btn,
        panel,
        status: panel.querySelector("#mkMagicStatus"),
        email: emailInput,
        jwt: jwtInput,
        loginBtn,
        logoutBtn,
        address: panel.querySelector("#mkMagicAddress"),
        error: panel.querySelector("#mkMagicError")
      };

      return el;
    }

    function setError(message) {
      state.lastError = String(message || "");
      if (!el) return;
      if (!state.lastError) {
        el.error.style.display = "none";
        el.error.textContent = "";
        return;
      }
      el.error.style.display = "block";
      el.error.textContent = state.lastError;
    }

    function render() {
      if (!el) return;
      el.panel.classList.toggle("open", Boolean(state.open));
      const signedIn = Boolean(state.jwt);
      el.btn.classList.toggle("signed-in", signedIn);
      if (el.status) el.status.textContent = signedIn ? "Signed in" : "Signed out";
      if (el.address) el.address.textContent = state.address ? state.address : "—";
      if (el.email && typeof el.email.value === "string" && el.email.value !== state.email) el.email.value = state.email;
      if (el.jwt && typeof el.jwt.value === "string" && el.jwt.value !== state.jwt) el.jwt.value = state.jwt;
      if (el.loginBtn) el.loginBtn.disabled = state.loading;
      if (el.logoutBtn) el.logoutBtn.disabled = state.loading || !signedIn;
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.async = true;
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(s);
      });
    }

    async function ensureMagicSdk() {
      if (magic) return magic;
      const publishableKey = String(global.__MAGIC_PUBLISHABLE_KEY || "").trim();
      if (!publishableKey) return null;

      if (!global.Magic) {
        await loadScript("https://unpkg.com/magic-sdk/dist/magic.js");
      }
      if (!global.Magic) return null;

      magic = new global.Magic(publishableKey);
      return magic;
    }

    async function getOrCreateWallet(jwt) {
      const providerId =
        String(global.__MAGIC_PROVIDER_ID || "").trim() ||
        String(global.__OIDC_PROVIDER_ID || "").trim();
      const chain = String(global.__MAGIC_CHAIN || "ETH").trim() || "ETH";

      const res = await fetch("/server/magic/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jwt,
          provider_id: providerId,
          chain
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || "Wallet request failed"));
      const addr = String(data?.public_address || data?.publicAddress || "");
      if (!addr) throw new Error("Wallet response missing public_address");
      return addr;
    }

    async function login() {
      ensureDom();
      setError("");
      state.loading = true;
      render();

      try {
        // If user pasted a JWT, prefer it.
        const pasted = String(state.jwt || "").trim();
        if (!pasted) {
          const sdk = await ensureMagicSdk();
          if (!sdk) throw new Error("Missing MAGIC_PUBLISHABLE_KEY (or Magic SDK failed to load).");
          const email = String(state.email || "").trim();
          if (!email) throw new Error("Enter an email for Magic Link.");

          // Magic returns a DID token. Depending on your setup, this may or may not be the
          // same as the OIDC provider JWT expected by the TEE wallet endpoint.
          await sdk.auth.loginWithMagicLink({ email });
          const did = await sdk.user.getIdToken();
          state.jwt = String(did || "");
        }

        const addr = await getOrCreateWallet(String(state.jwt || "").trim());
        state.address = addr;
        saveToStorage();
        render();
      } catch (e) {
        setError(e?.message || "Login failed");
      } finally {
        state.loading = false;
        render();
      }
    }

    async function logout() {
      ensureDom();
      setError("");
      state.loading = true;
      render();
      try {
        if (magic) {
          try {
            await magic.user.logout();
          } catch {
            // ignore
          }
        }
        state.jwt = "";
        state.address = "";
        saveToStorage();
        render();
      } finally {
        state.loading = false;
        render();
      }
    }

    function init() {
      if (typeof document === "undefined") return;
      loadFromStorage();
      ensureDom();
      render();
    }

    return {
      init,
      login,
      logout,
      getOrCreateWallet
    };
  }

  api.createMagicAuthWidget = createMagicAuthWidget;

  try {
    Object.defineProperty(api, "__version", { value: "r2026-01-26a", enumerable: true });
  } catch {
    api.__version = "r2026-01-26a";
  }

  try {
    global.MKCore = api;
  } catch {
    // ignore
  }

  try {
    if (typeof document !== "undefined") {
      const boot = () => {
        try {
          api.createMagicAuthWidget().init();
        } catch {
          // ignore
        }
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
      else boot();
    }
  } catch {
    // ignore
  }

  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
