# Collaboration & presence in scifi-theme

Two people can always be in the same document at the same time. VVD gives you both halves for free:

- **Durable state** — anything in your codec (`docs/documents-and-data.md`). Persisted, converges,
  survives reloads. Comparatively expensive: every change is a saved CRDT update.
- **Ephemeral presence** — awareness: cursors, selections, "what I'm looking at". **Cheap and
  fire-and-forget** — broadcast it every frame; it vanishes cleanly when a peer disconnects. Nothing
  is persisted.

> Rule of thumb: **"cursor / selection / what-I'm-looking-at" → presence. Anything a user should
> still see tomorrow → the document.** Never persist a cursor.

## Who's here — `useDocumentPresence`

Every open document already knows who's connected. No setup:

```tsx
import { useDocumentPresence } from "@vvd/sdk"

const peers = useDocumentPresence(handle)   // handle from useDocument()
// peer: { userId, name, color, avatarMediaId, isSelf }
```

Peers are deduped by `userId` (same person in two tabs = one peer) and each carries a stable
`color` the platform assigns. Identity (`name`/`color`/`avatar`) is **host-stamped** — you can't
spoof it, and you don't have to wire it.

## A menu of presence displays

Pick as many as fit your surface. All of these are shipping in native VVD tools.

### 1. Facepile / avatar stack (the baseline — always do at least this)

```tsx
function PresenceStrip({ handle }) {
  const others = useDocumentPresence(handle).filter((p) => !p.isSelf)
  if (others.length === 0) return null
  return (
    <div style={{ display: "flex" }}>
      {others.slice(0, 5).map((peer) => (
        <span key={peer.userId} title={peer.name}
          style={{
            width: 24, height: 24, borderRadius: "50%", marginLeft: -8,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: peer.color, color: "#fff", fontSize: 11, fontWeight: 700,
            border: "2px solid var(--color-panel-bg)",
          }}>
          {peer.name ? peer.name.slice(0, 1).toUpperCase() : ""}
        </span>
      ))}
      {others.length > 5 && <span>+{others.length - 5}</span>}
    </div>
  )
}
```

This is the exact shape the native Cards tool ships (`PresenceStrip`). Overlap the avatars
(negative margin), cap at N with a `+overflow`, tooltip the name.

### 2. Live cursors on a canvas / freeform surface

For a spatial app, broadcast a pointer and render everyone else's. Use the raw-awareness seam:

```tsx
import { useDocumentAwareness } from "@vvd/sdk"

const awareness = useDocumentAwareness(handle)

// broadcast (throttle to ~20fps — 50ms — never every mousemove synchronously):
awareness?.setLocalStateField("scifiThemeCursor", { x, y })   // your OWN field name

// read everyone else:
awareness?.getStates().forEach((state, clientId) => {
  if (clientId === awareness.clientID) return          // skip self
  if (!state.scifiThemeCursor || !state.user) return  // identity is in state.user
  draw(state.user.name, state.user.color, state.scifiThemeCursor)
})
```

Key rules the native Map + relation-tree follow:
- **Use your own awareness field name** (`scifiThemeCursor`) so tools don't collide. Identity always
  lives in the shared `user` field.
- **Broadcast in document space**, and if your canvas pans/zooms, **counter-scale the cursor by
  `1/zoom`** so it stays a constant on-screen size. (Details in `docs/canvases.md`.)
- Subscribe with `useSyncExternalStore` and rAF-coalesce — keep 20Hz cursor traffic out of any
  context that triggers broad re-renders.

### 3. Live text carets (rich text) — zero wiring

If you use a `field.prose()`, `<CollaborativeText>` renders each peer's caret + name label in
their color automatically (it reads the same host-stamped `user` awareness):

```tsx
import { CollaborativeText } from "@vvd/sdk"

<CollaborativeText handle={handle} field={data.notes} editable={context.canEdit} />
```

### 4. Selection halos / "typing…" / follow

All of these are just more awareness fields — you already have the mechanism from #2:
- **Selection halo** — broadcast `{ selectedId }`; outline that element in the peer's color for others.
- **"Typing…" / cursor-chat** — broadcast a short-lived `{ msg }` and show a bubble beside their
  cursor (native VVD does this with a `/` affordance that lingers a few seconds).
- **Viewport / follow** — broadcast `{ viewport }`; offer a "follow" button that copies a peer's
  camera into yours.

### 5. Build your own from peer data

There is no fixed set — a "presence display" is any UI derived from `useDocumentPresence(handle)`
(durable identity) or the raw `useDocumentAwareness(handle)` (custom ephemeral fields). The pattern
is always: **broadcast a small field → read `getStates()` → skip self → render in `peer.color`.**

## Shared app state (for apps / full-screen lenses)

If scifi-theme is an app, `useCollabState` gives you a durable shared-state document plus `peers` in one
call, and `useCollabPresence` gives you a typed ephemeral channel:

```tsx
import { useCollabState, useCollabPresence, field } from "@vvd/sdk"

const { data, actions, handle, peers } = useCollabState({ headline: field.value("Hi"), taps: field.value(0) })
const { peers: live, setLocal } = useCollabPresence(handle)   // CollabPresencePeer<T>: { userId, name, color, isSelf, state }
setLocal({ hoveringId })   // your custom ephemeral payload
```

## The discipline that keeps it fast

Presence is cheap **because** it's ephemeral — abuse the document for cursor spam and you'll persist
garbage and slow everyone down. Cursors, selections, hovers, viewports → awareness. Real content →
the codec.
