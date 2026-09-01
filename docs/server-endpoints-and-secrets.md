# Server endpoints & secrets — API keys, third-party calls, webhooks

Need a backend for scifi-theme — an API key the browser must never see, a call to an AI provider, a
webhook? Add an **`api/` folder**. Each file is one endpoint (`api/roll-stats.ts` →
`rollStats`), and its presence turns on a second (server-side) bundle. `vvd run` hot-reloads
`api/` edits exactly like `src/`.

## The three laws (each one is load-bearing — skipping any breaks in production)

1. **`process.env` is ALWAYS empty in the tool-server runtime.** By design — nothing injects it,
   in dev or published. A secret is read ONLY with `await ctx.secrets.get("NAME")`, and only for
   names declared in that endpoint's `config.secrets`. Code that reads `process.env.MY_KEY`
   compiles fine and then fails at run time with "not found".
2. **Outbound hosts must be declared.** Every external call goes through `ctx.fetch` against the
   endpoint's `config.fetch` allowlist (exact hostnames — no wildcards). A published app runs
   in an isolated sandbox that **hard-blocks undeclared egress** — a raw `fetch()` to an
   undeclared host may appear to work under `vvd run` and then die with `EGRESS_DENIED` once
   installed. Declare it and use `ctx.fetch` from day one.
3. **Never hand-build endpoint URLs in your UI.** There is no `/api/<endpoint>`,
   `/api/tools/…`, or `/api/tool-server/…` — guessing paths yields HTML 404s. Call your own
   endpoints through the host: `useApi()` (below). No fetch plumbing, no tool id, auth handled.

## A complete endpoint

```ts
// api/ask-oracle.ts — never enters the browser bundle
import { defineHandler } from "@vvd/sdk/server"

export const config = {
  secrets: ["ORACLE_API_KEY"],      // only declared names resolve
  fetch: ["api.example-ai.com"],    // egress allowlist — exact hostnames
}

export default defineHandler(async (ctx, args: { question: string }) => {
  const key = await ctx.secrets.get("ORACLE_API_KEY")
  const res = await ctx.fetch("https://api.example-ai.com/v1/answers", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question: args.question }),
  })
  const body = await res.json()
  if (!res.ok) return { ok: false, message: body.error?.message ?? `Upstream error (${res.status})` }
  return { ok: true, answer: body.answer }   // plain value — JSON-marshalled for you
})
```

And the client side of it:

```tsx
import { useApi } from "@vvd/sdk"

type OracleApi = {
  askOracle: (args: { question: string }) => Promise<{ ok: boolean; answer?: string; message?: string }>
}

function OracleButton() {
  const api = useApi<OracleApi>()   // camelCase method → kebab-case file: askOracle → api/ask-oracle.ts
  return <button onClick={async () => console.log(await api.askOracle({ question: "…" }))}>Ask</button>
}
```

If your component can also render on a published/read-only surface (where the host provides no
`server` capability), read it defensively instead: `const server = useOptionalHost()?.server` —
render nothing (or a disabled state) when it's absent, and call `server.call("ask-oracle", args)`.

## Storing secrets

```bash
vvd secret set ORACLE_API_KEY sk_live_123   # encrypted server-side, this app only
vvd secret set ORACLE_API_KEY               # prompts for the value
vvd secret list                             # names + set/not-set — NEVER values
```

The Workshop UI (your app → **Environment Variables**) stores the same rows. Either way:

- Names are `UPPER_SNAKE_CASE` — anything else is rejected.
- Values are **write-only** after set; only your own declared handlers can read them, at run time.
- Despite the UI section's name, these are NOT `process.env` variables — law #1 always applies.
- Never hardcode a key in source: bundles are distributable artifacts.

## When it doesn't work — symptom → cause

| Symptom | Cause → fix |
| --- | --- |
| Handler says your key/env var is "not found" though you saved it | Reading `process.env` — switch to `config.secrets` + `ctx.secrets.get` (law #1) |
| `secrets: "NAME" is not declared` | The endpoint's `config.secrets` doesn't list it — declare it |
| `"NAME" is declared but has no stored value` | No value saved under that exact name — `vvd secret set NAME` (names are case-sensitive) |
| `fetch: host … is not in this handler's egress allowlist` / `EGRESS_DENIED` | Undeclared host — add the exact hostname to `config.fetch` (law #2) |
| Your UI's fetch gets an HTML 404 page | Hand-built URL — use `useApi()` (law #3) |
| Works under `vvd run`, fails once installed/shared | Usually law #2 (dev is more permissive about raw fetch); declare egress + use `ctx.fetch` |

## Webhooks & raw handlers

For endpoints external services call (signature verification, streaming), export `POST`/`GET`
directly with `config.raw = true` — the handler receives the untouched `Request`. Raw handlers
are HTTP-only by design: your own UI still talks to typed `defineHandler` endpoints via
`useApi()`.

Server code runs in an isolate-shaped runtime: Web-standard APIs only (`fetch`, `Request`/
`Response`, `crypto.subtle`, `URL`) plus `ctx.*` — no Node built-ins, no native addons.
