// Vercel serverless function: the AI side of the Lifeline.
// Needs one environment variable in Vercel: ANTHROPIC_API_KEY
// Optional: LIFELINE_CODE (a password students type once), MODEL (override the model id)

const MODELS = [process.env.MODEL, "claude-haiku-5-5", "claude-haiku-4-5"].filter(Boolean);

const WORD_PROMPT = (input, variant) => `You help an ELEMENTARY (A1) Russian-speaking adult play the word game Alias ("Элиас") in an English lesson. On their turn they must explain a word in English WITHOUT saying it, so teammates (A2 level) guess it. They give you a word or short phrase, in English or Russian. If it is Russian, pick the most common English equivalent and explain THAT English word.

Rules for the "alias" lines:
- Each line is something they can read aloud as is. Very simple English: present simple, top-1000 words only, max 9 words per line.
- NEVER use the target word, its root, or same-root words (for "teacher" do not use "teach").
- Order from general to specific: category first ("It's a thing / person / place / action..."), then what it does / where it is / who uses it, then an opposite or a "like X but..." clue.
- Give 5 lines, each with a natural Russian translation so they understand what they are saying.
${variant ? "- They already saw the usual clues. Give 5 DIFFERENT clues from new angles (situations, opposites, famous examples, sounds-like)." : ""}

Also give:
- "say": pronunciation for a Russian speaker in Russian letters, stressed syllable in CAPITALS (e.g. "ам-БРЭ-ла"); "ipa": IPA.
- "pos": part of speech in Russian.
- "ru": short Russian translation(s); "meaning_ru": 1-2 sentence plain Russian meaning.
- "taboo": 2-5 English words they must NOT say (the word itself and same-root words).
- "examples": 2 short A1 sentences with Russian.
- "collocations": 2-3 common word combinations with Russian.
- "nuance_ru": in Russian, when/how the word is used, register, difference from a word Russians confuse it with (1-3 sentences).
- "trap_ru": in Russian, one typical mistake Russian speakers make with it. Short.

Reply with ONLY a JSON object, exactly this shape:
{"word":"umbrella","ru":"зонт, зонтик","pos":"существительное","say":"ам-БРЭ-ла","ipa":"/ʌmˈbrelə/","meaning_ru":"...","alias":[{"en":"It's a thing.","ru":"Это вещь."}],"taboo":["umbrella"],"examples":[{"en":"...","ru":"..."}],"collocations":[{"en":"...","ru":"..."}],"nuance_ru":"...","trap_ru":"..."}

Input: ${JSON.stringify(input)}`;

const CHAT_RULES = `Ты — личный помощник русскоязычного ученика уровня A1 (начальный) прямо во время онлайн-урока английского и игры Alias. Он задаёт короткие вопросы: что значит фраза, как сказать что-то по-английски, как объяснить слово, что ответить учителю.
Правила ответа:
- Отвечай по-русски, коротко (до 8 строк), без Markdown, без звёздочек и решёток.
- Английские фразы давай очень простые (A1), каждую — с переводом и произношением русскими буквами, ударный слог ЗАГЛАВНЫМИ. Формат строки: English phrase — перевод (произношение).
- Если спрашивают «как сказать…», дай 1 основной вариант и 1 запасной, ещё проще.
- Если нужно, добавь одну строку «Нюанс:» про то, как это звучит для носителя.
- Будь тёплым и ободряющим, но без лишних слов.`;

async function callClaude(key, body) {
  let last;
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    last = { status: r.status, message: j?.error?.message || "upstream error" };
    // only try the next model when this one doesn't exist for the key
    if (!(r.status === 404 || /model/i.test(last.message))) break;
  }
  const e = new Error(last?.message || "upstream error");
  e.status = last?.status || 502;
  throw e;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "no_key", message: "ANTHROPIC_API_KEY is not set in Vercel." });
  const code = process.env.LIFELINE_CODE;
  if (code && req.headers["x-lifeline-code"] !== code) return res.status(401).json({ error: "bad_code" });

  const { mode, input, turns, variant } = req.body || {};
  try {
    if (mode === "word") {
      const word = String(input || "").trim().slice(0, 80);
      if (!word) return res.status(400).json({ error: "empty" });
      const text = await callClaude(key, {
        max_tokens: 1400,
        messages: [{ role: "user", content: WORD_PROMPT(word, !!variant) }],
      });
      const data = parseJSON(text);
      if (!data || !data.word || !Array.isArray(data.alias)) return res.status(502).json({ error: "bad_json" });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(data);
    }
    if (mode === "chat") {
      const msgs = (Array.isArray(turns) ? turns : [])
        .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
        .slice(-12)
        .map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }));
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ error: "empty" });
      const text = await callClaude(key, { max_tokens: 700, system: CHAT_RULES, messages: msgs });
      return res.status(200).json({ text: text.replace(/\*\*/g, "") });
    }
    return res.status(400).json({ error: "bad_mode" });
  } catch (e) {
    return res.status(e.status === 429 ? 429 : 502).json({ error: "upstream", message: e.message });
  }
}
