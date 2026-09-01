# Analytics for scifi-theme

Measure how people use your app — with no setup, from the moment they use it. This file is
everything you (or an agent) need to add a custom action end-to-end.

## What's included automatically

The moment someone opens scifi-theme, VVD records — anonymously — opens, sessions, time spent, and a real
world map of where they are. You don't instrument anything for these. See them in
**App Details → Analytics**.

## Track an action (the one API)

Custom actions are the verbs *you* invent — "pin placed", "boss defeated", "card drawn". One call:

```tsx
import { useHost } from "@vvd/sdk"

const host = useHost()
// fire-and-forget · scalars only · never throws · the host attributes it to scifi-theme automatically
host.analytics?.track("pin_placed", { biome: "tundra" })

// Counting a QUANTITY (words, tiles, XP, damage)? Pass a numeric magnitude as the 3rd arg — it's
// SUMMED into a running total shown next to the action. Unlike a prop, it's never bucketed.
host.analytics?.track("words_written", {}, wordsAddedThisEdit)
```

- Call it defensively with `?.` — never list `analytics` in `needs` (it's inherited, like feedback).
- You pass a **name**, optional **scalar props** (strings/numbers), and an optional **numeric value**
  (a summed magnitude). Nothing else — the host stamps which tool/version/world it came from, so you
  can't (and don't need to) identify yourself.

## Declare your actions (optional, recommended)

Add an `analytics.actions` block to `vvd.json` so the dashboard labels them and the drill-down types
your property breakdowns:

```jsonc
{
  "analytics": {
    "actions": [
      {
        "name": "pin_placed",
        "label": "Pins placed",
        "description": "A player drops a pin on the map.",
        "props": [{ "name": "biome", "type": "string", "label": "Biome" }]
      }
    ]
  }
}
```

Declaration is optional — an undeclared `track("foo")` still shows up as a *discovered* action; the
declaration just adds a nice label + typed property breakdowns.

## The rules (so your data stays clean & private)

- **Scalars only** — strings and numbers. No objects, arrays, or free text.
- **Low cardinality** — a biome, a difficulty, a die size. **Not** a user id, a note, a timestamp, an
  email. VVD drops emails/UUIDs/free-text at ingest anyway, and buckets over-used values to "Other" —
  but model it right and your breakdowns stay readable.
- **No PII, ever** — you measure *behavior*, never *people*.

## Privacy, in one paragraph

Every event is anonymized server-side with a **daily-rotating salted hash** (no cookies, no persistent
id), coarsened to **country** (never an IP), and read back **aggregate-only** with **k-anonymity** —
any cohort smaller than 5 people collapses to "Other". You literally cannot see an individual.

## What you'll see

App Details → **Analytics**: your action in the Custom Actions panel; tap it for a time graph of when
it fired, distinct players, per-session rate, and a breakdown per property — all k-anonymized.

## Verify it

```bash
vvd analytics          # validate your declared actions + lint your track() calls
vvd analytics --open   # open App Details → Analytics for scifi-theme
```

Then run scifi-theme, do the action, and watch it land.
