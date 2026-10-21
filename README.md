# Alias · Neuro-Fluent (with 🛟 Lifeline)

An Alias word game with 1,014 everyday English words, Russian hints, and a helper for weaker players.

- **Easy clues.** Every word has two pre-written clues that show up instantly under the word. They work offline and cost nothing.
- **🛟 Lifeline button.** It's always in the corner. During a turn it opens full help for the current word: 5 clues with Russian translations, pronunciation (in Russian letters and IPA), words you mustn't say, examples, and nuances. While it's open, the timer pauses (you can turn that off in settings).
- **"Вопрос" tab.** A chat where players ask anything in Russian.
- **"Фразы" tab.** Frame phrases for explaining any word ("It's a thing… You use it for…"). Works offline.
- After each turn, tap a skipped word to see how you could have explained it.

## Files
- `index.html`: the game
- `deck1.js`, `deck2.js`, `deck3.js`: the words. Format: `english=russian=clue 1|clue 2`
- `api/help.js`: the AI helper (a Vercel serverless function)

## Put it online (GitHub + Vercel)
1. **GitHub.** Go to github.com/new, name the repo `alias-neurofluent`, and click Create. On the next page, click "uploading an existing file", drag in all the files and the `api` folder, then click Commit.
2. **Vercel.** Go to vercel.com/new, import the `alias-neurofluent` repo, and click Deploy. Leave every setting at its default.
3. **AI key.** In Vercel, open Project → Settings → Environment Variables and add:
   - `ANTHROPIC_API_KEY`: a key from console.anthropic.com (API keys)
   - optional `LIFELINE_CODE`: a password. Students type it once, and strangers can't use up your credit.
   
   Then go to Deployments → ⋯ → Redeploy.

Cost: each full Lifeline lookup uses a small, fast Claude model and costs a fraction of a cent. The easy clues and phrases cost nothing.
To try a different model, add a `MODEL` environment variable.
