# Twin

A self-hosted AI agent twin. It captures from your phone, remembers what matters,
tracks what you owe and what you're owed, and drafts in your voice — then puts
every outward action in a queue for you to approve.

**It cannot send anything on its own.** That is the design, not a limitation.

---

## Run it

```bash
git clone <this repo> && cd gouta-website
npm install

cp .env.example .env
node -e "console.log(crypto.randomUUID().replace(/-/g,''))"   # paste as TWIN_TOKEN
# add your ANTHROPIC_API_KEY from https://console.anthropic.com/settings/keys

npm start          # http://localhost:8787
npm test           # 26 tests, no API key or network needed
```

Requires Node 22.5+ (it uses the built-in SQLite). One dependency: the Anthropic SDK.

Without an `ANTHROPIC_API_KEY` the server still runs — captures are stored raw and
nothing is lost — it just cannot think until you add one.

### Hosting it privately

This holds your notes, your commitments, and drafts written in your name. Do not
put it on the open internet.

The best option is [Tailscale](https://tailscale.com): install it on the host and
on your iPhone, and the twin is reachable at `http://<machine>.<tailnet>.ts.net:8787`
from your phone anywhere in the world, with nothing exposed publicly. A Raspberry Pi,
an old laptop, or a $5 VPS all work — this is a single Node process and a SQLite file.

---

## Set it up as *you*

Two things decide whether this feels like a twin or like a chatbot:

1. **Fill in `profile/`.** Four markdown files — `identity`, `voice`, `people`,
   `rules` — that go into every prompt. `voice.md` matters most; paste three real
   messages you have sent into it. You can edit all four from your phone under
   the **You** tab.
2. **Wire up your phone.** See [docs/ios-shortcuts.md](docs/ios-shortcuts.md).
   The single highest-value step is the *"Hey Siri, tell my twin"* shortcut.

---

## How it works

```
  iPhone                     Twin                        You
  ──────                     ────                        ───
  Siri / Share / Back Tap
        │
        └── POST /api/capture ──► triage ──┬──► memory      (learned, internal)
                                           ├──► tasks       (commitments, internal)
                                           └──► proposals ──► approval queue ──► tap
                                                                                  │
  PWA on home screen ◄── GET /api/state ◄──────────────────────────────────────────┘
```

Everything internal (memory, commitments) is written directly. Everything that
would leave the system becomes a **proposal** — a card with the full draft,
ready to send verbatim, that does nothing until you approve it.

`approve` runs the executor registered for that proposal's kind, in
`server/twin/execute.js`. Out of the box only `task` has one, so approving a
draft marks it ready and hands it back to you to send. Registering an executor
(Gmail, Slack, whatever) is the single, deliberate act that gives the twin
outward reach — it is one function, in one file, on purpose.

### Layout

| Path | What it is |
|---|---|
| `server/index.js` | HTTP server, static files, error handling |
| `server/db.js` | SQLite schema and every query |
| `server/claude.js` | Anthropic integration; `buildRequest` is pure and tested |
| `server/twin/prompts.js` | Profile + memory → system prompt |
| `server/twin/extract.js` | Capture → memory, commitments, proposals |
| `server/twin/execute.js` | What "approve" does. The outward-reach boundary |
| `server/routes/api.js` | The API surface |
| `public/` | The PWA — no build step, no framework |
| `profile/` | Who you are. Edited from the phone |

---

## What it does not do yet

Being straight about the edges:

- **No email integration.** It drafts replies; it does not read your inbox or send.
  Wiring Gmail means an executor in `execute.js` plus an OAuth flow.
- **No push notifications.** iOS supports Web Push for installed PWAs, but it is
  not implemented. The shortcuts doc has a polling workaround.
- **No calendar.**
- **No background processing.** Triage runs when a capture arrives, not on a schedule.
- **Single user.** One token, one person. It is not multi-tenant and should not be.
