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
      publishableKey: "mkMagicPublishableKeyV1",
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
      publishableKey: "",
      address: "",
      embeddedAddress: "",
      chain: "ETH",
      providerId: "",
      lastError: ""
    };

    let el = null;
    let magic = null;
    let suppressNextStatusClick = false;
    let toastTimer = null;
    let toastHideTimer = null;

    function getPublishableKey() {
      return String(state.publishableKey || global.__MAGIC_PUBLISHABLE_KEY || "").trim();
    }

    function hasPublishableKey() {
      const pk = getPublishableKey();
      return Boolean(pk);
    }

    function looksLikePublishableKey() {
      const pk = getPublishableKey();
      return Boolean(pk && /^pk_/i.test(pk));
    }

    function formatMagicError(err) {
      const message =
        String(err?.message || err?.reason || err?.error || "").trim() || "Login failed";
      const lower = message.toLowerCase();
      if (lower.includes("prohibited")) {
        try {
          const origin = String(window?.location?.origin || "").trim();
          return `${message} (Magic is likely blocking this domain/key; ensure ${origin || "this domain"} is allowlisted in Magic and the publishable key matches.)`;
        } catch {
          return `${message} (Magic is likely blocking this domain/key; ensure this domain is allowlisted in Magic and the publishable key matches.)`;
        }
      }
      return message;
    }

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
        state.publishableKey = String(localStorage.getItem(STORAGE.publishableKey) || "").trim();
      } catch {
        state.publishableKey = "";
      }
      if (state.publishableKey) global.__MAGIC_PUBLISHABLE_KEY = state.publishableKey;
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
        if (state.publishableKey) localStorage.setItem(STORAGE.publishableKey, String(state.publishableKey));
        else localStorage.removeItem(STORAGE.publishableKey);
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
	          .mk-magic-bubbles,.mk-magic-panel,.mk-magic-panel *{box-sizing:border-box}
	          .mk-magic-bubbles{position:fixed;right:18px;bottom:18px;z-index:999999;display:flex;flex-direction:column;gap:10px;align-items:flex-end;touch-action:none}
	          .mk-magic-bubble{appearance:none;border:0;background:transparent;color:#fff;cursor:pointer;padding:0;display:block}
	          .mk-magic-bubble:disabled{opacity:.6;cursor:not-allowed}
	          .mk-magic-bubble:hover{transform:translateY(-1px)}
	          .mk-magic-bubble:active{transform:translateY(0)}
	          .mk-magic-status{border-radius:18px}
		          .mk-magic-status-inner{position:relative;display:block;width:52px;height:52px}
		          .mk-magic-status-img{width:52px;height:52px;display:block;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);object-fit:cover;object-position:50% 28%;filter:drop-shadow(0 14px 28px rgba(0,0,0,.45))}
	          .mk-magic-status-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;letter-spacing:.2px}
	          .mk-magic-toast{position:fixed;z-index:1000000;max-width:220px;background:rgba(12,12,14,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:10px 12px;color:#fff;font-weight:800;font-size:13px;box-shadow:0 14px 40px rgba(0,0,0,.55);opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;pointer-events:none;display:none}
	          .mk-magic-toast.open{opacity:1;transform:translateY(0)}
	          .mk-magic-toast:after{content:"";position:absolute;right:22px;bottom:-8px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid rgba(12,12,14,.92)}
		          .mk-magic-panel{position:fixed;right:18px;bottom:86px;z-index:999999;width:min(640px,calc(100vw - 24px));max-height:min(640px,calc(100vh - 120px));overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.14);background:rgba(12,12,14,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e5e7eb;box-shadow:0 18px 60px rgba(0,0,0,.6);padding:14px;display:none;resize:both;min-width:320px;min-height:240px}
		          .mk-magic-panel.open{display:block}
		          @media (max-width: 720px){.mk-magic-panel{left:10px;right:10px;top:max(10px,env(safe-area-inset-top));bottom:max(10px,env(safe-area-inset-bottom));width:auto;max-height:none;min-height:0;resize:none}}
		          .mk-magic-title{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650;margin-bottom:10px}
		          .mk-magic-title{cursor:grab;user-select:none}
		          .mk-magic-title:active{cursor:grabbing}
	          @media (max-width: 720px){.mk-magic-title{position:sticky;top:0;padding:8px 0;background:rgba(12,12,14,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:1}}
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

	      const statusBubble = document.createElement("button");
	      statusBubble.type = "button";
	      statusBubble.className = "mk-magic-bubble mk-magic-status";
	      statusBubble.title = "Log in / Log out";
	      statusBubble.setAttribute("aria-label", "Log in / Log out");
		      statusBubble.innerHTML = `
		        <span class="mk-magic-status-inner">
		          <img class="mk-magic-status-img" alt="AgentC login status" src="Logged OUT.png" />
		          <span class="mk-magic-status-fallback" aria-hidden="true">C</span>
		        </span>
		      `;

		      const statusImg = statusBubble.querySelector(".mk-magic-status-img");
		      const statusFallback = statusBubble.querySelector(".mk-magic-status-fallback");
		      const OFFLINE_SVG = "Logged OUT.png";
		      const ONLINE_SVG = "Logged IN.png";
		      const OFFLINE_PNG_CACHE = "mkMagicStatusPngOfflineV1";
		      const ONLINE_PNG_CACHE = "mkMagicStatusPngOnlineV1";
		      const PNG_VERSION_KEY = "mkMagicStatusPngVersionV1";
		      const PNG_CACHE_VERSION = "r2026-01-27h";

		      const ensurePngCacheVersion = () => {
		        try {
		          const cur = String(localStorage.getItem(PNG_VERSION_KEY) || "");
		          if (cur === PNG_CACHE_VERSION) return;
		          localStorage.removeItem(OFFLINE_PNG_CACHE);
		          localStorage.removeItem(ONLINE_PNG_CACHE);
		          localStorage.setItem(PNG_VERSION_KEY, PNG_CACHE_VERSION);
		        } catch {
		          // ignore
		        }
		      };

		      const getCachedPng = (key) => {
		        ensurePngCacheVersion();
		        try {
		          const v = String(localStorage.getItem(key) || "");
		          if (v.startsWith("data:image/png")) return v;
		        } catch {
		          // ignore
		        }
		        return "";
		      };

		      const warmPngFromSvg = async (svgUrl, cacheKey) => {
		        try {
		          if (getCachedPng(cacheKey)) return;
		        } catch {
		          // ignore
		        }
		        try {
		          const res = await fetch(svgUrl, { cache: "force-cache" });
		          if (!res.ok) return;
		          const svgText = await res.text();
		          if (!svgText) return;

		          let w = 640;
		          let h = 288;
		          const m = svgText.match(/viewBox\\s*=\\s*["']\\s*[-0-9.]+\\s+[-0-9.]+\\s+([0-9.]+)\\s+([0-9.]+)\\s*["']/i);
		          if (m && m[1] && m[2]) {
		            const mw = Number(m[1]);
		            const mh = Number(m[2]);
		            if (Number.isFinite(mw) && mw > 0) w = mw;
		            if (Number.isFinite(mh) && mh > 0) h = mh;
		          }

		          const blob = new Blob([svgText], { type: "image/svg+xml" });
		          const objUrl = URL.createObjectURL(blob);
		          const img = new Image();
		          img.decoding = "async";
		          img.src = objUrl;

		          await new Promise((resolve, reject) => {
		            img.onload = resolve;
		            img.onerror = reject;
		          });
		          try {
		            URL.revokeObjectURL(objUrl);
		          } catch {
		            // ignore
		          }

		          const canvas = document.createElement("canvas");
		          canvas.width = Math.round(w);
		          canvas.height = Math.round(h);
		          const ctx = canvas.getContext("2d");
		          if (!ctx) return;
		          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

		          const png = canvas.toDataURL("image/png");
		          if (!png || !png.startsWith("data:image/png")) return;
		          try {
		            localStorage.setItem(cacheKey, png);
		          } catch {
		            // ignore
		          }
		          try {
		            if (statusImg && String(statusImg.getAttribute("src") || "") === svgUrl) {
		              statusImg.setAttribute("src", png);
		            }
		          } catch {
		            // ignore
		          }
		        } catch {
		          // ignore
		        }
		      };

		      const setStatusImg = (signedIn) => {
		        if (!statusImg) return;
		        // Root fix: always use bundled PNGs (avoid legacy SVG→PNG cache that can show oversized icons).
		        statusImg.setAttribute("src", signedIn ? ONLINE_SVG : OFFLINE_SVG);
		      };

	      try {
	        if (statusFallback) statusFallback.style.display = "none";
	        statusImg?.addEventListener("load", () => {
	          if (statusImg) statusImg.style.display = "block";
	          if (statusFallback) statusFallback.style.display = "none";
	        });
	        statusImg?.addEventListener("error", () => {
	          if (!statusImg) return;
	          statusImg.style.display = "none";
	          if (statusFallback) statusFallback.style.display = "flex";
	        });
	      } catch {
	        // ignore
	      }

	      bubbles.appendChild(statusBubble);

	      const toast = document.createElement("div");
	      toast.className = "mk-magic-toast";
	      toast.textContent = "Saved";

	      const panel = document.createElement("div");
	      panel.className = "mk-magic-panel";
	      panel.innerHTML = `
	        <div class="mk-magic-title">
	          <div>Auth + Wallet <span id="mkMagicStatus" class="mk-magic-pill" style="margin-left:8px">Signed out</span></div>
	          <button class="mk-magic-close" type="button" aria-label="Close">×</button>
	        </div>
		        <div class="mk-magic-grid">
		          <div class="mk-magic-section">
		            <div class="mk-magic-h">Email Sign-in (Magic Link)</div>
	            <div class="mk-magic-row" style="margin-bottom:10px">
	              <input id="mkMagicEmail" class="mk-magic-input" type="email" placeholder="Enter your email address" autocomplete="email" />
	            </div>
	            <div id="mkMagicPublishableKeyRow" class="mk-magic-row" style="margin-bottom:10px">
	              <input id="mkMagicPublishableKey" class="mk-magic-input" type="text" placeholder="Magic publishable key (pk_…)" autocomplete="off" autocapitalize="none" spellcheck="false" />
	            </div>
	            <button id="mkMagicOtpRegular" class="mk-magic-bigbtn" type="button">Send Magic Link</button>
	            <button id="mkMagicOtpWhitelabel" class="mk-magic-bigbtn" type="button" style="display:none">Whitelabel OTP</button>
	            <div class="mk-magic-sub">
	              Requires <span class="mk-magic-pill">MAGIC_PUBLISHABLE_KEY</span> (or paste <span class="mk-magic-pill">pk_…</span> above).
	            </div>
	          </div>
		          <div class="mk-magic-section">
		            <div class="mk-magic-h">OAuth</div>
		            <button id="mkMagicOAuthRedirect" class="mk-magic-bigbtn" type="button" style="margin-bottom:10px">Login with Redirect</button>
		            <button id="mkMagicOAuthPopup" class="mk-magic-bigbtn" type="button">Login with Popup</button>
		            <button id="mkMagicOAuthTelegram" class="mk-magic-bigbtn" type="button" style="margin-top:10px">Login with Telegram</button>
		            <div class="mk-magic-sub">
		              Google uses redirect/popup. Telegram uses a popup (requires Telegram bot configured in Magic).
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
		        <div class="mk-magic-section" style="margin-top:12px">
		          <div class="mk-magic-h">Admin</div>
		          <button id="mkMagicAccessWhitelist" class="mk-magic-action secondary" type="button" style="width:100%;justify-content:center">
		            View Magic Access Whitelist
		          </button>
		          <div class="mk-magic-sub">
		            Admin-only. Requires MK admin cookie and server env <span class="mk-magic-pill">MAGIC_SECRET_KEY</span>.
		          </div>
		        </div>
		        <div id="mkMagicError" class="mk-magic-error" style="display:none"></div>
		      `;

	      document.body.appendChild(bubbles);
	      document.body.appendChild(toast);
	      document.body.appendChild(panel);

      const close = panel.querySelector(".mk-magic-close");

		      // Drag-to-move the AgentC head bubble. Double-click to reset.
		      try {
		        const BUBBLES_LAYOUT_KEY = "mkMagicBubblesLayoutV1";
		        const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
		        const applyLayout = () => {
		          try {
		            const raw = localStorage.getItem(BUBBLES_LAYOUT_KEY);
		            if (!raw) return;
		            const obj = JSON.parse(raw);
		            const left = typeof obj?.left === "number" ? obj.left : null;
		            const top = typeof obj?.top === "number" ? obj.top : null;
		            if (left == null || top == null) return;
		            const rect = bubbles.getBoundingClientRect();
		            const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
		            const maxTop = Math.max(12, window.innerHeight - rect.height - 12);
		            const nextLeft = clamp(left, 12, maxLeft);
		            const nextTop = clamp(top, 12, maxTop);
		            bubbles.style.left = `${Math.round(nextLeft)}px`;
		            bubbles.style.top = `${Math.round(nextTop)}px`;
		            bubbles.style.right = "auto";
		            bubbles.style.bottom = "auto";
		          } catch {
		            // ignore
		          }
		        };

		        const resetLayout = () => {
		          try {
		            localStorage.removeItem(BUBBLES_LAYOUT_KEY);
		          } catch {
		            // ignore
		          }
		          bubbles.style.left = "";
		          bubbles.style.top = "";
		          bubbles.style.right = "";
		          bubbles.style.bottom = "";
		        };

		        applyLayout();
		        window.addEventListener("resize", applyLayout, { passive: true });

		        let dragArmed = false;
		        let dragging = false;
		        let startX = 0;
		        let startY = 0;
		        let baseLeft = 0;
		        let baseTop = 0;
		        let bubbleW = 0;
		        let bubbleH = 0;

		        statusBubble.addEventListener(
		          "pointerdown",
		          (e) => {
		            if (e.button !== 0) return;
		            dragArmed = true;
		            try {
		              statusBubble.setPointerCapture(e.pointerId);
		            } catch {
		              // ignore
		            }
		            dragging = false;
		            startX = e.clientX;
		            startY = e.clientY;
		            const rect = bubbles.getBoundingClientRect();
		            baseLeft = rect.left;
		            baseTop = rect.top;
		            bubbleW = rect.width;
		            bubbleH = rect.height;
		          },
		          { passive: true }
		        );

		        statusBubble.addEventListener(
		          "pointermove",
		          (e) => {
		            if (!dragArmed) return;
		            const dx = e.clientX - startX;
		            const dy = e.clientY - startY;
		            const dist = Math.hypot(dx, dy);
		            if (!dragging) {
		              if (dist < 6) return;
		              dragging = true;
		            }
		            e.preventDefault();
		            const maxLeft = Math.max(12, window.innerWidth - bubbleW - 12);
		            const maxTop = Math.max(12, window.innerHeight - bubbleH - 12);
		            const nextLeft = clamp(baseLeft + dx, 12, maxLeft);
		            const nextTop = clamp(baseTop + dy, 12, maxTop);
		            bubbles.style.left = `${Math.round(nextLeft)}px`;
		            bubbles.style.top = `${Math.round(nextTop)}px`;
		            bubbles.style.right = "auto";
		            bubbles.style.bottom = "auto";
		          },
		          { passive: false }
		        );

		        statusBubble.addEventListener(
		          "pointerup",
		          () => {
		            dragArmed = false;
		            if (!dragging) {
		              startX = 0;
		              startY = 0;
		              return;
		            }
		            suppressNextStatusClick = true;
		            setTimeout(() => {
		              suppressNextStatusClick = false;
		            }, 0);
		            dragging = false;
		            startX = 0;
		            startY = 0;
		            try {
		              const rect = bubbles.getBoundingClientRect();
		              localStorage.setItem(BUBBLES_LAYOUT_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
		            } catch {
		              // ignore
		            }
		          },
		          { passive: true }
		        );

		        statusBubble.addEventListener("dblclick", (e) => {
		          e.preventDefault();
		          suppressNextStatusClick = true;
		          setTimeout(() => {
		            suppressNextStatusClick = false;
		          }, 0);
		          resetLayout();
		        });
		      } catch {
		        // ignore
		      }

		      statusBubble.addEventListener("click", async () => {
		        if (suppressNextStatusClick) return;
		        if (state.loading) return;
		        const signedIn = Boolean(state.jwt);
		        if (signedIn) {
		          await logout();
		          state.open = false;
		          render();
		          return;
		        }

		        const email = String(state.email || "").trim();
		        if (email && looksLikePublishableKey()) {
		          await loginWithEmailOtp({ showUI: true });
		          return;
		        }

		        state.open = true;
		        render();
	        try {
	          panel.querySelector("#mkMagicEmail")?.focus();
	        } catch {
	          // ignore
	        }
	      });
		      close?.addEventListener("click", () => {
		        state.open = false;
		        render();
		      });

	      // Drag-to-move panel (desktop). Double-click title bar to reset position.
	      try {
	        const LAYOUT_KEY = "mkMagicPanelLayoutV1";
	        const titleBar = panel.querySelector(".mk-magic-title");
	        const loadLayout = () => {
	          try {
	            const raw = localStorage.getItem(LAYOUT_KEY);
	            if (!raw) return null;
	            const obj = JSON.parse(raw);
	            if (!obj || typeof obj !== "object") return null;
	            const left = typeof obj.left === "number" ? obj.left : null;
	            const top = typeof obj.top === "number" ? obj.top : null;
	            const width = typeof obj.width === "number" ? obj.width : null;
	            const height = typeof obj.height === "number" ? obj.height : null;
	            if (left == null || top == null) return null;
	            return { left, top, width, height };
	          } catch {
	            return null;
	          }
	        };
	        const saveLayout = () => {
	          try {
	            const rect = panel.getBoundingClientRect();
	            localStorage.setItem(
	              LAYOUT_KEY,
	              JSON.stringify({
	                left: rect.left,
	                top: rect.top,
	                width: rect.width,
	                height: rect.height
	              })
	            );
	          } catch {
	            // ignore
	          }
	        };
	        const applyLayout = (layout) => {
	          if (!layout) return false;
	          panel.style.right = "auto";
	          panel.style.bottom = "auto";
	          panel.style.left = `${Math.max(6, layout.left)}px`;
	          panel.style.top = `${Math.max(6, layout.top)}px`;
	          if (typeof layout.width === "number" && layout.width > 0) panel.style.width = `${layout.width}px`;
	          if (typeof layout.height === "number" && layout.height > 0) panel.style.height = `${layout.height}px`;
	          return true;
	        };
	        const resetLayout = () => {
	          try {
	            localStorage.removeItem(LAYOUT_KEY);
	          } catch {
	            // ignore
	          }
	          panel.style.left = "";
	          panel.style.top = "";
	          panel.style.width = "";
	          panel.style.height = "";
	          panel.style.right = "";
	          panel.style.bottom = "";
	        };

	        applyLayout(loadLayout());

	        let dragging = null;
	        const startDrag = (clientX, clientY) => {
	          const rect = panel.getBoundingClientRect();
	          dragging = {
	            startX: clientX,
	            startY: clientY,
	            startLeft: rect.left,
	            startTop: rect.top,
	            width: rect.width,
	            height: rect.height
	          };
	          panel.style.right = "auto";
	          panel.style.bottom = "auto";
	          document.body.style.userSelect = "none";
	        };
	        const moveDrag = (clientX, clientY) => {
	          if (!dragging) return;
	          const dx = clientX - dragging.startX;
	          const dy = clientY - dragging.startY;
	          const vw = Math.max(320, window.innerWidth || 0);
	          const vh = Math.max(320, window.innerHeight || 0);
	          const maxLeft = Math.max(6, vw - dragging.width - 6);
	          const maxTop = Math.max(6, vh - dragging.height - 6);
	          const left = Math.min(maxLeft, Math.max(6, dragging.startLeft + dx));
	          const top = Math.min(maxTop, Math.max(6, dragging.startTop + dy));
	          panel.style.left = `${left}px`;
	          panel.style.top = `${top}px`;
	        };
	        const endDrag = () => {
	          if (!dragging) return;
	          dragging = null;
	          document.body.style.userSelect = "";
	          saveLayout();
	        };

	        titleBar?.addEventListener("dblclick", (e) => {
	          if (e?.target?.closest?.(".mk-magic-close")) return;
	          resetLayout();
	        });

	        titleBar?.addEventListener("mousedown", (e) => {
	          if (e.button !== 0) return;
	          if (e?.target?.closest?.(".mk-magic-close")) return;
	          startDrag(e.clientX, e.clientY);
	          e.preventDefault();
	        });
	        window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
	        window.addEventListener("mouseup", () => endDrag());

	        titleBar?.addEventListener(
	          "touchstart",
	          (e) => {
	            const t = e.touches && e.touches[0];
	            if (!t) return;
	            startDrag(t.clientX, t.clientY);
	          },
	          { passive: true }
	        );
	        window.addEventListener(
	          "touchmove",
	          (e) => {
	            const t = e.touches && e.touches[0];
	            if (!t) return;
	            moveDrag(t.clientX, t.clientY);
	          },
	          { passive: true }
	        );
	        window.addEventListener("touchend", () => endDrag());

	        // Persist resize (if supported)
	        try {
	          const ro = new ResizeObserver(() => {
	            if (!state.open) return;
	            saveLayout();
	          });
	          ro.observe(panel);
	        } catch {
	          // ignore
	        }
	      } catch {
	        // ignore
	      }

		      const emailInput = panel.querySelector("#mkMagicEmail");
		      const publishableKeyInput = panel.querySelector("#mkMagicPublishableKey");
		      const publishableKeyRow = panel.querySelector("#mkMagicPublishableKeyRow");
	      const jwtInput = panel.querySelector("#mkMagicJwt");
	      const logoutBtn = panel.querySelector("#mkMagicLogout");
	      const otpRegularBtn = panel.querySelector("#mkMagicOtpRegular");
		      const otpWhiteBtn = panel.querySelector("#mkMagicOtpWhitelabel");
		      const oauthRedirectBtn = panel.querySelector("#mkMagicOAuthRedirect");
		      const oauthPopupBtn = panel.querySelector("#mkMagicOAuthPopup");
		      const oauthTelegramBtn = panel.querySelector("#mkMagicOAuthTelegram");
		      const embeddedSpan = panel.querySelector("#mkMagicEmbedded");
	      const providerIdInput = panel.querySelector("#mkMagicProviderId");
	      const chainSelect = panel.querySelector("#mkMagicChain");
		      const getServerWalletBtn = panel.querySelector("#mkMagicGetServerWallet");
		      const accessWhitelistBtn = panel.querySelector("#mkMagicAccessWhitelist");

	      emailInput?.addEventListener("input", (e) => {
	        state.email = String(e?.target?.value || "");
	        saveToStorage();
	        render();
	      });
			      publishableKeyInput?.addEventListener("input", (e) => {
			        state.publishableKey = String(e?.target?.value || "").trim();
			        if (state.publishableKey) global.__MAGIC_PUBLISHABLE_KEY = state.publishableKey;
			        if (state.lastError && state.lastError.toLowerCase().includes("publishable key")) setError("");
			        saveToStorage();
			        render();
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
		      oauthTelegramBtn?.addEventListener("click", async () => {
		        await loginWithTelegram();
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
		      accessWhitelistBtn?.addEventListener("click", async () => {
		        try {
		          const url = "/api/magic/access_whitelist";
		          window.open(url, "_blank", "noopener,noreferrer");
		        } catch (e) {
		          setError(String(e?.message || e) || "Could not open allowlist.");
		        }
		      });

		      el = {
		        bubbles,
		        statusBubble,
		        statusImg,
		        setStatusImg,
		        toast,
		        panel,
		        status: panel.querySelector("#mkMagicStatus"),
		        email: emailInput,
		        publishableKey: publishableKeyInput,
		        publishableKeyRow,
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
		        oauthTelegramBtn,
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
				      const hasPk = looksLikePublishableKey();
				      try {
				        el.setStatusImg?.(signedIn);
				      } catch {
				        // ignore
				      }
		      if (el.status) el.status.textContent = signedIn ? "Signed in" : "Signed out";
		      if (el.address) el.address.textContent = state.address ? state.address : "—";
		      if (el.embedded) el.embedded.textContent = state.embeddedAddress ? state.embeddedAddress : "—";
		      if (el.email && typeof el.email.value === "string" && el.email.value !== state.email) el.email.value = state.email;
		      if (el.publishableKey && typeof el.publishableKey.value === "string" && el.publishableKey.value !== state.publishableKey)
		        el.publishableKey.value = state.publishableKey;
				      if (el.publishableKeyRow && el.publishableKeyRow.style) {
				        const injectedPk = Boolean(global.__MAGIC_PUBLISHABLE_KEY && !state.publishableKey);
				        el.publishableKeyRow.style.display = injectedPk ? "none" : "flex";
				      }
		      if (el.jwt && typeof el.jwt.value === "string" && el.jwt.value !== state.jwt) el.jwt.value = state.jwt;
				      if (el.logoutBtn) el.logoutBtn.disabled = state.loading || !signedIn;
				      if (el.otpRegularBtn) el.otpRegularBtn.disabled = state.loading || !hasPk;
				      if (el.otpWhiteBtn) el.otpWhiteBtn.disabled = state.loading || !hasPk;
				      if (el.oauthRedirectBtn) el.oauthRedirectBtn.disabled = state.loading || !hasPk;
				      if (el.oauthPopupBtn) el.oauthPopupBtn.disabled = state.loading || !hasPk;
				      if (el.oauthTelegramBtn) el.oauthTelegramBtn.disabled = state.loading || !hasPk;
				      if (el.getServerWalletBtn) el.getServerWalletBtn.disabled = state.loading || !signedIn;
		      if (el.chain && typeof el.chain.value === "string" && el.chain.value !== state.chain) el.chain.value = state.chain;
		      if (el.providerId && typeof el.providerId.value === "string" && el.providerId.value !== state.providerId)
		        el.providerId.value = state.providerId;
		      if (!hasPk && state.open && !state.loading && !state.lastError) {
		        const originOk = ["http:", "https:"].includes(String(window?.location?.protocol || ""));
		        const originNote = originOk ? "" : " (This UI is not on http(s); Magic may require a browser-served URL.)";
		        setError(`Magic login is disabled until a publishable key is set (MAGIC_PUBLISHABLE_KEY / pk_…).${originNote}`);
		      }
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
		      let publishableKey = getPublishableKey();
		      if (!publishableKey) {
		        await fetchMagicConfig();
		        publishableKey = getPublishableKey();
		      }
		      if (!publishableKey) return null;
		      if (!/^pk_/i.test(publishableKey)) throw new Error("Invalid Magic publishable key (expected pk_…).");
		      global.__MAGIC_PUBLISHABLE_KEY = publishableKey;

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

		      // Optional OAuth2 extension (Google login) — best-effort load for static HTML builds.
		      try {
		        if (!global.OAuthExtension) {
		          try {
		            await loadScript("https://cdn.jsdelivr.net/npm/@magic-ext/oauth2/dist/extension.js");
		          } catch {
		            await loadScript("https://unpkg.com/@magic-ext/oauth2/dist/extension.js");
		          }
		        }
		      } catch {
		        // ignore
		      }

		      const magicOptions = { useStorageCache: true };
		      try {
		        const OAuthExt = global.OAuthExtension || global.OAuthExtension?.OAuthExtension;
		        if (typeof OAuthExt === "function") {
		          magicOptions.extensions = [new OAuthExt()];
		        }
		      } catch {
		        // ignore
		      }

		      magic = new global.Magic(publishableKey, magicOptions);
	      try {
	        if (magic?.user?.onUserLoggedOut) {
	          magic.user.onUserLoggedOut((isLoggedOut) => {
	            if (!isLoggedOut) return;
	            state.jwt = "";
	            state.address = "";
	            state.embeddedAddress = "";
	            saveToStorage();
	            render();
	          });
	        }
	      } catch {
	        // ignore
	      }
	      return magic;
	    }

		    async function maybeCompleteOAuthRedirect() {
		      const sdk = await ensureMagicSdk();
		      const oauth = sdk?.oauth2 && typeof sdk.oauth2.getRedirectResult === "function" ? sdk.oauth2 : sdk?.oauth;
		      if (!sdk || !oauth || typeof oauth.getRedirectResult !== "function") return false;

		      try {
		        const result = await oauth.getRedirectResult();
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
			        if (!looksLikePublishableKey()) throw new Error("Invalid Magic publishable key (expected pk_…).");
			        const email = String(state.email || "").trim();
			        if (!email) throw new Error("Enter an email address.");
			        const doMagicLink = async () => {
			          if (!sdk.auth?.loginWithMagicLink) throw new Error("Magic Link login not available in this SDK build.");
			          await sdk.auth.loginWithMagicLink({ email, showUI: Boolean(showUI) });
			        };
			        if (sdk.auth?.loginWithEmailOTP) {
			          try {
			            if (showUI === false) {
			              // Minimal whitelabel flow: prompt for OTP and emit events if supported.
			              const handle = sdk.auth.loginWithEmailOTP({ email, showUI: false, deviceCheckUI: false });
			              const result = await new Promise((resolve, reject) => {
			                let settled = false;
			                const done = (v) => {
			                  if (settled) return;
			                  settled = true;
			                  resolve(v);
			                };
			                const fail = (e) => {
			                  if (settled) return;
			                  settled = true;
			                  reject(e);
			                };
			                try {
			                  handle?.on?.("email-otp-sent", () => {
			                    try {
			                      const otp = window.prompt("Enter the code from your email");
			                      if (!otp) {
			                        handle?.emit?.("cancel");
			                        fail(new Error("Login canceled."));
			                        return;
			                      }
			                      handle?.emit?.("verify-email-otp", otp);
			                    } catch (e) {
			                      fail(e);
			                    }
			                  });
			                  handle?.on?.("invalid-email-otp", () => {
			                    try {
			                      const otp = window.prompt("Invalid code. Try again:");
			                      if (!otp) {
			                        handle?.emit?.("cancel");
			                        fail(new Error("Login canceled."));
			                        return;
			                      }
			                      handle?.emit?.("verify-email-otp", otp);
			                    } catch (e) {
			                      fail(e);
			                    }
			                  });
			                  handle?.on?.("done", done);
			                  handle?.on?.("error", fail);
			                  if (typeof handle?.then === "function") handle.then(done).catch(fail);
			                } catch (e) {
			                  fail(e);
			                }
			              });
			              void result;
			            } else {
			              await sdk.auth.loginWithEmailOTP({ email, showUI: true });
			            }
			          } catch (otpErr) {
			            try {
			              await doMagicLink();
			            } catch (mlErr) {
			              const otpMsg = String(otpErr?.message || otpErr?.reason || "").trim();
			              const mlMsg = String(mlErr?.message || mlErr?.reason || "").trim();
		              throw new Error(
		                `Email OTP failed${otpMsg ? `: ${otpMsg}` : ""}. Magic Link also failed${mlMsg ? `: ${mlMsg}` : ""}.`
		              );
		            }
		          }
			        } else {
			          await doMagicLink();
			        }
					        await refreshFromMagic();
					        saveToStorage();
			      } catch (e) {
			        setError(formatMagicError(e));
			      } finally {
			        state.loading = false;
			        render();
			      }
			    }

    function showSavedToast(text = "Saved", durationMs = 2000) {
      ensureDom();
      if (!el?.toast || !el?.statusBubble) return;
      const toastEl = el.toast;
      try {
        if (toastHideTimer) clearTimeout(toastHideTimer);
        if (toastTimer) clearTimeout(toastTimer);
      } catch {
        // ignore
      }
      toastEl.textContent = String(text || "Saved");
      toastEl.style.display = "block";

      const position = () => {
        try {
          const headRect = el.statusBubble.getBoundingClientRect();
          toastEl.style.left = "12px";
          toastEl.style.top = "12px";
          toastEl.style.visibility = "hidden";
          toastEl.classList.add("open");
          const tRect = toastEl.getBoundingClientRect();
          let left = headRect.right - tRect.width;
          let top = headRect.top - tRect.height - 12;
          left = Math.min(window.innerWidth - tRect.width - 12, Math.max(12, left));
          top = Math.min(window.innerHeight - tRect.height - 12, Math.max(12, top));
          toastEl.style.left = `${Math.round(left)}px`;
          toastEl.style.top = `${Math.round(top)}px`;
          toastEl.style.visibility = "visible";
        } catch {
          // ignore
        }
      };

      position();
      requestAnimationFrame(position);

      toastTimer = setTimeout(() => {
        try {
          toastEl.classList.remove("open");
        } catch {
          // ignore
        }
        toastHideTimer = setTimeout(() => {
          try {
            toastEl.style.display = "none";
          } catch {
            // ignore
          }
        }, 220);
      }, Math.max(200, Number(durationMs) || 2000));
    }

	    async function loginWithOAuth({ flow }) {
	      ensureDom();
	      setError("");
	      state.loading = true;
	      render();
	      try {
	        const sdk = await ensureMagicSdk();
	        if (!sdk) throw new Error("Missing MAGIC_PUBLISHABLE_KEY (or Magic SDK failed to load).");
	        const oauth = sdk?.oauth2 || sdk?.oauth;
	        if (!oauth) throw new Error("Magic OAuth not available in this SDK build.");
	        const provider = "google";
	        const redirectURI = (() => {
	          try {
	            return new URL("/oauth/callback", window.location.origin).toString();
	          } catch {
	            return String(window.location.href);
	          }
	        })();
	        if (flow === "redirect") {
	          if (!oauth.loginWithRedirect) throw new Error("loginWithRedirect not available.");
	          await oauth.loginWithRedirect({ provider, redirectURI, scope: ["user:email"] });
	          return;
	        }
	        if (oauth.loginWithPopup) {
	          await oauth.loginWithPopup({ provider, scope: ["user:email"] });
	        } else if (oauth.loginWithRedirect) {
	          await oauth.loginWithRedirect({ provider, redirectURI, scope: ["user:email"] });
	          return;
	        } else {
	          throw new Error("OAuth login is unavailable in this SDK build.");
	        }
	        await refreshFromMagic();
	        saveToStorage();
	      } catch (e) {
	        setError(e?.message || "OAuth login failed");
	      } finally {
	        state.loading = false;
	        render();
	      }
	    }

	    async function loginWithTelegram() {
	      ensureDom();
	      setError("");
	      state.loading = true;
	      render();
	      try {
	        const sdk = await ensureMagicSdk();
	        if (!sdk) throw new Error("Missing MAGIC_PUBLISHABLE_KEY (or Magic SDK failed to load).");
	        const oauth = sdk?.oauth2 || sdk?.oauth;
	        if (!oauth) throw new Error("Magic OAuth not available in this SDK build.");

	        const redirectURI = (() => {
	          try {
	            return new URL("/oauth/callback", window.location.origin).toString();
	          } catch {
	            return String(window.location.href);
	          }
	        })();

	        if (oauth.loginWithPopup) {
	          await oauth.loginWithPopup({ provider: "telegram" });
	        } else if (oauth.loginWithRedirect) {
	          await oauth.loginWithRedirect({ provider: "telegram", redirectURI });
	          return;
	        } else {
	          throw new Error("Telegram login is unavailable in this SDK build.");
	        }

	        await refreshFromMagic();
	        saveToStorage();
	      } catch (e) {
	        setError(e?.message || "Telegram login failed");
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
		      openPanel: () => {
		        ensureDom();
		        if (state.loading) return;
		        state.open = true;
		        render();
		        try {
		          el?.panel?.querySelector?.("#mkMagicEmail")?.focus?.();
		        } catch {
		          // ignore
		        }
		      },
		      closePanel: () => {
		        ensureDom();
		        if (state.loading) return;
		        state.open = false;
		        render();
		      },
		      getAuth: () => {
		        return {
		          signedIn: Boolean(state.jwt),
		          jwt: String(state.jwt || ""),
		          embeddedAddress: String(state.embeddedAddress || ""),
		          serverAddress: String(state.address || ""),
		          chain: String(state.chain || "ETH"),
		          providerId: String(state.providerId || "")
		        };
		      },
		      loginWithEmailOtp,
		      loginWithOAuth,
		      logout,
		      showSavedToast,
		      getOrCreateServerWallet
	    };
	  }

  api.createMagicAuthWidget = createMagicAuthWidget;

		  try {
		    Object.defineProperty(api, "__version", { value: "r2026-01-27h", enumerable: true });
			  } catch {
		    api.__version = "r2026-01-27h";
			  }

  api.showSavedToast = (text, durationMs) => {
    try {
      api.magicAuth?.showSavedToast?.(text, durationMs);
    } catch {
      // ignore
    }
  };

  try {
    global.MKCore = api;
  } catch {
    // ignore
  }

	  try {
	    if (typeof document !== "undefined") {
	      const boot = () => {
	        try {
	          if (global.MKMagicAuth && typeof global.MKMagicAuth.init === "function") return;
	          const widget = api.createMagicAuthWidget();
	          try {
	            Object.defineProperty(api, "magicAuth", { value: widget, enumerable: true });
	          } catch {
	            api.magicAuth = widget;
	          }
	          try {
	            global.MKMagicAuth = widget;
	          } catch {
	            // ignore
	          }
	          widget.init();
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
