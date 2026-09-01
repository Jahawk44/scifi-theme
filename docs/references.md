# Reference, don't retype — the core VVD principle

**The single instinct that makes a app feel native to VVD:** when scifi-theme needs to talk about
something that already exists in the world — a character, a place, an item, another document — it
should **point at that document by id**, never copy its data or ask the user to type it again.

> If you're about to add a text input for a name that already lives in the world, **stop and add a
> picker instead.**

## Why

The world is one source of truth. A card for "Aldous the Grey" is edited in exactly one place. If
your app stores a *copy* of his name, the moment someone renames him your copy is a lie. If it
stores his **id**, every reference updates the instant the card changes — for free, everywhere,
across every tool that references him (a board, a map pin, a relation tree, an embed).

## The shape of a reference

A reference is just a **document id string** — optionally with a small denormalized cache for offline
display. Real native examples:

```ts
// A Kanban board stores only the ids of the cards in each column — never the cards:
interface BoardColumn { id: string; title: string; cardIds: string[] }

// A map pin stores the linked doc's id + a cached name/avatar for instant render:
interface MapPin {
  position: { x: number; y: number }
  linkedDocumentId: string | null       // ← the reference (the source of truth)
  linkedDocumentName: string | null     // ← denormalized cache (nice-to-have, may go stale)
  linkedDocumentAvatar: string | null
}
```

Store the **id**. The cached name/avatar is a convenience for first paint — the id is what's true.

## Let the user PICK, not type

Never hand-roll a text field for world data. Use the host's search to offer real entities, and get
back an id. This is the whole pattern:

```tsx
import { useHostCapability } from "@vvd/sdk"

function EntityPicker({ onPick }) {
  const search = useHostCapability("search")
  const [q, setQ] = useState("")
  const [hits, setHits] = useState([])

  useEffect(() => {
    if (!q) return setHits([])
    let live = true
    search.query(q, { types: ["card"], limit: 20 }).then((r) => live && setHits(r))
    return () => { live = false }
  }, [q, search])

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the world…" />
      {hits.map((h) => (
        <button key={h.id} onClick={() => onPick(h.id)}>   {/* ← return the ID, never the text */}
          {h.name} <small>{h.entityTypeName}</small>
        </button>
      ))}
      {q && hits.length === 0 && (
        // Nothing matches? Let them CREATE it as a real world card — and still store only the id:
        <button onClick={async () => { const c = await search.create(q, null); if (c) onPick(c.id) }}>
          Create "{q}" as a card
        </button>
      )}
    </div>
  )
}
```

`search.query(text, { types, limit })` returns entity hits (`{ id, name, slug, entityTypeName,
entityTypeIcon, avatarMediaId }`); `search.create(name, typeId)` mints a new world card and returns
it. The native Board, Canvas, Map, and relation-tree pickers are all exactly this — search-or-create,
`onPick(documentId)`.

## Resolve the reference live through the host

Once you hold an id, the host turns it into whatever you need — never store the resolved data:

```tsx
import { useHostCapability } from "@vvd/sdk"

const refs = useHostCapability("refs")
const nav  = useHostCapability("nav")

// 1. Display: id → { id, name, slug, type, avatarMediaId } for a chip/label (batched, host-cached)
const metas = await refs.meta([cardId])        // Map<id, DocumentRef>

// 2. Navigate: open the referenced document (double-click a chip / pin)
nav.openDocument(refs.coordsFor(cardId) ?? { worldId: document.worldId, documentId: cardId })
```

To render the *whole* referenced document live and read-only inside scifi-theme, use the embeds
capability instead of opening a second copy:

```tsx
import { useEmbeddedDocument } from "@vvd/sdk"
const embed = useEmbeddedDocument(refs.coordsFor(cardId))   // projected read of another doc
// …or host.embeds.Embed / <HostEmbed> to render it through the host's own tool registry.
```

## Discover what's in the world — `useWorldQuery`

To list or pick from the world's catalog (requires `"readsWorld": true` in `vvd.json`):

```tsx
import { useWorldQuery } from "@vvd/sdk"

const cards = useWorldQuery("documents", { type: "card" })   // live rows: { id, name, slug, documentType, updatedAt }
const eras  = useWorldQuery("eras")
```

These are **live** — as the world's catalog changes on any client, your list updates. Rows give you
ids + names; feed an id back into `refs` / `embeds` / `useDocument` to go deeper. Content stays
behind the document seam.

## The checklist

- [ ] No text input asks the user to retype a name/place/thing that exists in the world.
- [ ] Every pointer to another document is stored as an **id** (plus, optionally, a cached label).
- [ ] Picking uses `search.query` (+ `search.create` for "make a new one").
- [ ] Displaying uses `refs.meta`; opening uses `nav.openDocument(refs.coordsFor(id))`; embedding
      uses `useEmbeddedDocument` / the embeds capability.
- [ ] `vvd.json` declares `"capabilities": { "readsWorld": true }` if you query the world.
