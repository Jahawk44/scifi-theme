# AGENTS.md — scifi-theme

A VVD app built with the `vvd` CLI. This file is the front door for anyone — human or agent —
building on scifi-theme. Read it first, then follow the links into `docs/` for the VVD way to do a thing.

> Your training data is not the source of truth — **this repo + `@vvd/sdk` are.** When in doubt,
> open the guide, then grep the SDK types. The whole app (host, world, collaboration, media) is the
> real VVD; your code is just the app. That's why this project is tiny.

## The loop

- `vvd run`     — render scifi-theme live in your world; edits to `src/` hot-reload instantly.
- `vvd save`    — save a new version (a private draft — only you).
- `vvd share`   — let your world/team open your latest save.
- `vvd publish` — put it in the Workshop for review.

Your code lives in `src/app.tsx`. Manifest is `vvd.json`.

## Core principles (non-negotiable — this is what makes it feel like VVD)

1. **Reference, don't retype.** Never ask a user to type in world data you could point at. If your
   app needs a character, a place, an item — let them **pick an existing world document** and
   store its **id**, then resolve it live through the host. One source of truth; edit the card once,
   every reference updates. → `docs/references.md` (start here — this is the big one).
2. **Collaboration is the default, not a feature.** State declared in a codec is already multiplayer
   — concurrent edits converge with zero Yjs in your code. Don't build a single-player thing and
   bolt sync on later. → `docs/collaboration-and-presence.md`.
3. **Show presence.** If two people can be here, show that they're here — a facepile at minimum,
   live cursors on a canvas. Presence rides cheap ephemeral awareness; use it freely.
   → `docs/collaboration-and-presence.md`.
4. **Structure data against the codec, not a blob.** Pick the right field type (`value`/`list`/
   `map`/`prose`) so merges are correct by construction. → `docs/documents-and-data.md`.
5. **Canvases keep the camera local.** Pan/zoom is per-user React state — never in the document.
   Positions are plain `{ x, y }`; references are ids. → `docs/canvases.md`.
6. **Secrets live server-side, behind declarations — `process.env` is ALWAYS empty.** An API key
   goes in an `api/` endpoint that declares `config.secrets` + `config.fetch` and reads it with
   `ctx.secrets.get`; your UI calls it with `useApi()` — never a hand-built URL. This is the #1
   thing AI-generated backends get wrong. → `docs/server-endpoints-and-secrets.md`.

## The guides

| Read | For |
| --- | --- |
| [`docs/references.md`](docs/references.md) | **Reference, don't retype** — pickers, `refs`, `embeds`, `useWorldQuery`. The VVD way to point at world data. |
| [`docs/documents-and-data.md`](docs/documents-and-data.md) | How the document system works + how to structure your state (the `field.*` API, actions, merge semantics). |
| [`docs/collaboration-and-presence.md`](docs/collaboration-and-presence.md) | Native real-time collab + a menu of presence displays (facepile, cursors, carets, "typing…") and how to build your own. |
| [`docs/canvases.md`](docs/canvases.md) | Build a map/graph/board canvas the VVD way — worked from the native Map + relation-tree. |
| [`docs/server-endpoints-and-secrets.md`](docs/server-endpoints-and-secrets.md) | The `api/` folder: secrets (`config.secrets` + `ctx.secrets.get` — never `process.env`), the egress allowlist, `useApi()`, webhooks. |
| [`docs/i18n.md`](docs/i18n.md) | Languages: the `src/locales/` catalogs, `useT()`, `vvd locales add` / `check`, and the traps (plurals, dates, never concatenate). |
| [`ANALYTICS.md`](ANALYTICS.md) | Measure how people use scifi-theme — the one `track()` API + privacy rules. |

## The one rule to remember

If you're about to add a text input for something that already lives in the world — **stop, and add a
picker instead.** That single instinct is 80% of what makes a app feel native to VVD.

## Editor types for `@vvd/sdk`

The `@vvd/sdk` type sources weren't found on this machine when this project was scaffolded, so
`tsconfig.json` skips the `@vvd/*` path aliases (`vvd run` / `vvd save` are unaffected — the host
injects the real SDK at run time). To restore editor types + typechecking against the SDK, run
`vvd doctor --fix-types`, or point `paths` in `tsconfig.json` at a vvd checkout's `packages/`.
