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
      address: "mkMagicWalletAddressV1",
      embedded: "mkMagicEmbeddedAddressV1",
      chain: "mkMagicChainV1",
      providerId: "mkMagicProviderIdV1"
    };

    const state = {
      open: false,
      loading: false,
      jwt: "",
      email: "",
      address: "",
      embeddedAddress: "",
      chain: "ETH",
      providerId: "",
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
      try {
        state.embeddedAddress = String(localStorage.getItem(STORAGE.embedded) || "");
      } catch {
        state.embeddedAddress = "";
      }
      try {
        state.chain = String(localStorage.getItem(STORAGE.chain) || "ETH").trim() || "ETH";
      } catch {
        state.chain = "ETH";
      }
      try {
        state.providerId = String(localStorage.getItem(STORAGE.providerId) || "").trim();
      } catch {
        state.providerId = "";
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
      try {
        if (state.embeddedAddress) localStorage.setItem(STORAGE.embedded, state.embeddedAddress);
        else localStorage.removeItem(STORAGE.embedded);
      } catch {
        // ignore
      }
      try {
        localStorage.setItem(STORAGE.chain, String(state.chain || "ETH"));
      } catch {
        // ignore
      }
      try {
        if (state.providerId) localStorage.setItem(STORAGE.providerId, String(state.providerId));
        else localStorage.removeItem(STORAGE.providerId);
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
	          .mk-magic-bubbles{position:fixed;right:18px;bottom:18px;z-index:999999;display:flex;flex-direction:column;gap:10px;align-items:flex-end}
	          .mk-magic-bubble{appearance:none;border:0;background:transparent;color:#fff;cursor:pointer;padding:0;display:block}
	          .mk-magic-bubble:disabled{opacity:.6;cursor:not-allowed}
	          .mk-magic-bubble:hover{transform:translateY(-1px)}
	          .mk-magic-bubble:active{transform:translateY(0)}
	          .mk-magic-avatar{position:relative;width:72px;height:72px;border-radius:999px;overflow:hidden;display:block;background:rgba(12,12,14,.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 60px rgba(0,0,0,.55)}
	          .mk-magic-avatar-img{width:100%;height:100%;object-fit:cover;display:block}
	          .mk-magic-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;letter-spacing:.2px}
	          .mk-magic-avatar-c{position:absolute;top:8px;left:50%;transform:translateX(-50%);font-weight:950;font-size:22px;letter-spacing:-.02em;text-shadow:0 2px 12px rgba(0,0,0,.65), 0 0 0.75px rgba(0,0,0,.55);color:#ef4444;transition:color 180ms ease}
	          .mk-magic-bubble.signed-in .mk-magic-avatar-c{color:#22c55e}
	          .mk-magic-ring{position:absolute;inset:-2px;border-radius:999px;pointer-events:none;border:2px solid rgba(239,68,68,.55)}
	          .mk-magic-bubble.signed-in .mk-magic-ring{border-color:rgba(34,197,94,.65)}
	          .mk-magic-ring{transition:border-color 180ms ease}
	          .mk-magic-panel{position:fixed;right:18px;bottom:86px;z-index:999999;width:min(760px,calc(100vw - 36px));border-radius:16px;border:1px solid rgba(255,255,255,.14);background:rgba(12,12,14,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e5e7eb;box-shadow:0 18px 60px rgba(0,0,0,.6);padding:14px;display:none}
	          .mk-magic-panel.open{display:block}
	          .mk-magic-title{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650;margin-bottom:10px}
	          .mk-magic-close{appearance:none;border:0;background:transparent;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px}
	          .mk-magic-row{display:flex;gap:8px;align-items:center}
	          .mk-magic-input,.mk-magic-textarea{width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e5e7eb;padding:10px 10px;font-size:13px;outline:none}
	          .mk-magic-textarea{min-height:72px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
	          .mk-magic-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
	          .mk-magic-action{flex:1;appearance:none;border:0;border-radius:12px;padding:10px 12px;font-weight:650;color:#fff;background:#2563eb;cursor:pointer}
	          .mk-magic-action.secondary{background:transparent;border:1px solid rgba(255,255,255,.14);color:#e5e7eb}
	          .mk-magic-action.danger{background:transparent;border:1px solid rgba(239,68,68,.35);color:#fca5a5}
	          .mk-magic-action:disabled{opacity:.6;cursor:not-allowed}
	          .mk-magic-meta{margin-top:10px;font-size:12px;color:#9ca3af;line-height:1.35}
	          .mk-magic-error{margin-top:10px;border-radius:12px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.10);color:#fecaca;padding:10px;font-size:12px}
	          .mk-magic-pill{display:inline-block;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);padding:4px 8px;border-radius:999px;font-size:12px;color:#cbd5e1}
	          .mk-magic-grid{display:grid;grid-template-columns:1fr;gap:12px}
	          @media (min-width: 720px){.mk-magic-grid{grid-template-columns:1fr 1fr;gap:16px}}
	          .mk-magic-section{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.03);padding:12px}
	          .mk-magic-h{font-size:12px;color:#cbd5e1;font-weight:700;margin:0 0 10px 0;letter-spacing:.02em}
	          .mk-magic-sub{font-size:12px;color:#9ca3af;margin-top:8px;line-height:1.35}
	          .mk-magic-bigbtn{width:100%;appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;border-radius:18px;padding:14px 14px;font-weight:750;font-size:16px;cursor:pointer}
	          .mk-magic-bigbtn:hover{background:rgba(255,255,255,.10)}
	          .mk-magic-bigbtn:disabled{opacity:.6;cursor:not-allowed}
	          .mk-magic-split{display:flex;gap:10px;margin-top:10px}
	          .mk-magic-split > button{flex:1}
	        `;
	        document.head.appendChild(style);
	      }

	      const bubbles = document.createElement("div");
	      bubbles.className = "mk-magic-bubbles";

	      const loginBubble = document.createElement("button");
	      loginBubble.type = "button";
	      loginBubble.className = "mk-magic-bubble mk-magic-bubble-login";
	      loginBubble.title = "Log in / Account";
	      loginBubble.setAttribute("aria-label", "Log in / Account");
	      loginBubble.innerHTML = `
	        <span class="mk-magic-avatar">
	          <span class="mk-magic-ring" aria-hidden="true"></span>
	          <img class="mk-magic-avatar-img" alt="AgentC" src="agentc_bubble.png" />
	          <span class="mk-magic-avatar-c" aria-hidden="true">C</span>
	          <span class="mk-magic-avatar-fallback" aria-hidden="true">C</span>
	        </span>
	      `;

	      const logoutBubble = document.createElement("button");
	      logoutBubble.type = "button";
	      logoutBubble.className = "mk-magic-bubble mk-magic-bubble-logout";
	      logoutBubble.title = "Log out";
	      logoutBubble.setAttribute("aria-label", "Log out");
	      logoutBubble.innerHTML = `
	        <span class="mk-magic-avatar">
	          <span class="mk-magic-ring" aria-hidden="true"></span>
	          <img class="mk-magic-avatar-img" alt="AgenT101" src="agent101_bubble.png" />
	          <span class="mk-magic-avatar-fallback" aria-hidden="true">T</span>
	        </span>
	      `;

	      const wireFallback = (btnEl, pngName, svgName) => {
	        try {
	          const img = btnEl.querySelector(".mk-magic-avatar-img");
	          const fallback = btnEl.querySelector(".mk-magic-avatar-fallback");
	          if (fallback) fallback.style.display = "none";
	          img?.addEventListener("error", () => {
	            if (!img) return;
	            const src = String(img.getAttribute("src") || "");
	            if (src.endsWith(".png")) {
	              img.setAttribute("src", svgName);
	              return;
	            }
	            img.style.display = "none";
	            if (fallback) fallback.style.display = "flex";
	          });
	          img?.addEventListener("load", () => {
	            if (img) img.style.display = "block";
	            if (fallback) fallback.style.display = "none";
	          });
	        } catch {
	          // ignore
	        }
	      };
	      wireFallback(loginBubble, "agentc_bubble.png", "agentc_bubble.svg");
	      wireFallback(logoutBubble, "agent101_bubble.png", "agent101_bubble.svg");

	      bubbles.appendChild(loginBubble);
	      bubbles.appendChild(logoutBubble);

	      const panel = document.createElement("div");
	      panel.className = "mk-magic-panel";
	      panel.innerHTML = `
	        <div class="mk-magic-title">
	          <div>Auth + Wallet <span id="mkMagicStatus" class="mk-magic-pill" style="margin-left:8px">Signed out</span></div>
	          <button class="mk-magic-close" type="button" aria-label="Close">×</button>
	        </div>
	        <div class="mk-magic-grid">
	          <div class="mk-magic-section">
	            <div class="mk-magic-h">Email OTP Authentication</div>
	            <div class="mk-magic-row" style="margin-bottom:10px">
	              <input id="mkMagicEmail" class="mk-magic-input" type="email" placeholder="Enter your email address" autocomplete="email" />
	            </div>
	            <div class="mk-magic-split">
	              <button id="mkMagicOtpRegular" class="mk-magic-bigbtn" type="button">Regular OTP</button>
	              <button id="mkMagicOtpWhitelabel" class="mk-magic-bigbtn" type="button">Whitelabel OTP</button>
	            </div>
	            <div class="mk-magic-sub">
	              Requires <span class="mk-magic-pill">MAGIC_PUBLISHABLE_KEY</span>.
	            </div>
	          </div>
	          <div class="mk-magic-section">
	            <div class="mk-magic-h">OAuth</div>
	            <button id="mkMagicOAuthRedirect" class="mk-magic-bigbtn" type="button" style="margin-bottom:10px">Login with Redirect</button>
	            <button id="mkMagicOAuthPopup" class="mk-magic-bigbtn" type="button">Login with Popup</button>
	            <div class="mk-magic-sub">
	              Provider defaults to Google. Redirect uses the current URL as callback.
	            </div>
	          </div>
	        </div>

	        <div class="mk-magic-section" style="margin-top:12px">
	          <div class="mk-magic-h">Wallet</div>
	          <div class="mk-magic-row" style="margin-bottom:10px; gap:10px; flex-wrap:wrap">
	            <span>Embedded:</span>
	            <span id="mkMagicEmbedded" class="mk-magic-pill">—</span>
	            <span style="opacity:.45">|</span>
	            <span>Server:</span>
	            <span id="mkMagicAddress" class="mk-magic-pill">—</span>
	          </div>
	          <div class="mk-magic-row" style="margin-bottom:10px">
	            <input id="mkMagicProviderId" class="mk-magic-input" type="text" placeholder="X-OIDC-Provider-ID (optional if injected)" />
	          </div>
	          <div class="mk-magic-row" style="margin-bottom:10px">
	            <select id="mkMagicChain" class="mk-magic-input" style="max-width:160px">
	              <option value="ETH">Ethereum</option>
	              <option value="POLYGON">Polygon</option>
	            </select>
	            <button id="mkMagicGetServerWallet" class="mk-magic-action secondary" type="button" style="flex:1">Get/Create Server Wallet</button>
	          </div>
	          <div class="mk-magic-row" style="margin-bottom:10px">
	            <textarea id="mkMagicJwt" class="mk-magic-textarea" placeholder="Auth provider JWT for Server Wallet (Authorization: Bearer …). If you used Magic above, this field is auto-filled with the Magic ID token (may not match your auth provider)."></textarea>
	          </div>
	          <div class="mk-magic-actions">
	            <button id="mkMagicLogout" class="mk-magic-action danger" type="button">Log out</button>
	          </div>
	          <div class="mk-magic-sub">
	            Local dev uses <span class="mk-magic-pill">/server/magic/wallet</span>; production uses <span class="mk-magic-pill">/api/magic/wallet</span>.
	          </div>
	        </div>
	        <div id="mkMagicError" class="mk-magic-error" style="display:none"></div>
	      `;

	      document.body.appendChild(bubbles);
	      document.body.appendChild(panel);

      const close = panel.querySelector(".mk-magic-close");
	      loginBubble.addEventListener("click", async () => {
	        if (state.loading) return;
	        if (!state.jwt) {
	          const email = String(state.email || "").trim();
	          if (email) {
	            await loginWithEmailOtp({ showUI: true });
	            return;
	          }
	        }
	        state.open = !state.open;
	        render();
	        try {
	          panel.querySelector("#mkMagicEmail")?.focus();
	        } catch {
	          // ignore
	        }
	      });
	      logoutBubble.addEventListener("click", async () => {
	        if (state.loading) return;
	        await logout();
	        state.open = false;
	        render();
	      });
      close?.addEventListener("click", () => {
        state.open = false;
        render();
      });

	      const emailInput = panel.querySelector("#mkMagicEmail");
	      const jwtInput = panel.querySelector("#mkMagicJwt");
	      const logoutBtn = panel.querySelector("#mkMagicLogout");
	      const otpRegularBtn = panel.querySelector("#mkMagicOtpRegular");
	      const otpWhiteBtn = panel.querySelector("#mkMagicOtpWhitelabel");
	      const oauthRedirectBtn = panel.querySelector("#mkMagicOAuthRedirect");
	      const oauthPopupBtn = panel.querySelector("#mkMagicOAuthPopup");
	      const embeddedSpan = panel.querySelector("#mkMagicEmbedded");
	      const providerIdInput = panel.querySelector("#mkMagicProviderId");
	      const chainSelect = panel.querySelector("#mkMagicChain");
	      const getServerWalletBtn = panel.querySelector("#mkMagicGetServerWallet");

      emailInput?.addEventListener("input", (e) => {
        state.email = String(e?.target?.value || "");
        saveToStorage();
      });
	      jwtInput?.addEventListener("input", (e) => {
	        state.jwt = String(e?.target?.value || "");
	        saveToStorage();
	      });

	      logoutBtn?.addEventListener("click", async () => {
	        await logout();
	      });
	      otpRegularBtn?.addEventListener("click", async () => {
	        await loginWithEmailOtp({ showUI: true });
	      });
	      otpWhiteBtn?.addEventListener("click", async () => {
	        await loginWithEmailOtp({ showUI: false });
	      });
	      oauthRedirectBtn?.addEventListener("click", async () => {
	        await loginWithOAuth({ flow: "redirect" });
	      });
	      oauthPopupBtn?.addEventListener("click", async () => {
	        await loginWithOAuth({ flow: "popup" });
	      });
	      providerIdInput?.addEventListener("input", (e) => {
	        state.providerId = String(e?.target?.value || "").trim();
	        saveToStorage();
	      });
	      chainSelect?.addEventListener("change", (e) => {
	        state.chain = String(e?.target?.value || "ETH").trim() || "ETH";
	        saveToStorage();
	      });
	      getServerWalletBtn?.addEventListener("click", async () => {
	        await getOrCreateServerWallet();
	      });

	      el = {
	        bubbles,
	        loginBubble,
	        logoutBubble,
	        panel,
	        status: panel.querySelector("#mkMagicStatus"),
	        email: emailInput,
	        jwt: jwtInput,
	        logoutBtn,
	        address: panel.querySelector("#mkMagicAddress"),
	        embedded: embeddedSpan,
	        providerId: providerIdInput,
	        chain: chainSelect,
	        otpRegularBtn,
	        otpWhiteBtn,
	        oauthRedirectBtn,
	        oauthPopupBtn,
	        getServerWalletBtn,
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
		      el.loginBubble.classList.toggle("signed-in", signedIn);
		      el.logoutBubble.classList.toggle("signed-in", signedIn);
		      el.logoutBubble.style.display = signedIn ? "block" : "none";
		      if (el.status) el.status.textContent = signedIn ? "Signed in" : "Signed out";
		      if (el.address) el.address.textContent = state.address ? state.address : "—";
		      if (el.embedded) el.embedded.textContent = state.embeddedAddress ? state.embeddedAddress : "—";
	      if (el.email && typeof el.email.value === "string" && el.email.value !== state.email) el.email.value = state.email;
	      if (el.jwt && typeof el.jwt.value === "string" && el.jwt.value !== state.jwt) el.jwt.value = state.jwt;
		      if (el.logoutBtn) el.logoutBtn.disabled = state.loading || !signedIn;
		      if (el.otpRegularBtn) el.otpRegularBtn.disabled = state.loading;
		      if (el.otpWhiteBtn) el.otpWhiteBtn.disabled = state.loading;
		      if (el.oauthRedirectBtn) el.oauthRedirectBtn.disabled = state.loading;
		      if (el.oauthPopupBtn) el.oauthPopupBtn.disabled = state.loading;
		      if (el.getServerWalletBtn) el.getServerWalletBtn.disabled = state.loading || !signedIn;
	      if (el.chain && typeof el.chain.value === "string" && el.chain.value !== state.chain) el.chain.value = state.chain;
	      if (el.providerId && typeof el.providerId.value === "string" && el.providerId.value !== state.providerId)
	        el.providerId.value = state.providerId;
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

	    async function fetchMagicConfig() {
	      try {
	        const res = await fetch("/api/magic/config", { cache: "no-store" });
	        const json = await res.json().catch(() => null);
	        if (!res.ok) return null;
	        if (!json || typeof json !== "object") return null;

	        if (typeof json.publishableKey === "string" && json.publishableKey.trim()) {
	          global.__MAGIC_PUBLISHABLE_KEY = json.publishableKey.trim();
	        }
	        if (typeof json.providerId === "string" && json.providerId.trim()) {
	          global.__MAGIC_PROVIDER_ID = json.providerId.trim();
	        }
	        if (typeof json.chain === "string" && json.chain.trim()) {
	          global.__MAGIC_CHAIN = json.chain.trim();
	        }
	        return json;
	      } catch {
	        return null;
	      }
	    }

	    async function ensureMagicSdk() {
	      if (magic) return magic;
	      let publishableKey = String(global.__MAGIC_PUBLISHABLE_KEY || "").trim();
	      if (!publishableKey) {
	        await fetchMagicConfig();
	        publishableKey = String(global.__MAGIC_PUBLISHABLE_KEY || "").trim();
	      }
	      if (!publishableKey) return null;

	      if (!global.Magic) {
	        const urls = [
	          "https://unpkg.com/magic-sdk/dist/magic.js",
	          "https://cdn.jsdelivr.net/npm/magic-sdk/dist/magic.js"
	        ];
	        let loaded = false;
	        for (const url of urls) {
	          try {
	            await loadScript(url);
	            loaded = true;
	            break;
	          } catch {
	            // try next
	          }
	        }
	        if (!loaded) throw new Error("Failed to load Magic SDK.");
	      }
	      if (!global.Magic) return null;

	      magic = new global.Magic(publishableKey);
	      return magic;
	    }

	    async function maybeCompleteOAuthRedirect() {
	      const sdk = await ensureMagicSdk();
	      if (!sdk || !sdk.oauth || typeof sdk.oauth.getRedirectResult !== "function") return false;

	      try {
	        const result = await sdk.oauth.getRedirectResult();
	        if (!result) return false;
	        await refreshFromMagic();
	        saveToStorage();
	        try {
	          const url = new URL(window.location.href);
	          url.search = "";
	          window.history.replaceState({}, "", url.toString());
	        } catch {
	          // ignore
	        }
	        return true;
	      } catch {
	        return false;
	      }
	    }

	    async function refreshFromMagic() {
	      const sdk = await ensureMagicSdk();
	      if (!sdk) return;
	      try {
	        const isLoggedIn = sdk.user?.isLoggedIn ? await sdk.user.isLoggedIn() : false;
	        if (!isLoggedIn) return;
	        const idToken = sdk.user?.getIdToken ? await sdk.user.getIdToken() : "";
	        if (idToken) state.jwt = String(idToken);
	        const meta = sdk.user?.getMetadata ? await sdk.user.getMetadata() : null;
	        const addr = String(meta?.publicAddress || meta?.public_address || "");
	        if (addr) state.embeddedAddress = addr;
	      } catch {
	        // ignore
	      }
	    }

		    async function loginWithEmailOtp({ showUI }) {
	      ensureDom();
	      setError("");
	      state.loading = true;
	      render();

	      try {
	        const sdk = await ensureMagicSdk();
	        if (!sdk) throw new Error("Missing MAGIC_PUBLISHABLE_KEY (or Magic SDK failed to load).");
	        const email = String(state.email || "").trim();
	        if (!email) throw new Error("Enter an email address.");
		        if (sdk.auth?.loginWithEmailOTP) {
		          await sdk.auth.loginWithEmailOTP({ email });
		        } else {
		          await sdk.auth.loginWithMagicLink({ email, showUI: Boolean(showUI) });
		        }
		        await refreshFromMagic();
		        saveToStorage();
	      } catch (e) {
	        setError(e?.message || "Login failed");
	      } finally {
	        state.loading = false;
	        render();
	      }
	    }

	    async function loginWithOAuth({ flow }) {
	      ensureDom();
	      setError("");
	      state.loading = true;
	      render();
	      try {
	        const sdk = await ensureMagicSdk();
	        if (!sdk) throw new Error("Missing MAGIC_PUBLISHABLE_KEY (or Magic SDK failed to load).");
	        if (!sdk.oauth) throw new Error("Magic OAuth not available in this SDK build.");
	        const provider = "google";
	        if (flow === "redirect") {
	          if (!sdk.oauth.loginWithRedirect) throw new Error("loginWithRedirect not available.");
	          await sdk.oauth.loginWithRedirect({ provider, redirectURI: window.location.href });
	          return;
	        }
	        if (!sdk.oauth.loginWithPopup) throw new Error("loginWithPopup not available.");
	        await sdk.oauth.loginWithPopup({ provider });
	        await refreshFromMagic();
	        saveToStorage();
	      } catch (e) {
	        setError(e?.message || "OAuth login failed");
	      } finally {
	        state.loading = false;
	        render();
	      }
	    }

	    async function getOrCreateServerWallet() {
	      ensureDom();
	      setError("");
	      state.loading = true;
	      render();
	      try {
	        const jwt = String(state.jwt || "").trim();
	        if (!jwt) throw new Error("Missing JWT. Log in first or paste your auth provider JWT.");

	        const providerId =
	          String(state.providerId || "").trim() ||
	          String(global.__MAGIC_PROVIDER_ID || "").trim() ||
	          String(global.__OIDC_PROVIDER_ID || "").trim();
	        if (!providerId) throw new Error("Missing provider id (X-OIDC-Provider-ID).");

	        const chain = String(state.chain || global.__MAGIC_CHAIN || "ETH").trim() || "ETH";
	        const payload = { jwt, provider_id: providerId, chain };

	        const attempt = async (url) => {
	          const res = await fetch(url, {
	            method: "POST",
	            headers: { "Content-Type": "application/json" },
	            body: JSON.stringify(payload)
	          });
	          const json = await res.json().catch(() => null);
	          return { ok: res.ok, status: res.status, json };
	        };

	        let out = await attempt("/server/magic/wallet");
	        if (!out.ok && out.status === 404) out = await attempt("/api/magic/wallet");
	        if (!out.ok) throw new Error(String(out.json?.error || "Wallet request failed"));

	        const addr = String(out.json?.public_address || out.json?.publicAddress || "");
	        if (!addr) throw new Error("Wallet response missing public_address");
	        state.address = addr;
	        saveToStorage();
	      } catch (e) {
	        setError(e?.message || "Wallet failed");
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
	        state.embeddedAddress = "";
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
	      if (!state.providerId) state.providerId = String(global.__MAGIC_PROVIDER_ID || "").trim();
	      if (String(global.__MAGIC_CHAIN || "").trim() && state.chain === "ETH") state.chain = String(global.__MAGIC_CHAIN || "").trim();
	      ensureDom();
	      fetchMagicConfig()
	        .catch(() => null)
	        .finally(() => {
	          if (!state.providerId) state.providerId = String(global.__MAGIC_PROVIDER_ID || "").trim();
	          if (String(global.__MAGIC_CHAIN || "").trim() && state.chain === "ETH") state.chain = String(global.__MAGIC_CHAIN || "").trim();
	          render();
	        });
	      maybeCompleteOAuthRedirect().catch(() => null);
	      refreshFromMagic()
	        .catch(() => null)
	        .finally(() => {
	          render();
	        });
	      render();
	    }

	    return {
	      init,
	      loginWithEmailOtp,
	      loginWithOAuth,
	      logout,
	      getOrCreateServerWallet
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
