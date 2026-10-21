// Tiny Redis client over Upstash's REST API (no npm packages needed).
// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN
// (older setups use UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasStore = () => Boolean(URL_ && TOKEN);

export async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("store: " + (j.error || r.status));
  return j.result;
}

const TTL = 60 * 60 * 12; // rooms live 12 hours

export async function getRoom(code) {
  const s = await redis("GET", "room:" + code);
  return s ? JSON.parse(s) : null;
}
export async function putRoom(room) {
  await redis("SET", "room:" + room.code, JSON.stringify(room), "EX", TTL);
}

// Run fn(room) under a short lock so two players acting at once don't overwrite each other.
export async function withRoom(code, fn) {
  const lockKey = "lock:" + code;
  const me = Math.random().toString(36).slice(2);
  for (let i = 0; i < 40; i++) {
    const ok = await redis("SET", lockKey, me, "NX", "PX", 3000);
    if (ok) {
      try {
        const room = await getRoom(code);
        if (!room) return { notFound: true };
        const out = await fn(room);
        if (out && out.changed) { room.v = (room.v || 0) + 1; await putRoom(room); }
        return { room, out };
      } finally {
        const cur = await redis("GET", lockKey);
        if (cur === me) await redis("DEL", lockKey);
      }
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("busy");
}
