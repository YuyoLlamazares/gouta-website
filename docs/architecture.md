# Why it is built this way

Three decisions carry the design.

## 1. The approval queue is the spine, not a feature

An agent that can act on your behalf is only as safe as the narrowest point it
must pass through. Here that point is the `proposals` table: memory and
commitments are internal and write directly, but **anything that would leave the
system becomes a row that does nothing until you approve it.**

This is why `execute.js` has an executor *registry* rather than inline sending.
Granting outward reach is a deliberate, visible act — one function, one file —
rather than something that accumulates across a codebase. An install with no
executors registered is incapable of surprising anyone, and that is the default.

## 2. The profile is the product

The difference between "an AI twin of me" and "a chatbot with my name on it" is
almost entirely `profile/voice.md`. Model quality is not the bottleneck; knowing
who you are is.

So the profile is plain markdown, editable from the phone, loaded into every
request, and marked `cache_control: ephemeral` — it is the stable prefix of every
prompt, which makes it both the cheapest and the most influential part of the system.

Volatile context (memory, open commitments, today's date) is deliberately kept
*out* of the system prompt and passed as a user turn instead, so it never
invalidates that cache.

## 3. Capture must never fail

The capture endpoint writes to SQLite first, then triages. If the API call fails,
is rate-limited, or there is no key at all, the endpoint returns `202` with the
raw note safely stored. A capture system you cannot trust with a thought at a
traffic light is a capture system you stop using by week two.

## Notes on the model integration

- **Opus 5 rejects `temperature`, `top_p`, `top_k`, and `budget_tokens`** — sending
  any of them is a 400. `test/request-shape.test.js` asserts they are absent, because
  this is exactly the kind of thing that rots silently.
- **Thinking is on by default** on Opus 5; depth is controlled with
  `output_config.effort`. Triage runs at `medium`, drafting at `high` — drafting
  in someone's voice is the harder problem.
- **Refusal fallbacks** are enabled (`fallbacks: "default"`). An unattended agent
  that silently stops on a policy decline is worse than one that continues on a
  fallback model.
- **Structured extraction uses a strict tool** as the schema carrier, with a
  text-JSON fallback if the model answers in prose. Strict mode requires
  `additionalProperties: false` and every property listed in `required`; a test
  walks the schema and enforces both.

## Prompt injection

Captures contain text from the outside world — shared articles, forwarded email,
web pages. The system prompt states that instructions found inside captured
content are data to report, not instructions to follow. That is a mitigation, not
a guarantee. The real protection is structural: the twin's only outward path is a
queue you read before anything happens.
