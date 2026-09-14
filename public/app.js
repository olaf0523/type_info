(() => {
  "use strict";

  const PIN_LENGTH = 15;
  // SHA-256 of the access code (the code itself is not stored in the page).
  const PIN_HASH = "7631ea876468c855728dd063ffff91c185bff5499cb4acf2ec7900b5b3f9dd54";
  const SESSION_KEY = "kaisha-index:unlocked";
  const THEME_KEY = "kaisha-index:theme";
  const MAX_ATTEMPTS = 5;
  const COOLDOWN_SECONDS = 30;
  const BATCH = 60;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const storage = (area) => ({
    get(key) { try { return area().getItem(key); } catch { return null; } },
    set(key, val) { try { area().setItem(key, val); } catch { /* ignore */ } },
    remove(key) { try { area().removeItem(key); } catch { /* ignore */ } },
  });
  const store = storage(() => sessionStorage);
  const local = storage(() => localStorage);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* ======================================================================
     THEME (dark / light)
     ====================================================================== */
  const root = document.documentElement;
  const themeToggles = $$("[data-theme-toggle]");
  const themeMeta = $('meta[name="theme-color"]');
  const systemDark = matchMedia("(prefers-color-scheme: dark)");

  const currentTheme = () => (root.dataset.theme === "light" ? "light" : "dark");

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const next = theme === "dark" ? "light" : "dark";
    themeToggles.forEach((btn) => {
      btn.setAttribute("aria-label", `Switch to ${next} mode`);
      btn.title = `Switch to ${next} mode`;
    });
    themeMeta?.setAttribute("content", theme === "dark" ? "#040a1a" : "#eaf1fc");
  }

  function setTheme(theme, origin) {
    local.set(THEME_KEY, theme);
    if (!document.startViewTransition || reducedMotion.matches || !origin) {
      root.classList.add("theme-anim");
      applyTheme(theme);
      setTimeout(() => root.classList.remove("theme-anim"), 600);
      return;
    }
    // Circular reveal that grows out of the toggle button.
    const rect = origin.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(() => applyTheme(theme));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(.2, .8, .2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => { /* transition skipped */ });
  }

  themeToggles.forEach((btn) => btn.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark", btn);
  }));
  systemDark.addEventListener("change", (e) => {
    if (!local.get(THEME_KEY)) applyTheme(e.matches ? "dark" : "light");
  });
  applyTheme(currentTheme());

  /* ======================================================================
     SHA-256 (sync, works on file:// where crypto.subtle is unavailable)
     ====================================================================== */
  function sha256(message) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const bytes = new TextEncoder().encode(message);
    const bitLen = bytes.length * 8;
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLen >>> 0);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const T1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const T2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + T1) | 0;
        d = c; c = b; b = a; a = (T1 + T2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  /* ======================================================================
     ICONS
     ====================================================================== */
  const ICONS = {
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    yen: '<path d="m6 3 6 8 6-8M12 11v10M7 12h10M7 16h10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  };
  const icon = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  /* ======================================================================
     LOCK SCREEN
     ====================================================================== */
  const lock = $("#lock");
  const lockForm = $("#lock-form");
  const pin = $("#pin");
  const pinInput = $("#pin-input");
  const pinCellsWrap = $("#pin-cells");
  const lockStatus = $("#lock-status");
  const lockSubmit = $("#lock-submit");
  const revealBtn = $("#pin-reveal");
  const app = $("#app");

  /* ---------- Lock illustration: each digit is engraved onto the lock as it is typed ---------- */
  const art = $("#lockart");
  const SLOT_X = [116, 158, 200, 242, 284];
  const SLOT_Y = [392, 424, 456];
  const artSlots = [];
  // Digits are kept in memory only; they are put into the SVG solely while "Show" is on.
  const slotDigits = [];

  (function buildLockArt() {
    const svgNS = "http://www.w3.org/2000/svg";
    const slotsGroup = $(".lockart__slots", art);
    for (let i = 0; i < PIN_LENGTH; i++) {
      const slot = document.createElementNS(svgNS, "g");
      slot.setAttribute("class", "lockart__slot");
      slot.setAttribute("transform", `translate(${SLOT_X[i % 5]} ${SLOT_Y[Math.floor(i / 5)]})`);
      slot.style.setProperty("--i", i);
      slot.innerHTML = '<rect x="-17" y="-13" width="34" height="26" rx="6"/><path class="lockart__gem" d="M0 -7 L6 0 L0 7 L-6 0 Z"/><text class="lockart__digit" x="0" y="1"></text><circle class="lockart__spark" r="2.6"/>';
      slotsGroup.append(slot);
      artSlots.push(slot);
    }
    $(".lockart__ticks", art).innerHTML = Array.from({ length: 60 }, (_, k) =>
      `<line class="${k % 5 ? "" : "is-major"}" x1="200" y1="254" x2="200" y2="${k % 5 ? 259 : 262}" transform="rotate(${k * 6} 200 300)"/>`).join("");
  })();

  function renderArt(value) {
    const len = value.length;
    const revealed = art.classList.contains("is-revealed");
    let wrote = 0;
    artSlots.forEach((slot, i) => {
      const digit = slot.querySelector("text");
      if (i < len) {
        if (slotDigits[i] !== value[i]) {
          slotDigits[i] = value[i];
          digit.textContent = revealed ? value[i] : "";
          // Several entries at once (paste) are engraved one after another.
          slot.style.setProperty("--w-delay", `${wrote * 70}ms`);
          slot.classList.remove("is-writing");
          slot.getBoundingClientRect();
          slot.classList.add("is-filled", "is-writing");
          wrote++;
        }
      } else if (slotDigits[i] !== undefined) {
        slotDigits[i] = undefined;
        slot.classList.remove("is-filled", "is-writing");
        digit.textContent = "";
      }
      slot.classList.toggle("is-next", i === len);
    });
    if (wrote) {
      art.classList.remove("is-writing");
      art.getBoundingClientRect();
      art.classList.add("is-writing");
    }
    const next = Math.min(len, PIN_LENGTH - 1);
    art.style.setProperty("--pen-x", `${SLOT_X[next % 5] + 10}px`);
    art.style.setProperty("--pen-y", `${SLOT_Y[Math.floor(next / 5)] + 9}px`);
    art.style.setProperty("--dial", `${len * 24}deg`);
    art.style.setProperty("--p", (len / PIN_LENGTH).toFixed(3));
    art.classList.toggle("is-complete", len === PIN_LENGTH);
  }

  function setArtRevealed(on) {
    art.classList.toggle("is-revealed", on);
    artSlots.forEach((slot, i) => {
      slot.querySelector("text").textContent = on && slotDigits[i] !== undefined ? slotDigits[i] : "";
    });
  }

  let attempts = 0;
  let cooldownTimer = null;
  let busy = false;
  let lockHideTimer = null;

  const cells = [];
  for (let i = 0; i < PIN_LENGTH; i++) {
    if (i > 0 && i % 5 === 0) {
      const sep = document.createElement("span");
      sep.className = "pin__sep";
      pinCellsWrap.append(sep);
    }
    if (i % 5 === 0) {
      const group = document.createElement("span");
      group.className = "pin__group";
      pinCellsWrap.append(group);
    }
    const cell = document.createElement("span");
    cell.className = "pin__cell";
    cell.innerHTML = '<span class="pin__digit"></span>';
    pinCellsWrap.lastElementChild.append(cell);
    cells.push(cell);
  }

  function setLockState(state) {
    lock.classList.toggle("is-error", state === "error");
    lock.classList.toggle("is-success", state === "success");
  }

  function renderPin() {
    const value = pinInput.value;
    cells.forEach((cell, i) => {
      cell.classList.toggle("is-filled", i < value.length);
      cell.classList.toggle("is-active", i === Math.min(value.length, PIN_LENGTH - 1));
      cell.firstChild.textContent = value[i] ?? "";
    });
    renderArt(value);
    if (!cooldownTimer && !lock.classList.contains("is-error") && !lock.classList.contains("is-success")) {
      lockStatus.textContent = `${value.length} / ${PIN_LENGTH}`;
    }
    lockSubmit.disabled = value.length !== PIN_LENGTH || !!cooldownTimer || busy;
  }

  function setPin(value) {
    if (cooldownTimer || busy) return;
    const next = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (lock.classList.contains("is-error")) setLockState(null);
    pinInput.value = next;
    renderPin();
    if (next.length === PIN_LENGTH) verify();
  }

  function pressKey(key) {
    if (key === "back") setPin(pinInput.value.slice(0, -1));
    else if (key === "clear") setPin("");
    else setPin(pinInput.value + key);
  }

  function flashKey(key) {
    const btn = $(`.key[data-key="${key}"]`);
    if (!btn) return;
    btn.classList.add("is-pressed");
    setTimeout(() => btn.classList.remove("is-pressed"), 120);
  }

  function verify() {
    if (busy || pinInput.value.length !== PIN_LENGTH) return;
    busy = true;
    renderPin();
    const ok = sha256(pinInput.value) === PIN_HASH;
    if (ok) {
      setLockState("success");
      lockStatus.textContent = "Unlocked";
      store.set(SESSION_KEY, "1");
      // Leave time for the shackle to spring open before the lock screen fades.
      setTimeout(unlock, 1000);
    } else {
      attempts++;
      setLockState("error");
      lockForm.classList.remove("is-shaking");
      void lockForm.offsetWidth;
      lockForm.classList.add("is-shaking");
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      const left = MAX_ATTEMPTS - attempts;
      lockStatus.textContent = left > 0
        ? `Incorrect code · ${left} ${left === 1 ? "try" : "tries"} left`
        : "Incorrect code";
      setTimeout(() => {
        busy = false;
        pinInput.value = "";
        if (attempts >= MAX_ATTEMPTS) startCooldown();
        else renderPin();
        pinInput.focus({ preventScroll: true });
      }, 700);
    }
  }

  function startCooldown() {
    let remaining = COOLDOWN_SECONDS;
    const tick = () => {
      lockStatus.textContent = `Too many attempts · wait ${remaining}s`;
      if (remaining-- <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        attempts = 0;
        setLockState(null);
        $$(".key", lock).forEach((k) => (k.disabled = false));
        renderPin();
      }
    };
    $$(".key", lock).forEach((k) => (k.disabled = true));
    cooldownTimer = setInterval(tick, 1000);
    tick();
    renderPin();
  }

  function unlock() {
    busy = false;
    lock.classList.add("is-unlocked");
    // Once faded out, take the lock screen out of rendering so its animations stop costing frames.
    clearTimeout(lockHideTimer);
    lockHideTimer = setTimeout(() => { lock.hidden = true; }, lock.classList.contains("is-instant") ? 0 : 900);
    document.body.classList.remove("is-locked");
    app.inert = false;
    pinInput.blur();
    // Let the lock screen start fading before the page content animates in.
    setTimeout(startReveals, lock.classList.contains("is-instant") ? 0 : 280);
    loadData();
  }

  function relock() {
    store.remove(SESSION_KEY);
    closeModal(true);
    pinInput.value = "";
    setLockState(null);
    renderPin();
    app.inert = true;
    document.body.classList.add("is-locked");
    clearTimeout(lockHideTimer);
    lock.hidden = false;
    lock.getBoundingClientRect(); // commit display before the fade-in transition
    lock.classList.remove("is-unlocked", "is-instant");
    setTimeout(() => pinInput.focus({ preventScroll: true }), 50);
  }

  pinInput.addEventListener("input", () => setPin(pinInput.value));
  pinInput.addEventListener("focus", () => pin.classList.add("is-focused"));
  pinInput.addEventListener("blur", () => pin.classList.remove("is-focused"));
  lockForm.addEventListener("submit", (e) => { e.preventDefault(); verify(); });

  $("#keypad").addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn || btn.disabled) return;
    pressKey(btn.dataset.key);
  });

  // Physical keyboard support even when the hidden input isn't focused.
  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("is-locked") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement === pinInput) {
      if (/^\d$/.test(e.key)) flashKey(e.key);
      else if (e.key === "Backspace") flashKey("back");
      return;
    }
    if (/^\d$/.test(e.key)) { e.preventDefault(); flashKey(e.key); pressKey(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); flashKey("back"); pressKey("back"); }
    else if (e.key === "Escape") { pressKey("clear"); }
  });
  document.addEventListener("paste", (e) => {
    if (!document.body.classList.contains("is-locked") || document.activeElement === pinInput) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (text) { e.preventDefault(); setPin(text); }
  });

  revealBtn.addEventListener("click", () => {
    const on = !pin.classList.contains("is-revealed");
    pin.classList.toggle("is-revealed", on);
    setArtRevealed(on);
    revealBtn.setAttribute("aria-pressed", String(on));
    revealBtn.querySelector("span").textContent = on ? "Hide" : "Show";
  });

  // Clock
  const timeEl = $("#lock-time");
  const dateEl = $("#lock-date");
  function tickClock() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    dateEl.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ======================================================================
     REVEAL ON SCROLL
     ====================================================================== */
  let revealObserver = null;
  function startReveals() {
    if (revealObserver) return;
    const targets = $$("[data-reveal]", app);
    if (!("IntersectionObserver" in window) || reducedMotion.matches) {
      targets.forEach((el) => el.classList.add("is-in"));
      runStats();
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
        if (entry.target.id === "stats") runStats();
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    targets.forEach((el) => revealObserver.observe(el));
  }

  /* ======================================================================
     DATA
     ====================================================================== */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
  }

  const nfkc = (s) => (s || "").normalize("NFKC");

  const ERAS = { 明治: 1867, 大正: 1911, 昭和: 1925, 平成: 1988, 令和: 2018 };
  function parseYear(s) {
    s = nfkc(s);
    const western = s.match(/(1[6-9]\d{2}|20\d{2})/);
    if (western) return +western[1];
    const era = s.match(/(明治|大正|昭和|平成|令和)\s*(\d+|元)\s*年/);
    if (era) return ERAS[era[1]] + (era[2] === "元" ? 1 : +era[2]);
    return null;
  }

  function parseEmployees(s) {
    const m = nfkc(s).replace(/(\d),(?=\d{3})/g, "$1").match(/\d+/);
    return m ? +m[0] : null;
  }

  const UNITS = { 兆: 1e12, 億: 1e8, 千万: 1e7, 百万: 1e6, 万: 1e4, 千: 1e3 };
  function parseCapital(s) {
    s = nfkc(s).replace(/(\d),(?=\d{3})/g, "$1").split(/[（(※]/)[0];
    let total = 0, found = false;
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(兆|億|千万|百万|万|千)?/g)) {
      found = true;
      if (!m[2]) { total += +m[1]; break; }
      total += +m[1] * UNITS[m[2]];
    }
    return found && total > 0 ? total : null;
  }

  const LEGAL_FORMS = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|社会福祉法人|医療法人(?:社団|財団)?|学校法人|独立行政法人|国立研究開発法人|特定非営利活動法人|\(株\)|（株）|㈱/g;
  function initialOf(name) {
    const base = nfkc(name).replace(/【.*?】|\[.*?\]|\(.*?\)|（.*?）/g, "").replace(LEGAL_FORMS, "").trim();
    const ch = [...(base || name)].find((c) => /[\p{L}\p{N}]/u.test(c)) || "?";
    return ch.toUpperCase();
  }

  // Name without 【…】/(…) annotations, used for external searches.
  function baseNameOf(name) {
    return nfkc(name).replace(/【.*?】|\[.*?\]|\(.*?\)/g, " ").replace(/\s+/g, " ").trim() || name;
  }

  // Groups listings of the same company (branches, departments, registration pages).
  function groupKeyOf(name) {
    const core = baseNameOf(name).replace(LEGAL_FORMS, " ").trim().split(" ")[0] || "";
    return core.length >= 2 ? core.toLowerCase() : "";
  }

  function hueOf(str) {
    let h = 0;
    for (const c of str) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return h % 360;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  }

  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch { return ""; }
  }

  const fmtInt = new Intl.NumberFormat("en-US");
  function formatCapital(yen) {
    if (yen == null) return "";
    if (yen >= 1e10) return `${fmtInt.format(Math.round(yen / 1e8))}億円`;
    if (yen >= 1e8) return `${+(yen / 1e8).toFixed(1)}億円`;
    if (yen >= 1e4) return `${fmtInt.format(Math.round(yen / 1e4))}万円`;
    return `${fmtInt.format(yen)}円`;
  }
  function formatEmployees(n) {
    if (n == null) return "";
    return n >= 10000 ? `${+(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : fmtInt.format(n);
  }

  function normalise(raw, index) {
    const name = raw.company_name || "Unnamed company";
    const website = safeUrl(raw.website);
    return {
      index,
      id: raw.type_url || name,
      name,
      website,
      host: hostOf(website),
      representative: raw.representative || "",
      employees: raw.employees || "",
      founded: raw.founded || "",
      capital: raw.capital || "",
      typeUrl: safeUrl(raw.type_url),
      year: parseYear(raw.founded),
      employeeCount: parseEmployees(raw.employees),
      capitalYen: parseCapital(raw.capital),
      initial: initialOf(name),
      // Logo tiles stay within the blue–indigo range of the modal design.
      tileHue: 205 + (hueOf(name) % 45),
      groupKey: groupKeyOf(name),
      searchName: baseNameOf(name),
      haystack: nfkc(`${name} ${raw.representative} ${hostOf(website)}`).toLowerCase(),
    };
  }

  /* ======================================================================
     LIST
     ====================================================================== */
  const grid = $("#grid");
  const loader = $("#loader");
  const emptyState = $("#empty");
  const dataError = $("#data-error");
  const resultCount = $("#result-count");
  const searchInput = $("#search");
  const sortSelect = $("#sort");
  const webFilter = $("#filter-web");
  const sentinel = $("#sentinel");

  let companies = [];
  let related = new Map();
  let view = [];
  let rendered = 0;
  let query = "";
  let dataLoaded = false;

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function highlight(text) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const normText = nfkc(text).toLowerCase();
    // Only highlight when normalisation keeps positions aligned.
    if (normText.length !== text.length) return safe;
    const at = normText.indexOf(query);
    if (at < 0) return safe;
    return escapeHtml(text.slice(0, at)) + "<mark>" + escapeHtml(text.slice(at, at + query.length)) + "</mark>" + escapeHtml(text.slice(at + query.length));
  }

  const logoTile = (c, extraClass = "") =>
    `<span class="logo-tile ${extraClass}" style="--h:${c.tileHue}" aria-hidden="true"><span>${escapeHtml(c.initial)}</span></span>`;

  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  const nullsLast = (a, b, cmp) => (a == null) - (b == null) || (a == null ? 0 : cmp(a, b));
  const SORTS = {
    default: (a, b) => a.index - b.index,
    name: (a, b) => collator.compare(a.name, b.name),
    "founded-asc": (a, b) => nullsLast(a.year, b.year, (x, y) => x - y) || a.index - b.index,
    "founded-desc": (a, b) => nullsLast(a.year, b.year, (x, y) => y - x) || a.index - b.index,
    "employees-desc": (a, b) => nullsLast(a.employeeCount, b.employeeCount, (x, y) => y - x) || a.index - b.index,
    "capital-desc": (a, b) => nullsLast(a.capitalYen, b.capitalYen, (x, y) => y - x) || a.index - b.index,
  };

  function applyFilters() {
    query = nfkc(searchInput.value).trim().toLowerCase();
    const onlyWeb = webFilter.checked;
    view = companies
      .filter((c) => (!query || c.haystack.includes(query)) && (!onlyWeb || c.website))
      .sort(SORTS[sortSelect.value] || SORTS.default);

    grid.replaceChildren();
    rendered = 0;
    renderMore();

    const total = companies.length;
    resultCount.textContent = view.length === total
      ? `${fmtInt.format(total)} companies`
      : `${fmtInt.format(view.length)} of ${fmtInt.format(total)} companies`;
    emptyState.hidden = view.length > 0 || !dataLoaded;
  }

  /* ---------- Per-card color (radio buttons + reset) ---------- */
  const TINT_KEY = "kaisha-index:card-tints";
  const TINTS = [
    { value: "yellow", label: "Yellow" },
    { value: "green", label: "Grass green" },
  ];
  // Keyed by the company's type.jp URL so a card keeps its color through filtering, sorting and reloads.
  const cardTints = new Map();
  try {
    for (const [id, tint] of Object.entries(JSON.parse(local.get(TINT_KEY) || "{}"))) {
      if (TINTS.some((t) => t.value === tint)) cardTints.set(id, tint);
    }
  } catch { /* ignore malformed storage */ }

  function cardFact(iconName, label, value) {
    return `
      <div class="card__fact">
        <dt>${icon(iconName, 12)}${label}</dt>
        <dd class="${value ? "" : "is-empty"}">${value ? escapeHtml(value) : "—"}</dd>
      </div>`;
  }

  function tintControls(c, tint) {
    const group = `card-tint-${c.index}`;
    return `
      <fieldset class="card-tint">
        <legend class="sr-only">Card color: ${escapeHtml(c.name)}</legend>
        <div class="card-tint__group">
          ${TINTS.map((t) => `
            <label class="card-tint__option">
              <input type="radio" name="${group}" value="${t.value}"${tint === t.value ? " checked" : ""}>
              <span class="swatch swatch--${t.value}" aria-hidden="true"></span>
              <span>${t.label}</span>
            </label>`).join("")}
        </div>
        <button class="card-tint__reset" type="button" aria-label="Reset card color" title="Reset color" aria-disabled="${tint ? "false" : "true"}">${icon("reset", 14)}</button>
      </fieldset>`;
  }

  function renderMore() {
    const slice = view.slice(rendered, rendered + BATCH);
    const frag = document.createDocumentFragment();
    slice.forEach((c, i) => {
      const li = document.createElement("li");
      const tint = cardTints.get(c.id) || "";
      const sub = c.host
        ? `${icon("globe", 13)}<span>${highlight(c.host)}</span>`
        : c.representative ? `${icon("user", 13)}<span>${highlight(c.representative)}</span>` : "&nbsp;";
      li.innerHTML = `
        <article class="card" data-id="${escapeHtml(c.id)}"${tint ? ` data-tint="${tint}"` : ""} style="animation-delay:${Math.min(i, 20) * 30}ms">
          <button class="card__open" type="button" data-pos="${rendered + i}" aria-label="${escapeHtml(c.name)}"></button>
          <div class="card__top">
            ${logoTile(c)}
            <div class="card__title">
              <h3 class="card__name">${highlight(c.name)}</h3>
              <p class="card__host">${sub}</p>
            </div>
            <span class="card__arrow" aria-hidden="true">${icon("arrowUpRight", 16)}</span>
          </div>
          <dl class="card__facts">
            ${cardFact("calendar", "Founded", c.year ? String(c.year) : "")}
            ${cardFact("users", "Staff", formatEmployees(c.employeeCount))}
            ${cardFact("yen", "Capital", formatCapital(c.capitalYen))}
          </dl>
          ${tintControls(c, tint)}
        </article>`;
      frag.append(li);
    });
    grid.append(frag);
    rendered += slice.length;
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && rendered < view.length) renderMore();
  }, { rootMargin: "800px 0px" }).observe(sentinel);

  grid.addEventListener("click", (e) => {
    const open = e.target.closest(".card__open");
    if (open) openModal(+open.dataset.pos, open);
  });

  // Spotlight that follows the pointer across a card.
  let spotFrame = 0;
  grid.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".card");
    if (!card || spotFrame) return;
    const { clientX, clientY } = e;
    spotFrame = requestAnimationFrame(() => {
      spotFrame = 0;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${clientX - r.left}px`);
      card.style.setProperty("--my", `${clientY - r.top}px`);
    });
  });

  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 120);
  });
  sortSelect.addEventListener("change", applyFilters);
  webFilter.addEventListener("change", applyFilters);
  $("#clear-filters").addEventListener("click", () => {
    searchInput.value = "";
    webFilter.checked = false;
    sortSelect.value = "default";
    applyFilters();
    searchInput.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || document.body.classList.contains("is-locked") || modal.open) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    searchInput.focus();
  });

  /* ---------- Stats (count-up once visible) ---------- */
  let statTargets = null;
  let statsRan = false;

  function countUp(el, to, { from = 0, duration = 1500, format = (n) => fmtInt.format(Math.round(n)), suffix = "" } = {}) {
    if (reducedMotion.matches) { el.textContent = format(to) + suffix; return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = format(from + (to - from) * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function updateStats() {
    const years = companies.map((c) => c.year).filter(Boolean).sort((a, b) => a - b);
    const withWeb = companies.filter((c) => c.website).length;
    statTargets = {
      total: companies.length,
      web: companies.length ? Math.round((withWeb / companies.length) * 100) : 0,
      median: years.length ? years[Math.floor(years.length / 2)] : null,
      oldest: years.length ? years[0] : null,
    };
    runStats();
  }

  function runStats() {
    const statsEl = $("#stats");
    if (!statTargets || statsRan || !statsEl.classList.contains("is-in")) return;
    statsRan = true;
    const year = (n) => String(Math.round(n));
    countUp($("#stat-total"), statTargets.total);
    countUp($("#orbit-count"), statTargets.total, { duration: 1800 });
    countUp($("#stat-web"), statTargets.web, { suffix: "%" });
    $("#stat-web-bar").style.setProperty("--p", `${statTargets.web}%`);
    if (statTargets.median) countUp($("#stat-year"), statTargets.median, { from: statTargets.median - 80, format: year });
    if (statTargets.oldest) countUp($("#stat-oldest"), statTargets.oldest, { from: statTargets.oldest - 80, format: year });
  }

  /* ---------- Hero orbit ---------- */
  function renderOrbit() {
    const pool = companies.filter((c) => c.website);
    if (!pool.length) return;
    const pick = (n, offset) => Array.from({ length: n }, (_, i) => pool[Math.floor(((i + offset) / n) * pool.length) % pool.length]);
    const chip = (c, angle) => `
      <button class="orbit__chip" type="button" tabindex="-1" data-index="${c.index}" style="--a0:${angle}deg">
        <span class="orbit__chip-inner">
          ${logoTile(c)}
          <span class="orbit__label">${escapeHtml(c.searchName)}</span>
        </span>
      </button>`;
    $("#orbit-outer").innerHTML = pick(6, 0).map((c, i) => chip(c, i * 60)).join("");
    $("#orbit-inner").innerHTML = pick(3, 0.5).map((c, i) => chip(c, 30 + i * 120)).join("");
  }

  $(".orbit").addEventListener("click", (e) => {
    const chip = e.target.closest(".orbit__chip");
    if (chip) openCompany(+chip.dataset.index);
  });

  function ingest(text) {
    companies = parseCSV(text).map(normalise);
    related = new Map();
    for (const c of companies) {
      if (!c.groupKey) continue;
      if (!related.has(c.groupKey)) related.set(c.groupKey, []);
      related.get(c.groupKey).push(c);
    }
    dataLoaded = true;
    loader.hidden = true;
    dataError.hidden = true;
    applyFilters();
    renderOrbit();
    updateStats();
  }

  async function loadData() {
    if (dataLoaded) return;
    try {
      const res = await fetch("companies.csv", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ingest(await res.text());
    } catch (err) {
      console.warn("Could not fetch companies.csv:", err);
      loader.hidden = true;
      dataError.hidden = false;
      resultCount.textContent = "No data loaded";
    }
  }

  $("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) ingest(await file.text());
  });

  /* ======================================================================
     CARD COLOR (per-company radio buttons + reset)
     ====================================================================== */
  function setCardTint(card, tint) {
    const id = card.dataset.id;
    if (tint) {
      cardTints.set(id, tint);
      card.dataset.tint = tint;
    } else {
      cardTints.delete(id);
      delete card.dataset.tint;
      $$('.card-tint input[type="radio"]', card).forEach((r) => (r.checked = false));
    }
    $(".card-tint__reset", card).setAttribute("aria-disabled", String(!tint));
    local.set(TINT_KEY, JSON.stringify(Object.fromEntries(cardTints)));
    if (!reducedMotion.matches) {
      card.animate([{ scale: "1" }, { scale: "1.018" }, { scale: "1" }], { duration: 450, easing: "cubic-bezier(.34, 1.56, .64, 1)" });
    }
  }

  grid.addEventListener("change", (e) => {
    const radio = e.target.closest('.card-tint input[type="radio"]');
    if (radio?.checked) setCardTint(radio.closest(".card"), radio.value);
  });

  grid.addEventListener("click", (e) => {
    const reset = e.target.closest(".card-tint__reset");
    if (!reset || reset.getAttribute("aria-disabled") === "true") return;
    setCardTint(reset.closest(".card"), null);
    if (!reducedMotion.matches) {
      reset.querySelector("svg").animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-360deg)" }], { duration: 650, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
    toast("Card color reset");
  });

  /* ======================================================================
     MODAL
     ====================================================================== */
  const modal = $("#modal");
  const modalFacts = $("#modal-facts");
  const modalPrev = $("#modal-prev");
  const modalNext = $("#modal-next");
  const modalBody = $("#modal-body");
  const modalRelated = $("#modal-related");
  const relatedCount = $("#tab-related-count");
  const tabs = $$('#modal [role="tab"]');
  let modalPos = -1;
  let returnFocus = null;
  const modalFx = $("#modal-fx");
  let openFxTimer = 0;
  const SPARK_COLORS = ["#ffe08a", "#ffd166", "#62b6ff", "#9ad0ff", "#ffffff", "#8b7bff"];

  // Where the dialog launches from (and returns to): the card, or the screen centre.
  // Offsets are layout-based so a running animation doesn't skew the measurement.
  function setLaunchOrigin(source) {
    const mx = modal.offsetLeft + modal.offsetWidth / 2;
    const my = modal.offsetTop + modal.offsetHeight / 2;
    const el = source?.isConnected ? (source.closest(".card") || source) : null;
    const r = el?.getBoundingClientRect();
    const visible = r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
    const fx = visible ? r.left + r.width / 2 : innerWidth / 2;
    const fy = visible ? r.top + r.height / 2 : innerHeight / 2;
    const scale = visible ? Math.min(.6, Math.max(.15, r.width / modal.offsetWidth)) : .6;
    modal.style.setProperty("--from-x", `${(fx - mx).toFixed(1)}px`);
    modal.style.setProperty("--from-y", `${(fy - my).toFixed(1)}px`);
    modal.style.setProperty("--from-scale", scale.toFixed(3));
  }

  function playOpenEffects(source) {
    setLaunchOrigin(source);
    clearTimeout(openFxTimer);
    modal.classList.remove("is-opening");
    void modal.offsetWidth;
    if (reducedMotion.matches) { modalFx.replaceChildren(); return; }

    // Measured before the launch animation starts, so the rect is untransformed.
    const panel = modal.getBoundingClientRect();
    const logo = $("#modal-avatar").getBoundingClientRect();
    const cx = (logo.left + logo.width / 2 - panel.left).toFixed(1);
    const cy = (logo.top + logo.height / 2 - panel.top).toFixed(1);
    const parts = [
      `<span class="modal__burst" style="left:${cx}px;top:${cy}px"></span>`,
      `<span class="modal__ring" style="left:${cx}px;top:${cy}px"></span>`,
    ];
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + Math.random() * .35;
      const dist = 80 + Math.random() * 160;
      parts.push(`<span class="modal__spark" style="left:${cx}px;top:${cy}px;--tx:${(Math.cos(angle) * dist).toFixed(1)}px;--ty:${(Math.sin(angle) * dist).toFixed(1)}px;--s:${(3 + Math.random() * 4).toFixed(1)}px;--c:${SPARK_COLORS[i % SPARK_COLORS.length]};--dur:${(.75 + Math.random() * .5).toFixed(2)}s;--delay:${(.14 + Math.random() * .16).toFixed(2)}s"></span>`);
    }
    modalFx.innerHTML = parts.join("");
    modal.classList.add("is-opening");
    openFxTimer = setTimeout(() => {
      modal.classList.remove("is-opening");
      modalFx.replaceChildren();
    }, 1800);
  }

  function factRow(iconName, label, value, { href, copy = true } = {}) {
    const has = Boolean(value);
    const content = !has
      ? "記載なし"
      : href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}${icon("external", 16)}</a>`
        : escapeHtml(value);
    return `
      <div class="fact">
        <span class="fact__icon">${icon(iconName, 22)}</span>
        <dt>${label}</dt>
        <dd class="${has ? "" : "is-empty"}">
          <span class="fact__value">${content}</span>
          ${has && copy ? `<button class="copy" type="button" data-copy="${escapeHtml(value)}" aria-label="${label}をコピー">${icon("copy", 16)}</button>` : ""}
        </dd>
      </div>`;
  }

  function setTab(name) {
    tabs.forEach((tab) => {
      const on = tab.id === `tab-${name}`;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#${tab.getAttribute("aria-controls")}`).hidden = !on;
    });
    modalBody.scrollTop = 0;
  }

  function renderRelated(c) {
    const siblings = (related.get(c.groupKey) || []).filter((o) => o !== c);
    relatedCount.hidden = siblings.length === 0;
    relatedCount.textContent = siblings.length;

    const q = encodeURIComponent(c.searchName);
    const links = [
      { label: "Google で検索", href: `https://www.google.com/search?q=${q}`, icon: "search" },
      { label: "Google マップ", href: `https://www.google.com/maps/search/?api=1&query=${q}`, icon: "pin" },
      { label: "ニュースを探す", href: `https://news.google.com/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`, icon: "news" },
    ];

    const list = siblings.length
      ? `<ul class="related__list">${siblings.map((o) => `
          <li><button class="related__item" type="button" data-index="${o.index}">
            ${logoTile(o, "related__mark")}
            <span class="related__name">${escapeHtml(o.name)}</span>
            <span class="related__meta">${o.year ? `${o.year}年設立` : ""}</span>
            ${icon("chevron", 16)}
          </button></li>`).join("")}</ul>`
      : `<p class="related__empty">type.jp に同じ企業の他の掲載は見つかりませんでした。</p>`;

    modalRelated.innerHTML = `
      <section class="related__section">
        <h3 class="related__title">${icon("layers", 18)}同じ企業の他の掲載</h3>
        <p class="related__lead">事業部・支店ごとの掲載や登録ページをまとめて表示します。</p>
        ${list}
      </section>
      <section class="related__section">
        <h3 class="related__title">${icon("search", 18)}外部で調べる</h3>
        <p class="related__lead">「${escapeHtml(c.searchName)}」を外部サイトで検索します。</p>
        <div class="related__links">${links.map((l) => `
          <a class="related__link" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer">${icon(l.icon, 18)}<span>${l.label}</span>${icon("external", 15)}</a>`).join("")}
        </div>
      </section>`;
  }

  function fillModal(pos) {
    const c = view[pos];
    if (!c) return;
    modalPos = pos;

    const avatar = $("#modal-avatar");
    avatar.innerHTML = `<span>${escapeHtml(c.initial)}</span>`;
    avatar.style.setProperty("--h", c.tileHue);
    $("#modal-index").textContent = `${fmtInt.format(pos + 1)} / ${fmtInt.format(view.length)}`;
    $("#modal-name").textContent = c.name;

    const inlineSite = $("#modal-site-inline");
    inlineSite.hidden = !c.website;
    $("#modal-site-host").textContent = c.host;
    if (c.website) inlineSite.href = c.website; else inlineSite.removeAttribute("href");

    modalFacts.innerHTML = [
      factRow("building", "会社名", c.name),
      factRow("user", "代表者", c.representative),
      factRow("users", "従業員数", c.employees),
      factRow("calendar", "設立", c.founded),
      factRow("yen", "資本金", c.capital),
      factRow("globe", "Webサイト", c.website, { href: c.website }),
      factRow("link", "type.jp プロフィール", c.typeUrl, { href: c.typeUrl }),
    ].join("");
    $$(".fact", modalFacts).forEach((row, i) => row.style.setProperty("--i", i));
    renderRelated(c);
    modalBody.scrollTop = 0;

    const web = $("#modal-web");
    if (c.website) { web.href = c.website; web.removeAttribute("aria-disabled"); web.tabIndex = 0; }
    else { web.removeAttribute("href"); web.setAttribute("aria-disabled", "true"); web.tabIndex = -1; }
    const typeLink = $("#modal-type");
    if (c.typeUrl) typeLink.href = c.typeUrl; else typeLink.removeAttribute("href");

    modalPrev.disabled = pos <= 0;
    modalNext.disabled = pos >= view.length - 1;
  }

  // Slide the new company's content in from the direction of travel.
  function swapAnimation(delta) {
    if (reducedMotion.matches) return;
    modal.style.setProperty("--swap-from", `${delta < 0 ? -16 : 16}px`);
    // Navigating mid-entrance: let the slide take over from the opening choreography.
    clearTimeout(openFxTimer);
    modal.classList.remove("is-opening", "is-swapping");
    modalFx.replaceChildren();
    void modal.offsetWidth;
    modal.classList.add("is-swapping");
  }
  modal.addEventListener("animationend", (e) => {
    if (e.animationName === "swapIn") modal.classList.remove("is-swapping");
  });

  function openModal(pos, trigger) {
    returnFocus = trigger || document.activeElement;
    setTab("info");
    fillModal(pos);
    modal.classList.remove("is-closing", "is-swapping");
    if (!modal.open) {
      modal.showModal();
      playOpenEffects(trigger);
    }
    $("#modal-close").focus({ preventScroll: true });
  }

  function closeModal(immediate = false) {
    if (!modal.open) return;
    const finish = () => {
      modal.classList.remove("is-closing");
      modal.close();
      if (returnFocus && document.contains(returnFocus) && !immediate) returnFocus.focus({ preventScroll: true });
    };
    clearTimeout(openFxTimer);
    modalFx.replaceChildren();
    if (immediate || reducedMotion.matches) {
      modal.classList.remove("is-opening");
      return finish();
    }
    setLaunchOrigin(returnFocus);
    modal.classList.remove("is-opening");
    modal.classList.add("is-closing");
    setTimeout(finish, 300);
  }

  function step(delta) {
    const next = modalPos + delta;
    if (next < 0 || next >= view.length) return;
    // Make sure the card exists in the grid so focus can return to it.
    while (rendered <= next) renderMore();
    fillModal(next);
    swapAnimation(delta);
    returnFocus = grid.querySelector(`.card__open[data-pos="${next}"]`);
  }

  // Opens a company by its CSV index, clearing filters if they hide it.
  function openCompany(index) {
    let pos = view.findIndex((c) => c.index === index);
    if (pos < 0) {
      searchInput.value = "";
      webFilter.checked = false;
      applyFilters();
      pos = view.findIndex((c) => c.index === index);
    }
    if (pos < 0) return;
    while (rendered <= pos) renderMore();
    const card = grid.querySelector(`.card__open[data-pos="${pos}"]`);
    if (modal.open) {
      setTab("info");
      fillModal(pos);
      swapAnimation(1);
      returnFocus = card;
      $("#modal-close").focus();
    } else {
      openModal(pos, card);
    }
  }

  $("#modal-close").addEventListener("click", () => closeModal());
  modalPrev.addEventListener("click", () => step(-1));
  modalNext.addEventListener("click", () => step(1));

  tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.id.replace("tab-", ""))));
  $("#modal .modal__tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    setTab(tabs[next].id.replace("tab-", ""));
  });

  modalRelated.addEventListener("click", (e) => {
    const item = e.target.closest(".related__item");
    if (item) openCompany(+item.dataset.index);
  });
  modal.addEventListener("cancel", (e) => { e.preventDefault(); closeModal(); });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  modal.addEventListener("keydown", (e) => {
    if (e.target.closest('input, select, textarea, [role="tablist"]')) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  });
  modalFacts.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy");
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast("コピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  });

  /* ======================================================================
     MISC
     ====================================================================== */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    // Re-showing the popover moves it to the top of the top layer, above an open modal.
    if (typeof toastEl.showPopover === "function") {
      try { toastEl.hidePopover(); } catch { /* not open */ }
      toastEl.showPopover();
    }
    toastEl.classList.remove("is-visible");
    requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add("is-visible")));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("is-visible");
      toastTimer = setTimeout(() => { try { toastEl.hidePopover?.(); } catch { /* ignore */ } }, 300);
    }, 1800);
  }

  // Top bar state, scroll progress and back-to-top button.
  const topbar = $(".topbar");
  const backtop = $("#backtop");
  let scrollFrame = 0;
  function onScroll() {
    scrollFrame = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    topbar.classList.toggle("is-scrolled", scrollY > 8);
    topbar.style.setProperty("--progress", max > 0 ? Math.min(1, scrollY / max).toFixed(4) : "0");
    const show = scrollY > 900;
    backtop.classList.toggle("is-visible", show);
    backtop.tabIndex = show ? 0 : -1;
    backtop.setAttribute("aria-hidden", String(!show));
  }
  addEventListener("scroll", () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll); }, { passive: true });
  backtop.addEventListener("click", () => scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" }));

  $("#relock").addEventListener("click", relock);

  /* ======================================================================
     BOOT
     ====================================================================== */
  renderPin();
  if (store.get(SESSION_KEY) === "1") {
    lock.classList.add("is-unlocked", "is-instant");
    unlock();
  } else {
    pinInput.focus({ preventScroll: true });
  }
})();
