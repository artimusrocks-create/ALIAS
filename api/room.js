// Game rooms: the teacher creates a game, players join with a code.
// GET  /api/room?code=KQ7M&pid=...           -> state for that player
// POST /api/room {action, code, pid, ...}      -> do something, returns new state
import { hasStore, redis, getRoom, putRoom, withRoom } from "../lib/store.js";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 16);

const describer = (room) => room.players[room.dIdx % Math.max(1, room.players.length)];
const isHost = (room, pid) => room.hostId === pid;
const isDescriber = (room, pid) => describer(room)?.id === pid;

function drawWord(room) {
  if (!room.queue.length) room.queue = shuffle(room.pool);
  room.turn.word = room.queue.shift();
}
function finishTurn(room) {
  const d = describer(room);
  if (d) room.scores[d.id] = (room.scores[d.id] || 0) + room.turn.got.length;
  room.turn.paused = false;
  room.phase = "end";
}
function timeLeft(room, now) {
  const t = room.turn;
  if (room.phase !== "play") return 0;
  return t.paused ? t.remaining : Math.max(0, t.endsAt - now);
}

// What one player is allowed to see
function view(room, pid, now) {
  const me = room.players.find((p) => p.id === pid) || null;
  const d = describer(room);
  const iDescribe = !!me && d?.id === me.id;
  const t = room.turn;
  return {
    code: room.code, v: room.v, now, phase: room.phase, round: room.round, dIdx: room.dIdx,
    settings: room.settings, hostId: room.hostId, me,
    players: room.players, scores: room.scores,
    describerId: d?.id || null,
    turn: {
      word: room.phase === "play" && iDescribe ? t.word : room.phase === "end" ? null : null,
      gotCount: t.got.length, skipCount: t.skipped.length,
      got: room.phase === "end" ? t.got : iDescribe ? t.got : [],
      skipped: room.phase === "end" ? t.skipped : iDescribe ? t.skipped : [],
      paused: !!t.paused, left: timeLeft(room, now), secs: room.settings.secs,
    },
  };
}

