# Building a canvas — the VVD way (Map, relation trees, boards)

A "canvas" is any spatial app where things live at positions: a map with pins, a relation/family
tree of nodes and edges, a board of columns, a freeform diagram. VVD's native Map and relation-tree
are both built the same way. Copy this architecture.

## The five rules

1. **The codec holds the content; the camera does not.** Positions, pins, nodes, edges, layers →
   document (synced, persisted). Pan/zoom, the active tool, hover, selection → **local React state,
   never synced.** Two people looking at the same map each have their own camera.
2. **Positions are plain `{ x, y }` numbers in document space.** Not a Yjs type, not screen pixels —
   one value in a stable coordinate space you transform at render time.
3. **Everything that points at a world document is stored by id** (+ a denormalized display cache),
   resolved live through the host. → `docs/references.md`.
4. **Render with your own transform.** Native canvases are custom SVG — the Map applies the camera
   via the SVG `viewBox`; the relation-tree via a `docToScreen` transform. No tldraw, no heavy lib.
   (If you *do* pull in a heavy canvas lib, dynamic-import it so it stays out of the initial bundle.)
5. **Presence rides the camera.** Broadcast cursors in document space and counter-scale by `1/zoom`
   so they stay constant on screen. → `docs/collaboration-and-presence.md`.

## Data shape — pins (Map) and nodes+edges (relation tree)

A **pin / marker** = a position + a reference-by-id + layer/order metadata:

```ts
interface Pin {
  id: string
  position: { x: number; y: number }    // document space
  label: string
  linkedDocumentId: string | null        // ← reference a world card by id (not a copy)
  linkedDocumentName: string | null      // denormalized cache for instant render
  layerIds: string[]                     // membership by id
  order: number                          // explicit z-order
}
```

A **relation tree** = nodes (each a position + a card reference) and edges (each references two nodes
by id):

```ts
interface TreeNode {
  id: string
  x: number; y: number                   // document space
  cardDocumentId: string | null          // ← reference the entity this node represents
  cardName: string | null                // denormalized cache
}
interface TreeEdge {
  id: string
  sourceNodeId: string                   // ← reference a node by id
  targetNodeId: string                   // ← reference a node by id
  label?: string
}
```

Edges never store geometry — at render time you look the node ids up in a `Map` and draw between
their current positions. Move a node and every edge follows, because edges reference, not copy.

## The camera is local state

```tsx
const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 })   // NEVER in the codec

// pure, testable transforms (document space <-> screen space):
const toScreen = (p) => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y })
const toDoc    = (p) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom })

// zoom-at-cursor keeps the point under the pointer fixed:
function zoomAt(at, factor) {
  const zoom = clamp(camera.zoom * factor, 0.1, 10)
  const scale = zoom / camera.zoom
  setCamera({ zoom, x: at.x - (at.x - camera.x) * scale, y: at.y - (at.y - camera.y) * scale })
}
```

Convert pointer events to document space with `toDoc` before hit-testing or mutating. Panning changes
only `camera` — memoize your rendered layers so a pan doesn't re-render every pin.

## The codec — coarse whole-array vs per-entity

Two proven patterns from the natives:
- **Per-entity containers** (Map): each pin is its own nested map; create/update/delete act on one
  entity. Good for many independently-edited elements. Create actions **return the new id** so the
  editor can select what it just made.
- **Whole-array LWW** (relation-tree, board): read the whole `nodes`/`edges` array, run a **pure
  transform**, write it back in one transaction. Simpler; great when edits are structural.

```ts
import { defineDocumentCodec } from "@vvd/sdk"

export const scifiThemeCodec = defineDocumentCodec({
  toolId: "scifi-theme",
  schemaVersion: "1.0.0",
  read: (doc) => ({ pins: doc.getArray("pins").toJSON(), layers: doc.getArray("layers").toJSON() }),
  observe: (doc, onChange) => {
    const pins = doc.getArray("pins")
    pins.observeDeep(onChange)
    return () => pins.unobserveDeep(onChange)
  },
  actions: (doc) => ({
    createPin: (input) => { /* push a pin; return its new id */ },
    movePin: (id, position) => { /* update one pin's position */ },
  }),
})
```

## Linking a pin/node to a world entity

Use the reference pattern end-to-end — pick or create, store only the id:

```tsx
// on right-click "add pin here":
const card = await search.create(name, typeId)   // or search.query → pick an existing one
actions.createPin({
  position: docPointUnderCursor,
  linkedDocumentId: card.id,          // ← store the id
  linkedDocumentName: card.name,      // ← cache for first paint
})

// on click a pin: open the linked card through the host
nav.openDocument(refs.coordsFor(pin.linkedDocumentId) ?? { worldId: document.worldId, documentId: pin.linkedDocumentId })
```

## Presence on the canvas

```tsx
const awareness = useDocumentAwareness(handle)
awareness?.setLocalStateField("scifiThemeCursor", docPointUnderCursor)   // document space, ~20fps
// render each peer's cursor inside your camera transform, scaled by 1/camera.zoom (constant on-screen size)
```

## Where to look in native VVD

The Map (`tools/map`, canvas + types in `editor-sdk`) and the relation/family-tree (`tools/family-tree`)
are the two reference implementations — one per-entity, one whole-array; both custom SVG, both
local-camera, both reference-by-id. When in doubt, mirror them.

Set `"surface": "plain"` on a canvas tool so the world background shows through and you own the
surface (vs the default frosted `"panel"`).
