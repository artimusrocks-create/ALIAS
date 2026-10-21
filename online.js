/* ===== ONLINE GAME ROOMS =====
   Teacher creates a game -> gets a code. Players open the link, type the code + name, and land in the game.
   Everyone polls /api/room once a second; only the describer's device receives the word. */
(function () {
  const OL = (window.ONLINE = { active: false, code: null, pid: null, st: null });
  const SAVE = "nf_alias_room_v1";
  let pollT = null, tickT = null, fetchedAt = 0, lastKey = "", busy = false, lifePaused = false;
  const app = document.getElementById("app");
  const $ = (id) => document.getElementById(id);
  const saved = () => { try { return JSON.parse(localStorage.getItem(SAVE) || "null"); } catch (e) { return null; } };
  const store = (o) => { try { o ? localStorage.setItem(SAVE, JSON.stringify(o)) : localStorage.removeItem(SAVE); } catch (e) {} };
  const W = (i) => (typeof i === "number" && ALL[i]) || null;
  const pname = (id) => (OL.st?.players.find((p) => p.id === id) || {}).name || "—";

  async function api(method, body, qs) {
    const r = await fetch("/api/room" + (qs || ""), {
      method, headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error(j.message || j.error || "HTTP " + r.status); e.code = j.error; e.status = r.status; e.data = j; throw e; }
    return j;
  }
  const errText = (e) => ({
    not_found: "Игра с таким кодом не найдена. Проверь код.",
    full: "В игре уже 8 игроков.",
    no_name: "Напиши своё имя.",
    no_store: "Учителю: база игры ещё не подключена в Vercel (Storage → Upstash).",
    need_players: "Нужно минимум 2 игрока.",
  }[e.code] || (e.status === 404 && !e.code ? "Онлайн-игра работает только на сайте (Vercel)." : "Ошибка связи. Попробуй ещё раз."));

  /* ---------- join / create ---------- */
  OL.joinCardHTML = function () {
    const sv = saved();
    const qp = new URLSearchParams(location.search).get("code") || "";
    return `<div class="card join-card">
      <div class="lbl">🌐 Join a game · Войти в игру</div>
      <form class="joinrow" id="joinForm" autocomplete="off">
        <input id="jCode" class="jcode" placeholder="CODE" maxlength="4" value="${esc((qp || "").toUpperCase())}" aria-label="Game code">
        <input id="jName" placeholder="Your name · Имя" maxlength="16" value="${esc(sv?.name || "")}" aria-label="Your name">
        <button class="btn btn-main" type="submit" id="jGo">Join ▶</button>
      </form>
      <div class="jerr" id="jErr"></div>
      ${sv?.code ? `<button class="mini-link" type="button" id="jRe">↩ Back to game ${esc(sv.code)} as ${esc(sv.name || "")}</button>` : ""}
    </div>`;
  };
  OL.wireJoin = function () {
    const f = $("joinForm"); if (!f) return;
    $("jCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const code = $("jCode").value.trim().toUpperCase(), name = $("jName").value.trim();
      if (code.length !== 4) { $("jErr").textContent = "Код — 4 символа."; return; }
      if (!name) { $("jErr").textContent = "Напиши своё имя."; return; }
      $("jGo").disabled = true; $("jErr").textContent = "";
      try { const j = await api("POST", { action: "join", code, name }); enter(code, j.pid, name, j); }
      catch (err) { $("jErr").textContent = errText(err); }
      finally { const g = $("jGo"); if (g) g.disabled = false; }
    };
    const re = $("jRe"); if (re) re.onclick = () => { const sv = saved(); enter(sv.code, sv.pid, sv.name, null); };
  };
  OL.create = async function (name, btn, errEl) {
    const pool = []; ALL.forEach((w, i) => { if (S.cats.includes(w.cat)) pool.push(i); });
    btn.disabled = true; errEl.textContent = "";
    try {
      const j = await api("POST", { action: "create", name, pool, settings: { secs: S.secs, hint: S.hint, clues: S.clues, pauseHelp: S.pauseHelp } });
      enter(j.code, j.pid, name, j);
    } catch (e) { errEl.textContent = errText(e); }
    finally { btn.disabled = false; }
  };

  function enter(code, pid, name, st) {
    OL.active = true; OL.code = code; OL.pid = pid; store({ code, pid, name });
    phase = "online"; stopTimer();
    try { history.replaceState(null, "", "?code=" + code); } catch (e) {}
    if (st) take(st);
    startPolling(); poll();
  }
  OL.leave = function () {
    OL.active = false; OL.st = null; stopPolling(); store(null); closeLife(); lastKey = "";
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    setPhase("setup");
  };

  /* ---------- sync ---------- */
  function startPolling() { stopPolling(); pollT = setInterval(poll, 1000); tickT = setInterval(tick, 250); }
  function stopPolling() { clearInterval(pollT); clearInterval(tickT); pollT = tickT = null; }
  async function poll() {
    if (!OL.active || busy) return;
    try { take(await api("GET", null, `?code=${OL.code}&pid=${OL.pid}`)); }
    catch (e) {
      if (e.code === "not_found") { app.innerHTML = `<div class="card"><div class="intro"><div class="who">Game over</div><div class="role">Игра ${esc(OL.code)} закончилась или код неверный.</div></div><div class="btn-row c"><button class="btn btn-main" id="olLeave">OK</button></div></div>`; $("olLeave").onclick = OL.leave; stopPolling(); }
    }
  }
  async function act(action, extra) {
    busy = true;
    try { take(await api("POST", Object.assign({ action, code: OL.code, pid: OL.pid }, extra || {}))); }
    catch (e) { if (e.data && e.data.v) take(e.data); flash(errText(e)); }
    finally { busy = false; }
  }
  OL.act = act;
  function flash(msg) { const el = $("olMsg"); if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000); } }

  function take(st) {
    if (!st || !st.code) return;
    if (st.me === null && OL.active) { OL.leave(); return; } // removed by the teacher
    OL.st = st; fetchedAt = performance.now();
    const key = [st.v, st.phase, st.describerId, st.turn.word, st.turn.paused].join("|");
    if (key !== lastKey) { lastKey = key; render(); }
    tick();
  }
  const amHost = () => OL.st && OL.st.hostId === OL.pid;
  const amDesc = () => OL.st && OL.st.describerId === OL.pid;
  OL.myWord = () => (OL.active && OL.st && OL.st.phase === "play" && amDesc() ? W(OL.st.turn.word) : null);
  OL.onLife = function (open) {
    const st = OL.st; if (!st || st.phase !== "play" || !amDesc() || !st.settings.pauseHelp) return;
    if (open && !st.turn.paused) { lifePaused = true; act("pause"); }
    if (!open && lifePaused) { lifePaused = false; act("resume"); }
  };
  OL.headers = () => (OL.active ? { "x-room": OL.code, "x-pid": OL.pid } : {});

  function leftMs() {
    const t = OL.st.turn; if (OL.st.phase !== "play") return 0;
    return t.paused ? t.left : Math.max(0, t.left - (performance.now() - fetchedAt));
  }
  function tick() {
    if (!OL.st || OL.st.phase !== "play") return;
    const ms = leftMs(), secs = Math.ceil(ms / 1000), total = OL.st.turn.secs;
    const b = $("bar"), c = $("clock"); if (!b) return;
    b.style.width = Math.min(100, (ms / 1000 / total) * 100) + "%";
    c.innerHTML = fmt(secs) + (OL.st.turn.paused ? '<span class="pz">⏸ Lifeline</span>' : "");
    const low = secs <= 10; b.classList.toggle("low", low); c.classList.toggle("low", low);
    if (ms <= 0 && !OL.st.turn.paused) poll();
  }

  /* ---------- views ---------- */
  function scorebar() {
    const st = OL.st, bar = $("scorebar"), inn = $("scoreIn");
    if (st.phase === "lobby") { bar.classList.remove("show"); return; }
    inn.innerHTML = st.players.map((p, i) => `<div class="sc${p.id === st.describerId ? " active" : ""}"><span class="nm"><span class="dot" style="background:${PCOL[i % PCOL.length]}"></span>${esc(p.name)}${p.id === OL.pid ? " (you)" : ""}</span><span class="val">${st.scores[p.id] || 0}</span>${amHost() ? `<span class="pm"><button data-t="${p.id}" data-d="-1" aria-label="minus">−</button><button data-t="${p.id}" data-d="1" aria-label="plus">+</button></span>` : ""}</div>`).join("")
      + `<span class="rst">🔑 ${esc(st.code)}</span>`;
    inn.querySelectorAll(".pm button").forEach((b) => (b.onclick = () => act("score", { target: b.dataset.t, delta: +b.dataset.d })));
    bar.classList.add("show");
  }
  const banner = (txt, sub) => `<div class="banner"><span class="now">${txt}</span><span class="sub">${sub || ""}</span><span class="rnd">game ${esc(OL.st.code)} · round ${OL.st.round}</span></div>`;
  const msgLine = '<div class="jerr" id="olMsg" style="text-align:center"></div>';

  function lobbyHTML() {
    const st = OL.st, link = location.origin + "/?code=" + st.code;
    return `<div class="card">
      <div class="lobby-code"><div class="lbl" style="justify-content:center">Game code · Код игры</div><div class="bigcode">${esc(st.code)}</div>
        <div class="sharelink"><span id="shareTxt">${esc(link)}</span><button class="tbtn" id="copyLink" type="button">📋 Copy link</button></div></div>
      <div class="lbl">Players · Игроки (${st.players.length})</div>
      <div class="plist">${st.players.map((p, i) => `<div class="pfield"><span class="dot" style="background:${PCOL[i % PCOL.length]}"></span><b>${esc(p.name)}</b>${p.id === st.hostId ? ' <small class="tag">teacher</small>' : ""}${p.id === OL.pid ? ' <small class="tag">you</small>' : ""}${amHost() && p.id !== st.hostId ? `<button class="x" data-rm="${p.id}" aria-label="remove">✕</button>` : ""}</div>`).join("")}</div>
      ${amHost()
        ? `<div class="note"><b>Send the link or the code.</b> Players open the site, type <b>${esc(st.code)}</b> and their name. They appear here automatically. Round: ${st.settings.secs}s · Clues ${st.settings.clues ? "on" : "off"} · Lifeline pauses timer: ${st.settings.pauseHelp ? "yes" : "no"}.</div>
           <div class="btn-row"><button class="btn btn-main btn-block" id="olStart" ${st.players.length < 2 ? "disabled style=\"opacity:.45\"" : ""}>Start the game ▶</button></div>`
        : `<div class="waiting" style="padding:20px 10px"><div class="eye">⏳</div><div class="ws">Ждём, когда учитель начнёт игру…<br>Waiting for the teacher to start.</div></div>`}
      ${msgLine}<div class="btn-row c"><button class="mini-link" id="olLeave" type="button">Leave game</button></div></div>`;
  }
  function introHTML_() {
    const st = OL.st, dn = pname(st.describerId), mine = amDesc();
    const others = st.players.filter((p) => p.id !== st.describerId).map((p) => p.name).join(" & ");
    return `<div class="card">${banner("🎙 " + esc(dn) + " describes", esc(others) + " guess")}
      <div class="intro"><div class="who">${mine ? `<span class="nm">${esc(dn)}</span>, you're up!` : `<span class="nm">${esc(dn)}</span> is next`}</div>
      <div class="role">${mine ? "Describe each word in English — never say the word itself. Stuck? Tap 🛟." : "Get ready to guess! Слушай и угадывай вслух."}</div></div>
      <div class="btn-row c">${mine ? `<button class="btn btn-main" id="olGo">Start ${st.settings.secs}s ▶</button>` : amHost() ? `<button class="btn btn-soft" id="olGo">Start for ${esc(dn)} ▶</button>` : ""}</div>${msgLine}</div>`;
  }
  function playHTML_() {
    const st = OL.st, w = W(st.turn.word), mine = amDesc();
    const timer = `<div class="timer"><div class="track"><div class="bar" id="bar"></div></div><div class="clock" id="clock"></div></div>`;
    if (mine && w) {
      const col = catColor(w.cat);
      return `<div class="card">${banner("🎙 You", "describing")}${timer}
        <div class="play" id="playCard" style="background:var(--${col});border-color:var(--${col}-line)"><div class="cat" style="color:var(--${col}-ink)">${CATS[w.cat].label}</div><div class="word" id="word">${esc(w.en)}</div><div class="ru${S.hint ? "" : " off"}" id="ru">🇷🇺 ${esc(w.ru)}</div></div>
        <div class="clues" id="clues"${st.settings.clues && S.clues !== false ? "" : " hidden"}>${cluesHTML(w)}</div>
        <div class="tools"><button class="tbtn life" id="lifeBtn">🛟 Help with this word</button><button class="tbtn" id="hintBtn">${S.hint ? "🙈 Hide Russian" : "🇷🇺 Show Russian"}</button><button class="tbtn" id="cluesBtn">${S.clues !== false ? "🙈 Hide clues" : "💡 Show clues"}</button><button class="tbtn" id="olEnd">⏹ End turn</button></div>
        <div class="actions"><button class="act act-skip" id="olSkip">⏭ Skip</button><button class="act act-yes" id="olYes">✓ Got it</button></div>
        <div class="counters"><span class="g">✓ <b>${st.turn.gotCount}</b></span><span class="s">⏭ <b>${st.turn.skipCount}</b></span></div>
        <div class="keys">Keyboard: → or Enter = got it · ← = skip · H = help</div>${msgLine}</div>`;
    }
    return `<div class="card">${banner("🙈 " + esc(pname(st.describerId)) + " is describing", "you guess out loud")}${timer}
      <div class="waiting"><div class="eye">🙈</div><div class="wt"><span class="nm">${esc(pname(st.describerId))}</span> is describing…</div><div class="ws">Shout your guesses! Угадывай вслух!</div></div>
      <div class="counters"><span class="g">✓ <b>${st.turn.gotCount}</b> guessed</span><span class="s">⏭ <b>${st.turn.skipCount}</b></span></div>
      ${amHost() ? `<div class="btn-row c">${st.turn.paused ? '<button class="tbtn" id="olResume">▶ Resume timer</button>' : ""}<button class="tbtn" id="olEnd">⏹ End their turn</button></div>` : ""}${msgLine}</div>`;
  }
  function endHTML_() {
    const st = OL.st, dn = pname(st.describerId);
    const next = st.players[(st.dIdx + 1) % st.players.length];
    const got = st.turn.got.map(W).filter(Boolean), sk = st.turn.skipped.map(W).filter(Boolean);
    const empty = '<span style="border:none;background:none;color:var(--muted)">—</span>';
    return `<div class="card"><div class="big">${got.length}</div><div class="bigsub">words guessed for ${esc(dn)} ✓</div>
      <div class="wl-h">✓ Got it</div><div class="wl g">${got.length ? got.map((w) => `<span>${esc(w.en)}<small>${esc(w.ru)}</small></span>`).join("") : empty}</div>
      <div class="wl-h">⏭ Skipped</div><div class="wl s" id="skList">${sk.length ? sk.map((w, i) => `<button type="button" data-sk="${i}">${esc(w.en)}<small>${esc(w.ru)}</small></button>`).join("") : empty}</div>
      ${sk.length ? '<div class="wl-tip">Tap a skipped word to see how you could explain it 🛟</div>' : ""}
      <div class="btn-row"><button class="btn btn-main" id="olNext">Next: ${esc(next ? next.name : "")} ▶</button>${amHost() ? '<button class="btn btn-soft" id="olReset">↺ New game, same players</button>' : ""}</div>${msgLine}</div>`;
  }

  function render() {
    if (!OL.active || !OL.st) return;
    const st = OL.st;
    phase = "online";
    app.innerHTML = { lobby: lobbyHTML, intro: introHTML_, play: playHTML_, end: endHTML_ }[st.phase]();
    scorebar();
    $("modeTag").textContent = "🌐 " + st.code + " · " + (st.me ? st.me.name : "");
    // wiring
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on("olLeave", OL.leave);
    on("olStart", () => act("start"));
    on("olGo", () => act("startTurn"));
    on("olYes", () => act("mark", { ok: true, word: st.turn.word }));
    on("olSkip", () => act("mark", { ok: false, word: st.turn.word }));
    on("olEnd", () => { closeLife(); act("endTurn"); });
    on("olResume", () => act("resume"));
    on("olNext", () => { closeLife(); act("next"); });
    on("olReset", () => act("reset"));
    on("lifeBtn", () => openLife(OL.myWord()));
    on("hintBtn", () => { S.hint = !S.hint; save(); $("ru").classList.toggle("off", !S.hint); $("hintBtn").textContent = S.hint ? "🙈 Hide Russian" : "🇷🇺 Show Russian"; });
    on("cluesBtn", () => { S.clues = !S.clues; save(); $("clues").hidden = !S.clues; $("cluesBtn").textContent = S.clues ? "🙈 Hide clues" : "💡 Show clues"; });
    on("copyLink", () => {
      const txt = $("shareTxt").textContent;
      const done = () => { $("copyLink").textContent = "✓ Copied"; };
      try { navigator.clipboard.writeText(txt).then(done, () => selectText()); } catch (e) { selectText(); }
      function selectText() { const r = document.createRange(); r.selectNodeContents($("shareTxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    app.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => act("remove", { target: b.dataset.rm })));
    const skl = $("skList"); if (skl) skl.querySelectorAll("button[data-sk]").forEach((b) => (b.onclick = () => openLife(W(st.turn.skipped[+b.dataset.sk]))));
    // the turn ended or moved on: the drawer must not keep showing a word to someone who is no longer describing
    if (lifeOpen && st.phase !== "play" && lifePaused) lifePaused = false;
    tick();
  }

  document.addEventListener("keydown", (e) => {
    if (!OL.active || lifeOpen || !OL.st || OL.st.phase !== "play" || !amDesc() || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); act("mark", { ok: true, word: OL.st.turn.word }); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); act("mark", { ok: false, word: OL.st.turn.word }); }
    else if (e.key === "h" || e.key === "H") { e.preventDefault(); openLife(OL.myWord()); }
  });
  document.addEventListener("visibilitychange", () => { if (OL.active && !document.hidden) poll(); });

  // auto-return to a game after a page reload
  const sv = saved(), qp = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
  window.addEventListener("DOMContentLoaded", () => {
    if (sv && sv.code && sv.pid && (!qp || qp === sv.code)) enter(sv.code, sv.pid, sv.name, null);
  });
})();
