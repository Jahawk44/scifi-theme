# The document system — how to structure scifi-theme's data

Everything scifi-theme stores lives in a **document**: a CRDT (Yjs) the platform syncs, persists, and
merges for you. You never write Yjs. You declare a **codec** — a typed shape — and the SDK gives you
a live snapshot + typed actions that are collaborative out of the box.

## Declare your shape with `defineStateCodec`

Pick a **field type per piece of state** so the merge is correct by construction:

```ts
import { defineStateCodec, field } from "@vvd/sdk"

const codec = defineStateCodec({
  title: field.value("Untitled"),   // last-write-wins scalar (per-FIELD merge)
  pins:  field.list(),              // positional CRDT — two people adding at once BOTH land
  votes: field.map(),               // per-KEY last-write-wins
  notes: field.prose(),             // rich text — character-level merge
})
```

The four field types — choose by how it should merge:

| Field | Use for | Merge |
| --- | --- | --- |
| `field.value(default)` | title, mode, a config scalar, any JSON blob | last-write-wins per field |
| `field.list()` | ordered items, pins, rows, columns | positional — concurrent inserts both land |
| `field.map()` | keyed data (votes by id, settings by key) | per-key last-write-wins |
| `field.prose()` | a rich-text body with live carets | per-character (bind to `<CollaborativeText>`) |

**Merge semantics you can rely on:** concurrent writes to *different* fields both win; the same
value-field converges on one winner; concurrent list inserts both land in a stable order; maps merge
per key; prose per character. **Schema evolution is additive-for-free** — a field you add later reads
as its default on old documents, so no migration.

## Read + write it with `useDocument`

```tsx
import { useDocument, DocumentGate } from "@vvd/sdk"

function ScifiThemeView({ document, context }) {
  const coords = { worldId: document.worldId, documentId: document.id }
  const { data, status, actions, handle, retry } = useDocument(coords, codec)

  return (
    <DocumentGate status={status} onRetry={retry}>
      {data && actions && (
        <input
          value={data.title}
          disabled={!context.canEdit}
          onChange={(e) => actions.set("title", e.target.value)}
        />
      )}
    </DocumentGate>
  )
}
```

`useDocument(coords, codec)` returns `{ data, status, actions, handle, retry }`:
- `data` — a typed, reactive snapshot (`null` until open). Re-renders on any change, local or remote.
- `status` — `"connecting" | "ready" | "disconnected" | "auth_error" | "error"`. Wrap in
  `<DocumentGate>` so the connecting/error states are handled for you.
- `actions` — typed mutators; every call syncs automatically. Always gate writes on
  `context.canEdit`.
- `handle` — the one opaque seam you hand to SDK collab components (`<CollaborativeText handle={…}>`)
  and presence hooks. Never read from it.

## The actions API

```ts
actions.set("title", "New title")              // value field
actions.update("taps", (n) => n + 1)           // read-modify-write in one transaction
actions.list("pins").push(pin)                 // + insert(i, …), remove(i, count?),
actions.list("pins").move(from, to)            //   replace(i, item), move(from, to)
actions.map("votes").set(cardId, 1)            // + delete(key)
actions.transact(() => { …several ops… })      // batch → ONE undo step / one broadcast
```

## How to think about structuring data

- **One document = one thing the user opens.** As a app, scifi-theme edits the `scifi-theme` document type.
- **Reach for the field that matches the merge you want** (table above). A list of items is a
  `field.list`, not a `field.value` holding an array — the list merges concurrent inserts; the array
  would clobber.
- **Keep per-user, throwaway UI state OUT of the document** — selection, hover, a camera, a draft
  input are React state, not codec fields. Only put in the document what everyone should still see
  tomorrow. (See the camera rule in `docs/canvases.md`.)
- **Point at other world documents by id, never by copying their data.** This is the big one →
  `docs/references.md`.

## When you outgrow `defineStateCodec`

`defineStateCodec` *is* a `DocumentCodec` — for full control (custom Yjs containers, migrations)
eject to `defineDocumentCodec({ read, observe, actions, toolId, schemaVersion, migrate })` with no
migration. The native Map and relation-tree codecs are written this way; see `docs/canvases.md`.