async function maybeTimeout(code) {
  const room = await getRoom(code);
  if (!room) return null;
  const now = Date.now();
  if (room.phase === "play" && !room.turn.paused && now >= room.turn.endsAt) {
    const res = await withRoom(code, (r) => {
      if (r.phase === "play" && !r.turn.paused && Date.now() >= r.turn.endsAt) { finishTurn(r); return { changed: true }; }
    });
    return res.room;
  }
  return room;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasStore()) return res.status(500).json({ error: "no_store", message: "The game database is not connected in Vercel yet." });
  try {
    if (req.method === "GET") {
      const code = String(req.query.code || "").toUpperCase();
      const room = await maybeTimeout(code);
      if (!room) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(view(room, String(req.query.pid || ""), Date.now()));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method" });

    const b = req.body || {};
    const action = b.action;

    if (action === "create") {
      const name = cleanName(b.name) || "Teacher";
      const s = b.settings || {};
      const pool = Array.isArray(b.pool) ? b.pool.filter((n) => Number.isInteger(n) && n >= 0 && n < 5000).slice(0, 5000) : [];
      if (!pool.length) return res.status(400).json({ error: "empty_pool" });
      let code;
      for (let i = 0; i < 20; i++) {
        const c = newCode();
        const ok = await redis("SET", "room:" + c, "{}", "NX", "EX", 60);
        if (ok) { code = c; break; }
      }
      if (!code) return res.status(503).json({ error: "busy" });
      const host = { id: newId(), name };
      const room = {
        code, v: 1, created: Date.now(), hostId: host.id,
        settings: {
          secs: [30, 60, 90, 120].includes(+s.secs) ? +s.secs : 60,
          hint: s.hint !== false, clues: s.clues !== false, pauseHelp: s.pauseHelp !== false,
        },
        players: [host], scores: { [host.id]: 0 },
        phase: "lobby", dIdx: 0, round: 1,
        pool, queue: shuffle(pool),
        turn: { word: null, got: [], skipped: [], endsAt: 0, remaining: 0, paused: false },
      };
      await putRoom(room);
      return res.status(200).json({ pid: host.id, ...view(room, host.id, Date.now()) });
    }

    const code = String(b.code || "").toUpperCase().trim();
    const pid = String(b.pid || "");

    if (action === "join") {
      const name = cleanName(b.name);
      if (!name) return res.status(400).json({ error: "no_name" });
      let pidOut;
      const r = await withRoom(code, (room) => {
        const same = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (same) { pidOut = same.id; return; }
        if (room.players.length >= 8) { pidOut = null; return; }
        const p = { id: newId(), name };
        room.players.push(p); room.scores[p.id] = 0; pidOut = p.id;
        return { changed: true };
      });
      if (r.notFound) return res.status(404).json({ error: "not_found" });
      if (!pidOut) return res.status(409).json({ error: "full" });
      return res.status(200).json({ pid: pidOut, ...view(r.room, pidOut, Date.now()) });
    }

    let err = null;
    const r = await withRoom(code, (room) => {
      const me = room.players.find((p) => p.id === pid);
      if (!me) { err = [403, "not_in_room"]; return; }
      const host = isHost(room, pid), desc = isDescriber(room, pid);
      const t = room.turn, now = Date.now();
      switch (action) {
        case "start":
          if (!host) { err = [403, "host_only"]; return; }
          if (room.players.length < 2) { err = [400, "need_players"]; return; }
          if (room.phase !== "lobby") return;
          room.phase = "intro"; room.dIdx = 0; room.round = 1;
          return { changed: true };
        case "startTurn":
          if (!(desc || host)) { err = [403, "not_your_turn"]; return; }
          if (room.phase !== "intro") return;
          room.turn = { word: null, got: [], skipped: [], endsAt: now + room.settings.secs * 1000, remaining: 0, paused: false };
          drawWord(room); room.phase = "play";
          return { changed: true };
        case "mark":
          if (!desc) { err = [403, "not_your_turn"]; return; }
          if (room.phase !== "play" || b.word !== t.word) return;
          (b.ok ? t.got : t.skipped).push(t.word);
          drawWord(room);
          return { changed: true };
        case "pause":
          if (!desc || room.phase !== "play" || t.paused || !room.settings.pauseHelp) return;
          t.remaining = Math.max(0, t.endsAt - now); t.paused = true;
          return { changed: true };
        case "resume":
          if (!(desc || host) || room.phase !== "play" || !t.paused) return;
          t.endsAt = now + t.remaining; t.paused = false;
          return { changed: true };
        case "endTurn":
          if (!(desc || host) || room.phase !== "play") return;
          finishTurn(room);
          return { changed: true };
        case "next":
          if (room.phase !== "end") return;
          room.dIdx = (room.dIdx + 1) % room.players.length;
          if (room.dIdx === 0) room.round++;
          room.turn = { word: null, got: [], skipped: [], endsAt: 0, remaining: 0, paused: false };
          room.phase = "intro";
          return { changed: true };
        case "score": {
          if (!host) { err = [403, "host_only"]; return; }
          const tid = String(b.target || "");
          if (!(tid in room.scores)) return;
          room.scores[tid] = Math.max(0, (room.scores[tid] || 0) + (b.delta > 0 ? 1 : -1));
          return { changed: true };
        }
        case "remove": {
          if (!host) { err = [403, "host_only"]; return; }
          const i = room.players.findIndex((p) => p.id === b.target);
          if (i < 0 || room.players[i].id === room.hostId) return;
          const wasDescriber = i === room.dIdx % room.players.length;
          room.players.splice(i, 1); delete room.scores[b.target];
          if (i < room.dIdx) room.dIdx--;
          room.dIdx = room.players.length ? room.dIdx % room.players.length : 0;
          if (wasDescriber && room.phase === "play") { room.turn.got = []; room.phase = "intro"; }
          return { changed: true };
        }
        case "settings": {
          if (!host) { err = [403, "host_only"]; return; }
          const s = b.settings || {};
          if ([30, 60, 90, 120].includes(+s.secs)) room.settings.secs = +s.secs;
          ["hint", "clues", "pauseHelp"].forEach((k) => { if (typeof s[k] === "boolean") room.settings[k] = s[k]; });
          return { changed: true };
        }
        case "reset":
          if (!host) { err = [403, "host_only"]; return; }
          Object.keys(room.scores).forEach((k) => (room.scores[k] = 0));
          room.phase = "lobby"; room.dIdx = 0; room.round = 1;
          room.turn = { word: null, got: [], skipped: [], endsAt: 0, remaining: 0, paused: false };
          return { changed: true };
        default:
          err = [400, "bad_action"];
      }
    });
    if (r.notFound) return res.status(404).json({ error: "not_found" });
    if (err) return res.status(err[0]).json({ error: err[1], ...view(r.room, pid, Date.now()) });
    return res.status(200).json(view(r.room, pid, Date.now()));
  } catch (e) {
    return res.status(e.message === "busy" ? 503 : 502).json({ error: "server", message: e.message });
  }
}
