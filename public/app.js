(() => {
  "use strict";

  const PIN_LENGTH = 15;
  // SHA-256 of the access code (the code itself is not stored in the page).
  const PIN_HASH = "7631ea876468c855728dd063ffff91c185bff5499cb4acf2ec7900b5b3f9dd54";
  const SESSION_KEY = "kaisha-index:unlocked";
  const MAX_ATTEMPTS = 5;
  const COOLDOWN_SECONDS = 30;
  const BATCH = 60;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const store = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { sessionStorage.setItem(key, val); } catch { /* ignore */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
  };

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

  let attempts = 0;
  let cooldownTimer = null;
  let busy = false;

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
      setTimeout(unlock, 520);
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
    document.body.classList.remove("is-locked");
    app.inert = false;
    app.classList.add("is-entering");
    setTimeout(() => app.classList.remove("is-entering"), 1000);
    pinInput.blur();
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
    lock.classList.remove("is-unlocked");
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
      hue: hueOf(name),
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

  function cardFact(label, value) {
    return `<div class="card__fact"><dt>${label}</dt><dd class="${value ? "" : "is-empty"}">${value ? escapeHtml(value) : "—"}</dd></div>`;
  }

  function renderMore() {
    const slice = view.slice(rendered, rendered + BATCH);
    const frag = document.createDocumentFragment();
    slice.forEach((c, i) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <button class="card" type="button" data-pos="${rendered + i}" style="animation-delay:${Math.min(i, 20) * 18}ms">
          <div class="card__top">
            <span class="avatar" style="--h:${c.hue}" aria-hidden="true">${escapeHtml(c.initial)}</span>
            <div class="card__title">
              <h3 class="card__name">${highlight(c.name)}</h3>
              <p class="card__host">${c.host ? highlight(c.host) : c.representative ? highlight(c.representative) : "&nbsp;"}</p>
            </div>
            <span class="card__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
            </span>
          </div>
          <dl class="card__facts">
            ${cardFact("Founded", c.year ? String(c.year) : "")}
            ${cardFact("Staff", formatEmployees(c.employeeCount))}
            ${cardFact("Capital", formatCapital(c.capitalYen))}
          </dl>
        </button>`;
      frag.append(li);
    });
    grid.append(frag);
    rendered += slice.length;
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && rendered < view.length) renderMore();
  }, { rootMargin: "800px 0px" }).observe(sentinel);

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openModal(+card.dataset.pos, card);
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

  function updateStats() {
    const years = companies.map((c) => c.year).filter(Boolean).sort((a, b) => a - b);
    const withWeb = companies.filter((c) => c.website).length;
    $("#stat-total").textContent = fmtInt.format(companies.length);
    $("#stat-web").textContent = companies.length ? `${Math.round((withWeb / companies.length) * 100)}%` : "—";
    $("#stat-year").textContent = years.length ? years[Math.floor(years.length / 2)] : "—";
    $("#stat-oldest").textContent = years.length ? years[0] : "—";
  }

  function ingest(text) {
    companies = parseCSV(text).map(normalise);
    dataLoaded = true;
    loader.hidden = true;
    dataError.hidden = true;
    updateStats();
    applyFilters();
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
     SECTION TINT (radio buttons + reset)
     ====================================================================== */
  const section = $("#companies");
  const tintRadios = $$('input[name="section-color"]');
  const tintReset = $("#tint-reset");

  tintRadios.forEach((radio) => radio.addEventListener("change", () => {
    if (!radio.checked) return;
    section.dataset.tint = radio.value;
    tintReset.disabled = false;
  }));

  tintReset.addEventListener("click", () => {
    tintRadios.forEach((r) => (r.checked = false));
    delete section.dataset.tint;
    tintReset.disabled = true;
    toast("Section color reset");
  });

  /* ======================================================================
     MODAL
     ====================================================================== */
  const modal = $("#modal");
  const modalFacts = $("#modal-facts");
  const modalPrev = $("#modal-prev");
  const modalNext = $("#modal-next");
  let modalPos = -1;
  let returnFocus = null;

  const ICONS = {
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    yen: '<path d="m6 3 6 8 6-8M12 11v10M7 12h10M7 16h10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  };
  const icon = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function factRow(iconName, label, value, { href, copy = true } = {}) {
    const has = Boolean(value);
    const content = !has
      ? "Not listed"
      : href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
        : escapeHtml(value);
    return `
      <div class="fact">
        <span class="fact__icon">${icon(iconName)}</span>
        <dt>${label}</dt>
        <dd class="${has ? "" : "is-empty"}">
          <span class="fact__value">${content}</span>
          ${has && copy ? `<button class="copy" type="button" data-copy="${escapeHtml(value)}" aria-label="Copy ${label}">${icon("copy", 15)}</button>` : ""}
        </dd>
      </div>`;
  }

  function fillModal(pos) {
    const c = view[pos];
    if (!c) return;
    modalPos = pos;

    const avatar = $("#modal-avatar");
    avatar.textContent = c.initial;
    avatar.style.setProperty("--h", c.hue);
    $("#modal-index").textContent = `${fmtInt.format(pos + 1)} / ${fmtInt.format(view.length)}`;
    $("#modal-name").textContent = c.name;

    const inlineSite = $("#modal-site-inline");
    inlineSite.hidden = !c.website;
    inlineSite.textContent = c.host;
    if (c.website) inlineSite.href = c.website; else inlineSite.removeAttribute("href");

    modalFacts.innerHTML = [
      factRow("building", "Company name", c.name),
      factRow("user", "Representative", c.representative),
      factRow("users", "Employees", c.employees),
      factRow("calendar", "Founded", c.founded),
      factRow("yen", "Capital", c.capital),
      factRow("globe", "Website", c.website, { href: c.website }),
      factRow("link", "type.jp profile", c.typeUrl, { href: c.typeUrl }),
    ].join("");
    modalFacts.scrollTop = 0;

    const web = $("#modal-web");
    if (c.website) { web.href = c.website; web.removeAttribute("aria-disabled"); web.tabIndex = 0; }
    else { web.removeAttribute("href"); web.setAttribute("aria-disabled", "true"); web.tabIndex = -1; }
    const typeLink = $("#modal-type");
    if (c.typeUrl) typeLink.href = c.typeUrl; else typeLink.removeAttribute("href");

    modalPrev.disabled = pos <= 0;
    modalNext.disabled = pos >= view.length - 1;
  }

  function openModal(pos, trigger) {
    returnFocus = trigger || document.activeElement;
    fillModal(pos);
    modal.classList.remove("is-closing");
    if (!modal.open) modal.showModal();
    $("#modal-close").focus();
  }

  function closeModal(immediate = false) {
    if (!modal.open) return;
    const finish = () => {
      modal.classList.remove("is-closing");
      modal.close();
      if (returnFocus && document.contains(returnFocus) && !immediate) returnFocus.focus({ preventScroll: true });
    };
    if (immediate || matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    modal.classList.add("is-closing");
    setTimeout(finish, 190);
  }

  function step(delta) {
    const next = modalPos + delta;
    if (next < 0 || next >= view.length) return;
    // Make sure the card exists in the grid so focus can return to it.
    while (rendered <= next) renderMore();
    fillModal(next);
    returnFocus = grid.querySelector(`.card[data-pos="${next}"]`);
  }

  $("#modal-close").addEventListener("click", () => closeModal());
  modalPrev.addEventListener("click", () => step(-1));
  modalNext.addEventListener("click", () => step(1));
  modal.addEventListener("cancel", (e) => { e.preventDefault(); closeModal(); });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  modal.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  });
  modalFacts.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy");
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast("Copied to clipboard");
    } catch {
      toast("Copy isn’t available here");
    }
  });

  /* ======================================================================
     MISC
     ====================================================================== */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 1800);
  }

  const topbar = $(".topbar");
  addEventListener("scroll", () => topbar.classList.toggle("is-scrolled", scrollY > 8), { passive: true });

  $("#relock").addEventListener("click", relock);

  /* ======================================================================
     BOOT
     ====================================================================== */
  renderPin();
  if (store.get(SESSION_KEY) === "1") {
    lock.classList.add("is-unlocked");
    unlock();
  } else {
    pinInput.focus({ preventScroll: true });
  }
})();
