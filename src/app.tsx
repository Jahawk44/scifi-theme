import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import {
  HostEmbed,
  HostIcon,
  ToolRegistry,
  defineApp,
  defineTool,
  field,
  resolveCustomizationChoice,
  WIKI_BODY_FONT_PARAM,
  WIKI_HEADING_FONT_PARAM,
  WIKI_TEMPLATE_DEFAULT_ID,
  WIKI_THEME_PARAM,
  WIKI_WORLD_THEME_ID,
  useAppCustomization,
  useCollabState,
  useHostCapability,
  useHostTheme,
  useWorldMeta,
  useWorldQuery,
  type AppCustomizationValues,
  type PublishedAppSurfaceProps,
} from "@vvd/sdk"

// This wiki's OWN publish hooks live next door (src/publish-hooks.ts).
import { bake } from "./publish-hooks"

const NAME = "scifi-theme"
const FILE = "src/app.tsx"

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()
}

// ── Theme (unchanged mechanics — dark sci-fi default) ───────────────────────
type ThemeSpec = { name: string; bg: string; ink: string; card: string; line: string; accent: string; serif: boolean }
const THEME_PARAM = WIKI_THEME_PARAM
const DEFAULT_THEME = THEME_PARAM.default
const WORLD_THEME_ID = WIKI_WORLD_THEME_ID

function ensureWikiFont(name: string, source?: string) {
  if (source !== "google" || typeof document === "undefined") return
  const id = "wiki-font-" + name.replace(/ /g, "-").toLowerCase()
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = "https://fonts.googleapis.com/css2?family=" + name.replace(/ /g, "+") + ":wght@400;500;600;700&display=swap"
  document.head.appendChild(link)
}
function chosenFont(param: typeof WIKI_HEADING_FONT_PARAM, choiceId: string): string | null {
  if (choiceId === "default") return null
  const option = param.options.find((o) => o.id === choiceId)
  if (!option) return null
  ensureWikiFont(option.name, option.source)
  return option.family
}

const TEMPLATE_DEFAULT: ThemeSpec = { name: "Default", bg: "#0a0e17", ink: "#dce3f0", card: "#121826", line: "rgba(124,140,255,0.22)", accent: "#7c8cff", serif: false }

function themeFromPreset(p: { id: string; name: string; values: Record<string, string> }): ThemeSpec {
  if (p.id === WIKI_TEMPLATE_DEFAULT_ID) return TEMPLATE_DEFAULT
  const v = p.values
  return {
    name: p.name,
    bg: v.background || "#0a0e17",
    ink: v.foreground || "#dce3f0",
    card: v.secondary || v.background || "#121826",
    line: v.line || "rgba(127,127,127,0.3)",
    accent: v.primary || "#7c8cff",
    serif: v.font === "serif",
  }
}

function worldTheme(snap: { mode: string; tokens: Record<string, string> }): ThemeSpec {
  const tk = snap.tokens
  const light = snap.mode === "light"
  return {
    name: "Your World",
    bg: tk["--background"] || (light ? "#f6f5f1" : "#101014"),
    ink: tk["--foreground"] || tk["--text-color"] || (light ? "#1c1b18" : "#e8e8ec"),
    card: tk["--muted"] || (light ? "#ffffff" : "#181820"),
    line: tk["--border"] || (light ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)"),
    accent: tk["--primary"] || (light ? "#3d3a34" : "#9aa4b2"),
    serif: false,
  }
}

const font = (t: ThemeSpec) =>
  t.serif ? "Georgia, 'Times New Roman', serif" : "'Space Grotesk', ui-sans-serif, system-ui, sans-serif"

const DEFAULT_SECTIONS = ["featured", "entries", "extras"]
const SECTION_NAMES: Record<string, string> = { featured: "Featured", entries: "All entries", extras: "Everything else" }

const MONO = "'Space Mono', 'Courier New', ui-monospace, monospace"

// ── The Solar System data model ──────────────────────────────────────────────
// A body can orbit the SUN (parentId: null) or another body (parentId: id) —
// a moon orbits its planet; a station can orbit the sun independently (like
// a planet) or orbit a specific planet (like a moon). Motion is never
// stored: only the orbit's SHAPE (radius/offset/period) is persisted; the
// on-screen position at any instant is a pure function of (now, ancestry),
// computed at render time — see docs/canvases.md rule 1.
type BodyKind = "sun" | "planet" | "moon" | "asteroid" | "station" | "ship" | "location"

type SolarBody = {
  id: string
  kind: BodyKind
  parentId: string | null
  orbitRadius: number
  angleOffset: number
  periodSeconds: number
  size: number
  color: string
  name: string                       // placeholder display name (unlinked bodies)
  linkedDocumentId: string | null    // reference, don't retype — docs/references.md
  linkedDocumentName: string | null
  emblemMediaId: string | null       // optional faction/affiliation emblem — a MEDIA REFERENCE
  shattered?: boolean                // render as a broken debris cluster instead of a smooth sphere
  locationStyle?: "surface" | "orbital" | "atmospheric" // only meaningful for kind "location"
  modelMediaId?: string | null       // optional custom 3D model (.glb) — a MEDIA REFERENCE
}

const PLANET_PALETTE = ["#7c8cff", "#c084fc", "#2dd4bf", "#fb923c", "#f472b6", "#38bdf8", "#facc15"]

function pseudo(i: number) {
  const v = Math.sin(i * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

function shadeHex(hex: string, amt: number) {
  const n = parseInt(hex.replace("#", ""), 16)
  let r = (n >> 16) + amt
  let g = ((n >> 8) & 0xff) + amt
  let b = (n & 0xff) + amt
  r = Math.min(255, Math.max(0, r))
  g = Math.min(255, Math.max(0, g))
  b = Math.min(255, Math.max(0, b))
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

// Same procedural pattern as the 3D version's texture (see makeSurfaceTexture
// inside the engine effect) but plain-canvas, no three.js — used by the flat
// top-down Surface View, which is ordinary DOM/CSS, not a WebGL scene.
function makeSurfaceDataUrl(baseColor: string, gasGiant: boolean): string | null {
  if (typeof document === "undefined") return null
  const w = 512
  const h = gasGiant ? 256 : 512
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, w, h)
  if (gasGiant) {
    const bandCount = 7 + Math.floor(Math.random() * 5)
    for (let i = 0; i < bandCount; i++) {
      const y = (i / bandCount) * h
      const bandH = h / bandCount
      ctx.globalAlpha = 0.25 + Math.random() * 0.35
      ctx.fillStyle = shadeHex(baseColor, Math.round((Math.random() - 0.5) * 70))
      ctx.fillRect(0, y, w, bandH * (0.6 + Math.random() * 0.5))
    }
  } else {
    for (let i = 0; i < 340; i++) {
      ctx.globalAlpha = 0.15 + Math.random() * 0.35
      ctx.fillStyle = shadeHex(baseColor, Math.round((Math.random() - 0.5) * 80))
      const x = Math.random() * w
      const y = Math.random() * h
      const r = 4 + Math.random() * 20
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  return c.toDataURL()
}

// Increased realistic spacing - using larger scale factor and power
const DISTANCE_SCALE_A = 2.4
const DISTANCE_SCALE_P = 1.35
function visualFromLogicalRadius(r: number) {
  return DISTANCE_SCALE_A * Math.pow(Math.max(r, 0), DISTANCE_SCALE_P)
}
function logicalFromVisualRadius(r: number) {
  return Math.pow(Math.max(r, 0) / DISTANCE_SCALE_A, 1 / DISTANCE_SCALE_P)
}

// Where a newly-added object should go so it never overlaps what's already
// there — moons/attached stations space out around their OWN parent; every
// sun-orbiting body (planets, asteroids, independent stations) spaces out
// past whatever is currently the outermost thing, regardless of kind.
function nextOrbitRadius(bodies: SolarBody[], attachedToParentId: string | null): number {
  if (attachedToParentId) {
    const siblings = bodies.filter((b) => b.parentId === attachedToParentId)
    const maxR = siblings.reduce((m, b) => Math.max(m, b.orbitRadius), 8)
    return maxR + 8
  }
  const siblings = bodies.filter((b) => !b.parentId && b.kind !== "sun")
  const maxR = siblings.reduce((m, b) => Math.max(m, b.orbitRadius), 40)
  return maxR + 45
}

// Global animation speed — divides every orbit's angular velocity so bodies
// stay comfortably clickable rather than racing past the cursor.
const TIME_SCALE = 0.15

// The four structural TIER BANDS — your actual political geography.
const TIER_BANDS = [
  { id: "crown", label: "TIER I — SOLAR CROWN", radius: 110, color: "#e8eef8" },
  { id: "industrial", label: "TIER II — INDUSTRIAL CORE", radius: 250, color: "#5d8cff" },
  { id: "median", label: "TIER III — THE MEDIAN", radius: 390, color: "#c9a227" },
  { id: "frontier", label: "TIER IV — FAR FRONTIER", radius: 560, color: "#8b6fd6" },
]

const TIER_DESCRIPTIONS: Record<string, string> = {
  crown: "The Sun, Mercury, Venus — an image of wealth: cloud cities, cheap energy, authoritarianism.",
  industrial: "The Three Main Body. Earth: failed state. The Asteroids: hypercapitalism. The Moon: trade hub. Mars: refugee zone.",
  median: "The Non-Aligned Buffer — Jupiter, Saturn. Once energy barons; fallen into comprador-Bonapartist ruin after the political stalemate of the Cold War.",
  frontier: "The Radicalist reaches — Uranus, Neptune. Loosely governed, far past where any tier enforces much of anything.",
}

function tierLabelFor(orbitRadius: number) {
  const band = TIER_BANDS.find((b) => orbitRadius <= b.radius) || TIER_BANDS[TIER_BANDS.length - 1]
  return band.label
}

// A body's displayed classification line. Moons don't have a meaningful
// sun-relative orbitRadius of their own (it's tiny, relative to their
// parent) — so a moon's TIER is its parent planet's tier.
function labelForBody(body: SolarBody, bodies: SolarBody[]): string {
  if (body.kind === "sun") return TIER_BANDS[0].label
  if (body.kind === "station" || body.kind === "ship") return "INFRASTRUCTURE"
  if (body.kind === "location") {
    const parent = body.parentId ? bodies.find((b) => b.id === body.parentId) : null
    const styleLabel = body.locationStyle === "surface" ? "SURFACE SITE" : body.locationStyle === "atmospheric" ? "FLOATING CITY" : "ORBITAL FACILITY"
    return styleLabel + (parent ? " · " + (parent.linkedDocumentName || parent.name) : "")
  }
  if (body.kind === "moon") {
    const parent = body.parentId ? bodies.find((b) => b.id === body.parentId) : null
    return "MOON · " + tierLabelFor(parent ? parent.orbitRadius : body.orbitRadius)
  }
  if (body.kind === "asteroid") return "MINOR BODY · " + tierLabelFor(body.orbitRadius)
  return tierLabelFor(body.orbitRadius)
}

// Real Sol system, stylized (not to true scale) — the Sun itself (a real
// entry: a Dyson swarm, people living on/around it), planets, their major
// moons, an asteroid-belt band, and a Kuiper-belt band. Every body is
// UNLINKED on creation (a placeholder) — link each to a real world entry via
// the focus panel's "Link to a world entry…" control. Safe to run more than
// once — see the dedup-by-name logic where this is invoked.
function buildSeedBodies(): SolarBody[] {
  const bodies: SolarBody[] = []
  const push = (b: Omit<SolarBody, "id">) => {
    bodies.push({ ...b, id: uid() })
    return bodies[bodies.length - 1].id
  }
  const planet = (name: string, orbitRadius: number, size: number, color: string, periodSeconds: number) =>
    push({ kind: "planet", parentId: null, orbitRadius, angleOffset: Math.round(pseudo(bodies.length + 1) * 360), periodSeconds, size, color, name, linkedDocumentId: null, linkedDocumentName: null, emblemMediaId: null })
  const moon = (parentId: string, name: string, orbitRadius: number, size: number, color: string, periodSeconds: number) =>
    push({ kind: "moon", parentId, orbitRadius, angleOffset: Math.round(pseudo(bodies.length + 50) * 360), periodSeconds, size, color, name, linkedDocumentId: null, linkedDocumentName: null, emblemMediaId: null })
  const asteroid = (name: string, orbitRadius: number, size = 3, color = "#9aa4b2") =>
    push({ kind: "asteroid", parentId: null, orbitRadius, angleOffset: Math.round(pseudo(bodies.length + 700) * 360), periodSeconds: 60 + bodies.length * 3, size, color, name, linkedDocumentId: null, linkedDocumentName: null, emblemMediaId: null })

  push({ 
    kind: "sun", 
    parentId: null, 
    orbitRadius: 0, 
    angleOffset: 0, 
    periodSeconds: 999, 
    size: 26, 
    color: "#ffcf5c", 
    name: "The Sun", 
    linkedDocumentId: null, 
    linkedDocumentName: null, 
    emblemMediaId: null,
    modelMediaId: "/ABL 3D Models/Dyson Swarm/low poly dyson swarm.glb"  // Single model for Dyson swarm
  })

  const mercuryId = planet("Mercury", 70, 5, "#b5b0a8", 22)
  const mercuryBody = bodies.find((b) => b.id === mercuryId)
  if (mercuryBody) mercuryBody.shattered = true
  for (let i = 0; i < 5; i++) asteroid("Mercury Remnant " + (i + 1), 58 + i * 5, 1.4, "#8f8a80")
  planet("Venus", 95, 7, "#e0c079", 34)
  const earth = planet("Earth", 130, 7.5, "#4a90d9", 46)
  moon(earth, "Moon", 16, 2.5, "#cfd4da", 8)
  const mars = planet("Mars", 170, 6, "#c1502e", 60)
  moon(mars, "Phobos", 12, 1.6, "#9a8b7c", 5)
  moon(mars, "Deimos", 18, 1.6, "#9a8b7c", 9)

  asteroid("Ceres", 205, 3.4, "#b8ad9c")
  asteroid("Vesta", 215, 2.6, "#b3a894")
  asteroid("Pallas", 222, 2.4, "#aca08a")
  asteroid("Hygiea", 230, 2.4, "#a89d88")
  for (let i = 0; i < 6; i++) asteroid("Asteroid " + (i + 1), 208 + i * 4)

  const jupiter = planet("Jupiter", 300, 16, "#d9a066", 120)
  moon(jupiter, "Io", 24, 2.2, "#d8c46a", 10)
  moon(jupiter, "Europa", 29, 2, "#cdd3d8", 14)
  moon(jupiter, "Ganymede", 34, 2.6, "#a89f92", 18)
  moon(jupiter, "Callisto", 40, 2.4, "#7f7468", 22)

  const saturn = planet("Saturn", 360, 14, "#e3c27a", 150)
  moon(saturn, "Titan", 26, 2.6, "#d8a94a", 16)
  moon(saturn, "Rhea", 20, 1.8, "#c9ccd1", 12)
  moon(saturn, "Enceladus", 15, 1.4, "#eef2f5", 9)

  const uranus = planet("Uranus", 410, 11, "#8fd3e0", 190)
  moon(uranus, "Titania", 18, 1.8, "#b7c2c9", 20)
  moon(uranus, "Oberon", 22, 1.8, "#a7b2b9", 26)

  const neptune = planet("Neptune", 455, 10.5, "#5b7fe0", 220)
  moon(neptune, "Triton", 18, 2, "#c8d2e0", 20)

  asteroid("Pluto", 505, 3, "#c9b8a8")
  for (let i = 0; i < 8; i++) asteroid("KBO-" + (i + 1), 520 + i * 6, 2, "#7c8cff")

  return bodies
}

// Absolute (document-space) position of every body at time `now` — moons/
// attached stations add their local orbit offset on top of their parent's
// current position, so a planet's satellites visibly travel WITH it.
// Local/derived only — never synced.
function computePositions(bodies: SolarBody[], now: number): Map<string, { x: number; y: number }> {
  const byId = new Map(bodies.map((b) => [b.id, b]))
  const cache = new Map<string, { x: number; y: number }>()
  function posOf(b: SolarBody): { x: number; y: number } {
    const cached = cache.get(b.id)
    if (cached) return cached
    const angleDeg = (b.angleOffset + (now / 1000 / b.periodSeconds) * 360 * TIME_SCALE) % 360
    const angleRad = (angleDeg * Math.PI) / 180
    const localX = Math.cos(angleRad) * b.orbitRadius
    const localY = Math.sin(angleRad) * b.orbitRadius
    let base = { x: 0, y: 0 }
    if (b.parentId) {
      const parent = byId.get(b.parentId)
      if (parent) base = posOf(parent)
    }
    const p = { x: base.x + localX, y: base.y + localY }
    cache.set(b.id, p)
    return p
  }
  bodies.forEach(posOf)
  return cache
}

// Same recursive shape as computePositions, but for RENDERING: a body's
// distance from the SUN (parentId === null) is stretched by the power-law
// distance model for a vast, non-cramped feel; a moon/attached station's
// LOCAL orbit around its own parent stays at logical (tight) scale — only
// the parent itself moved further out. Tier bands, orbit rings and the
// drag-plane math all key off this same function so everything stays
// visually consistent.
function computeVisualPositions(bodies: SolarBody[], now: number): Map<string, { x: number; y: number }> {
  const byId = new Map(bodies.map((b) => [b.id, b]))
  const cache = new Map<string, { x: number; y: number }>()
  function posOf(b: SolarBody): { x: number; y: number } {
    const cached = cache.get(b.id)
    if (cached) return cached
    const angleDeg = (b.angleOffset + (now / 1000 / b.periodSeconds) * 360 * TIME_SCALE) % 360
    const angleRad = (angleDeg * Math.PI) / 180
    let base = { x: 0, y: 0 }
    let radius = b.orbitRadius
    if (b.parentId) {
      const parent = byId.get(b.parentId)
      if (parent) base = posOf(parent)
    } else {
      radius = visualFromLogicalRadius(b.orbitRadius)
    }
    const localX = Math.cos(angleRad) * radius
    const localY = Math.sin(angleRad) * radius
    const p = { x: base.x + localX, y: base.y + localY }
    cache.set(b.id, p)
    return p
  }
  bodies.forEach(posOf)
  return cache
}


function ownParamsForPoint(point: { x: number; y: number }, parentPos: { x: number; y: number }, periodSeconds: number, now: number): { orbitRadius: number; angleOffset: number } {
  const dx = point.x - parentPos.x
  const dy = point.y - parentPos.y
  const orbitRadius = Math.sqrt(dx * dx + dy * dy)
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  const elapsed = (now / 1000 / periodSeconds) * 360 * TIME_SCALE
  let angleOffset = (angleDeg - elapsed) % 360
  if (angleOffset < 0) angleOffset += 360
  return { orbitRadius, angleOffset }
}

// Small reusable "search or create" picker — docs/references.md's pattern.
function WorldPicker({ onPick, placeholder }: { onPick: (id: string, name: string) => void; placeholder?: string }) {
  const search = useHostCapability("search")
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    let live = true
    search.query?.(q, { types: ["card"], limit: 8 }).then((r: { id: string; name: string }[]) => { if (live) setHits(r || []) })
    return () => { live = false }
  }, [q, search])
  const createNew = async () => {
    if (!search.create || !q.trim()) return
    const c = await search.create(q.trim(), null)
    if (c) onPick(c.id, c.name)
  }
  const inputStyle = { padding: "6px 9px", borderRadius: 4, border: "1px solid rgba(140,170,220,0.35)", background: "rgba(10,14,23,0.5)", color: "#c7d3e8", fontFamily: MONO, fontSize: 11, outline: "none" } as const
  const hitStyle = { textAlign: "left" as const, padding: "5px 9px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.3)", background: "transparent", color: "#c7d3e8", cursor: "pointer", fontFamily: MONO, fontSize: 10.5 }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || "Search the world…"} style={inputStyle} />
      {hits.map((h) => (
        <button key={h.id} type="button" onClick={() => onPick(h.id, h.name)} style={hitStyle}>{h.name}</button>
      ))}
      {q.trim() && hits.length === 0 && (
        <button type="button" onClick={createNew} style={{ ...hitStyle, borderStyle: "dashed" }}>
          {'Create "' + q.trim() + '" as a new entry'}
        </button>
      )}
    </div>
  )
}

// The "+ Add Object" panel — pick a kind, optionally attach to a planet
// (moons/stations), then either type a placeholder name or link an existing
// world entry. A station left unattached orbits the SUN directly, like a
// planet — attach it to a planet to have it orbit that planet instead.
function AddObjectPanel({ bodies, attachable, onAdd, onClose }: {
  bodies: SolarBody[]
  attachable: { id: string; name: string; size: number }[]
  onAdd: (body: Omit<SolarBody, "id">) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BodyKind>("planet")
  const [parentId, setParentId] = useState<string>("")
  const [locationStyle, setLocationStyle] = useState<"surface" | "orbital" | "atmospheric">("orbital")
  const [name, setName] = useState("")

  const needsParent = kind === "moon" || kind === "station" || kind === "ship" || kind === "location"
  const parentRequired = kind === "location"
  const parentBody = attachable.find((p) => p.id === parentId) || null

  const defaultsFor = () => {
    const attachedTo = needsParent ? parentId || null : null
    if (kind === "location") {
      const parentSize = parentBody?.size ?? 10
      if (locationStyle === "surface") return { orbitRadius: parentSize * 1.05, periodSeconds: 999999, size: 1.4 }
      if (locationStyle === "atmospheric") return { orbitRadius: parentSize * 1.4, periodSeconds: 22, size: 1.6 }
      return { orbitRadius: parentSize * 2.4, periodSeconds: 14, size: 1.6 }
    }
    const orbitRadius = nextOrbitRadius(bodies, attachedTo)
    if (kind === "moon") return { orbitRadius, periodSeconds: 12 + orbitRadius * 0.4, size: 3 }
    if (kind === "station" || kind === "ship") return attachedTo ? { orbitRadius, periodSeconds: 16 + orbitRadius * 0.4, size: 5 } : { orbitRadius, periodSeconds: 40 + orbitRadius * 0.3, size: 5 }
    if (kind === "asteroid") return { orbitRadius, periodSeconds: 40 + orbitRadius * 0.2, size: 2.5 }
    return { orbitRadius, periodSeconds: 40 + orbitRadius * 0.25, size: 10 }
  }

  const colorFor = (seed: string) => (kind === "station" ? "#38bdf8" : kind === "ship" ? "#e2e8f4" : kind === "location" ? "#59d98e" : PLANET_PALETTE[Math.floor(pseudo(seed.length + kind.length) * PLANET_PALETTE.length)])

  const addPlaceholder = () => {
    if (!name.trim()) return
    if (parentRequired && !parentId) return
    const d = defaultsFor()
    onAdd({
      kind,
      parentId: needsParent ? parentId || null : null,
      orbitRadius: d.orbitRadius,
      angleOffset: Math.round(pseudo(Date.now() % 1000) * 360),
      periodSeconds: d.periodSeconds,
      size: d.size,
      color: colorFor(name),
      name: name.trim(),
      linkedDocumentId: null,
      linkedDocumentName: null,
      emblemMediaId: null,
      locationStyle: kind === "location" ? locationStyle : undefined,
    })
    onClose()
  }

  const link = (id: string, linkedName: string) => {
    if (parentRequired && !parentId) return
    const d = defaultsFor()
    onAdd({
      kind,
      parentId: needsParent ? parentId || null : null,
      orbitRadius: d.orbitRadius,
      angleOffset: Math.round(pseudo(Date.now() % 1000) * 360),
      periodSeconds: d.periodSeconds,
      size: d.size,
      color: colorFor(linkedName),
      name: linkedName,
      linkedDocumentId: id,
      linkedDocumentName: linkedName,
      emblemMediaId: null,
      locationStyle: kind === "location" ? locationStyle : undefined,
    })
    onClose()
  }

  const kindBtn = (k: BodyKind, label: string) => (
    <button
      type="button"
      onClick={() => { setKind(k); setParentId("") }}
      style={{ padding: "5px 10px", borderRadius: 3, border: "1px solid " + (kind === k ? "#ff8c42" : "rgba(255,158,84,0.3)"), background: kind === k ? "rgba(255,140,66,0.15)" : "transparent", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, cursor: "pointer" }}
    >
      {label}
    </button>
  )
  const styleBtn = (s: "surface" | "orbital" | "atmospheric", label: string) => (
    <button
      type="button"
      onClick={() => setLocationStyle(s)}
      style={{ padding: "4px 8px", borderRadius: 3, border: "1px solid " + (locationStyle === s ? "#59d98e" : "rgba(89,217,142,0.3)"), background: locationStyle === s ? "rgba(89,217,142,0.15)" : "transparent", color: "#c7d3e8", fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.5, cursor: "pointer" }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: "absolute", top: 64, left: 20, zIndex: 6, width: 270, padding: 14, borderRadius: 6, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(8,11,19,0.94)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#c9a06a", letterSpacing: 1 }}>ADD OBJECT</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {kindBtn("planet", "PLANET")}
        {kindBtn("moon", "MOON")}
        {kindBtn("asteroid", "ASTEROID")}
        {kindBtn("station", "STATION")}
        {kindBtn("ship", "SHIP")}
        {kindBtn("location", "LOCATION")}
      </div>

      {kind === "location" && (
        <div style={{ fontFamily: MONO, fontSize: 9, color: "#5c6d8c", lineHeight: 1.5 }}>
          A colony, satellite, or floating city tagged to a planet/moon —
          only visible once you focus (zoom into) that specific parent.
        </div>
      )}

      {needsParent && (
        <>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ padding: "6px 8px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.3)", background: "rgba(10,14,23,0.6)", color: "#c7d3e8", fontFamily: MONO, fontSize: 10.5 }}>
            <option value="">{parentRequired ? "— choose a parent —" : kind === "station" || kind === "ship" ? "— orbit the Sun directly —" : "— unattached —"}</option>
            {attachable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(kind === "station" || kind === "ship") && (
            <div style={{ fontFamily: MONO, fontSize: 9, color: "#5c6d8c" }}>
              Leave unattached and it orbits the Sun independently, like a planet.
            </div>
          )}
        </>
      )}

      {kind === "location" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {styleBtn("surface", "SURFACE PIN")}
          {styleBtn("orbital", "ORBITAL SAT")}
          {styleBtn("atmospheric", "FLOATING CITY")}
        </div>
      )}

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ padding: "6px 9px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(10,14,23,0.5)", color: "#c7d3e8", fontFamily: MONO, fontSize: 11 }} />
      <button
        type="button"
        onClick={addPlaceholder}
        disabled={!name.trim() || (parentRequired && !parentId)}
        style={{ padding: "7px 10px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.4)", background: "rgba(255,158,84,0.12)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, cursor: name.trim() ? "pointer" : "default", opacity: name.trim() && !(parentRequired && !parentId) ? 1 : 0.5 }}
      >
        ADD AS PLACEHOLDER
      </button>
      <div style={{ fontFamily: MONO, fontSize: 9, color: "#5c6d8c" }}>— or link an existing entry —</div>
      <WorldPicker onPick={link} placeholder="Search to link instead…" />
      <button type="button" onClick={onClose} style={{ alignSelf: "flex-start", padding: "4px 8px", border: "1px solid rgba(140,170,220,0.25)", borderRadius: 3, background: "transparent", color: "#9fb0cc", fontFamily: MONO, fontSize: 10, cursor: "pointer" }}>
        CANCEL
      </button>
    </div>
  )
}

// The side panel for a focused body. The CAMERA does the continuous zoom (in
// the engine's tick loop, by lerping toward the body every frame) — this
// panel is just the accompanying info surface, docked to one side so the 3D
// view stays visible and interactive next to it.
// Dedicated 3D viewer for individual Dyson swarm craft or other artificial objects
// Shows a closer, interactive view of a single model instance
function ArtifactViewer({ modelUrl, artifactName, onBack }: {
  modelUrl: string
  artifactName: string
  onBack: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const btn = { padding: "7px 14px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(10,14,23,0.6)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, cursor: "pointer" } as const

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false

    ;(async () => {
      let THREE: any
      try {
        THREE = await import("three")
      } catch {
        return
      }

      let GLTFLoaderCtor: any = null
      try {
        const mod: any = await import("three/addons/loaders/GLTFLoader.js")
        GLTFLoaderCtor = mod.GLTFLoader || null
      } catch {
        GLTFLoaderCtor = null
      }
      if (!GLTFLoaderCtor) return

      const gltfLoader = new GLTFLoaderCtor()
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      canvas.width = w * window.devicePixelRatio
      canvas.height = h * window.devicePixelRatio

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
      renderer.setSize(w, h)
      renderer.setClearColor(0x04050a, 1)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
      camera.position.set(0, 2, 8)
      camera.lookAt(0, 0, 0)

      scene.add(new THREE.AmbientLight(0xffffff, 0.4))
      const key = new THREE.DirectionalLight(0xffffff, 0.8)
      key.position.set(5, 5, 5)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0x8ea6ff, 0.3)
      fill.position.set(-3, 2, -4)
      scene.add(fill)

      let model: any = null
      gltfLoader.load(modelUrl, (gltf: any) => {
        if (disposed) return
        model = gltf.scene || gltf.scenes[0]
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3()
        box.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        model.scale.setScalar(5 / maxDim)
        const center = new THREE.Vector3()
        box.getCenter(center)
        model.position.sub(center)
        scene.add(model)
      })

      let azimuth = 0
      const clock = new THREE.Clock()
      const tick = () => {
        if (disposed) return
        const dt = clock.getDelta()
        azimuth += dt * 0.3
        camera.position.x = Math.sin(azimuth) * 8
        camera.position.z = Math.cos(azimuth) * 8
        camera.lookAt(0, 0, 0)
        if (model) model.rotation.y += dt * 0.2
        renderer.render(scene, camera)
        requestAnimationFrame(tick)
      }
      tick()

      const onResize = () => {
        const rect = canvas.getBoundingClientRect()
        const w = rect.width
        const h = rect.height
        canvas.width = w * window.devicePixelRatio
        canvas.height = h * window.devicePixelRatio
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      window.addEventListener("resize", onResize)

      return () => {
        disposed = true
        window.removeEventListener("resize", onResize)
        renderer.dispose()
      }
    })()
  }, [modelUrl])

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 8, background: "#04050a", display: "flex", flexDirection: "column", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button type="button" onClick={onBack} style={btn}>← BACK TO SYSTEM</button>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: "#c9a06a" }}>
          ARTIFACT DETAIL · {artifactName.toUpperCase()}
        </span>
        <span style={{ width: 120 }} />
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, borderRadius: 8, border: "1px solid rgba(255,158,84,0.3)" }} />
      <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10, color: "#7186a8", textAlign: "center" }}>
        Individual Dyson swarm craft — autonomous energy collector
      </div>
    </div>
  )
}

// The flat, top-down Surface View — a genuinely different mode from the 3D
// map (per your reference), not just "zoomed in 3D." Plain DOM/canvas, no
// WebGL: a flat procedurally-textured square standing in for the body's
// surface, with its surface-style location pins placed on it. Each pin's
// angle comes from its stored angleOffset; its distance-from-center is a
// stable hash of its own id (surface locations don't otherwise carry a
// second coordinate, so this gives each one a fixed, distinct spot on the
// map rather than clustering).
function SurfaceView({ body, locations, onOpenPin, onBack }: {
  body: SolarBody
  locations: SolarBody[]
  onOpenPin: (loc: SolarBody) => void
  onBack: () => void
}) {
  const dataUrl = useMemo(() => makeSurfaceDataUrl(body.color, body.size >= 10), [body.id, body.color, body.size])
  const btn = { padding: "7px 14px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(10,14,23,0.6)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, cursor: "pointer" } as const

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 8, background: "#04050a", display: "flex", flexDirection: "column", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button type="button" onClick={onBack} style={btn}>← BACK TO ORBIT</button>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: "#c9a06a" }}>
          SURFACE VIEW · {(body.linkedDocumentName || body.name || "UNNAMED").toUpperCase()}
        </span>
        <span style={{ width: 120 }} />
      </div>
      <div style={{ position: "relative", flex: 1, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,158,84,0.3)", background: dataUrl ? "center / cover no-repeat url(" + dataUrl + ")" : "#111" }}>
        {locations.map((loc) => {
          const hash = loc.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
          const rFrac = pseudo(hash) * 0.44
          const angleRad = (loc.angleOffset * Math.PI) / 180
          const leftPct = 50 + Math.cos(angleRad) * rFrac * 100
          const topPct = 50 + Math.sin(angleRad) * rFrac * 100
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => onOpenPin(loc)}
              title={loc.linkedDocumentName || loc.name}
              style={{ position: "absolute", left: leftPct + "%", top: topPct + "%", transform: "translate(-50%, -100%)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              <div style={{ width: 14, height: 14, borderRadius: "50% 50% 50% 0", background: loc.color, transform: "rotate(-45deg)", boxShadow: "0 0 8px " + loc.color }} />
              <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9, color: "#e7edf8", background: "rgba(6,8,16,0.7)", padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>
                {(loc.linkedDocumentName || loc.name || "UNNAMED").toUpperCase()}
              </div>
            </button>
          )
        })}
        {locations.length === 0 && (
          <p style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: 0, fontFamily: MONO, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            No surface sites tagged to {body.name || "this body"} yet.
          </p>
        )}
      </div>
    </div>
  )
}


function BodySidePanel({ body, tierLabel, editing, emblemUrl, onBack, onOpen, onRename, onLink, onUnlink, onRemove, onSetEmblem, onRemoveEmblem, onSetModel, onRemoveModel, onViewSurface }: {
  body: SolarBody
  tierLabel: string
  editing: boolean
  emblemUrl: string | null
  onBack: () => void
  onOpen: (id: string) => void
  onRename: (name: string) => void
  onLink: (id: string, name: string) => void
  onUnlink: () => void
  onRemove: () => void
  onSetEmblem: (mediaId: string) => void
  onRemoveEmblem: () => void
  onSetModel: (which: "high" | "low", mediaId: string) => void
  onRemoveModel: (which: "high" | "low") => void
  onViewSurface: (() => void) | null
}) {
  const [shown, setShown] = useState(false)
  const [nameDraft, setNameDraft] = useState(body.name)
  const [linking, setLinking] = useState(false)
  const media = useHostCapability("media")
  const scope = useHostCapability("scope")
  useEffect(() => {
    setNameDraft(body.name)
    setShown(false)
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [body.id])

  const pickEmblem = async () => {
    if (!media.pick) return
    const picked = await media.pick({ worldId: scope.worldId, accept: ["image/*"] })
    if (picked) onSetEmblem(picked.id)
  }

  // EXPERIMENTAL: the accept filter for non-image files is a best-effort
  // guess — if your media picker only allows images, this may not surface
  // .glb files. Test it; if it doesn't work, that's the thing to report.
  const pickModel = async (which: "high" | "low") => {
    if (!media.pick) return
    const picked = await media.pick({ worldId: scope.worldId, accept: ["model/gltf-binary", ".glb", ".gltf"] })
    if (picked) onSetModel(which, picked.id)
  }

  const displayName = body.linkedDocumentName || body.name || "UNNAMED"
  const label = { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: "#8a9bbc" } as const
  const btn = { padding: "7px 14px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.3)", background: "transparent", color: "#9fb0cc", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, cursor: "pointer" } as const

  return (
    <div
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(380px, 92vw)", zIndex: 5,
        background: "linear-gradient(90deg, rgba(6,8,16,0) 0%, rgba(6,8,16,0.94) 14%)",
        display: "flex", flexDirection: "column", padding: "84px 22px 22px",
        opacity: shown ? 1 : 0, transform: shown ? "translateX(0)" : "translateX(24px)",
        transition: "opacity 380ms ease, transform 380ms cubic-bezier(.2,.8,.2,1)",
        overflowY: "auto",
      }}
    >
      <button type="button" onClick={onBack} style={{ ...btn, alignSelf: "flex-start", marginBottom: 18 }}>← BACK TO CHART</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {emblemUrl && <img src={emblemUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", opacity: 0.75, objectFit: "cover" }} />}
        <span style={label}>{tierLabel}</span>
      </div>
      <h2 style={{ margin: "2px 0 18px", fontFamily: MONO, fontSize: 20, letterSpacing: 1, color: "#e7edf8" }}>{displayName.toUpperCase()}</h2>

      {body.linkedDocumentId ? (
        <>
          <div style={{ flex: 1, minHeight: 120, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(140,170,220,0.2)", borderRadius: 8, padding: 14, marginBottom: 14, overflowY: "auto" }}>
            <HostEmbed documentId={body.linkedDocumentId} view="fullscreen" className="min-h-0 flex-1 overflow-hidden [&>*]:h-full" />
          </div>
          <button type="button" onClick={() => onOpen(body.linkedDocumentId as string)} style={{ ...btn, border: "1px solid rgba(140,170,220,0.4)", background: "rgba(140,170,220,0.14)", color: "#e7edf8", marginBottom: 8 }}>
            OPEN FULL PAGE →
          </button>
        </>
      ) : (
        <p style={{ ...label, fontSize: 11, lineHeight: 1.6, opacity: 0.75, marginBottom: 14 }}>
          Not linked to a world entry yet.
        </p>
      )}

      {onViewSurface && (
        <button type="button" onClick={onViewSurface} style={{ padding: "7px 14px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.4)", background: "rgba(255,158,84,0.1)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, cursor: "pointer", marginBottom: 8 }}>
          🗺️ VIEW SURFACE →
        </button>
      )}

      {editing && (
        <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(140,170,220,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => onRename(nameDraft)}
            placeholder="Display name"
            style={{ padding: "6px 9px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.35)", background: "rgba(10,14,23,0.6)", color: "#c7d3e8", fontFamily: MONO, fontSize: 11 }}
          />
          {body.linkedDocumentId ? (
            <button type="button" onClick={onUnlink} style={{ ...btn, borderStyle: "dashed" }}>Unlink from entry</button>
          ) : linking ? (
            <WorldPicker onPick={(id, name) => { onLink(id, name); setLinking(false) }} />
          ) : (
            <button type="button" onClick={() => setLinking(true)} style={{ ...btn, borderStyle: "dashed" }}>Link to a world entry…</button>
          )}
          {emblemUrl ? (
            <button type="button" onClick={onRemoveEmblem} style={{ ...btn, borderStyle: "dashed" }}>Remove faction emblem</button>
          ) : (
            <button type="button" onClick={pickEmblem} style={{ ...btn, borderStyle: "dashed" }}>Set faction emblem</button>
          )}
          {body.modelMediaId ? (
            <button type="button" onClick={() => onRemoveModel("high")} style={{ ...btn, borderStyle: "dashed" }}>Remove 3D model (.glb)</button>
          ) : (
            <button type="button" onClick={() => pickModel("high")} style={{ ...btn, borderStyle: "dashed" }}>
              {body.kind === "sun" ? "Set Dyson Swarm Model (.glb)" : "Set 3D Model (.glb)"}
            </button>
          )}
          <button type="button" onClick={onRemove} style={{ ...btn, border: "1px solid rgba(224,122,122,0.4)", color: "#e07a7a" }}>Remove object</button>
        </div>
      )}
    </div>
  )
}

// The fullscreen star map — the WIKI'S HOMEPAGE, and now a single continuous
// 3D scene (no separate 2D mode). Camera orbit/pan/zoom is hand-rolled (no
// three.js "addons" — only the core `three` package is a guaranteed
// dependency here), continuous every frame (never an instant cut), and
// focusing a body flies the SAME camera in close rather than opening a
// separate popup — see the tick loop's camera-pose lerp below.
function SolarSystemHome({ T, title, bodies, editing, onOpen, onAddBody, onRemoveBody, onUpdateBody, onSeed, onShowClassic }: {
  T: ThemeSpec
  title: string
  bodies: SolarBody[]
  editing: boolean
  onOpen: (id: string) => void
  onAddBody: (body: Omit<SolarBody, "id">) => void
  onRemoveBody: (index: number) => void
  onUpdateBody: (index: number, patch: Partial<SolarBody>) => void
  onSeed: () => void
  onShowClassic: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [surfaceViewBodyId, setSurfaceViewBodyId] = useState<string | null>(null)
  const [artifactViewerUrl, setArtifactViewerUrl] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [hoveredTier, setHoveredTier] = useState<string | null>(null)
  const [visibleKinds, setVisibleKinds] = useState<Record<BodyKind, boolean>>({ sun: true, planet: true, moon: true, asteroid: true, station: true, ship: true, location: true })
  const visibleKindsRef = useRef(visibleKinds)
  visibleKindsRef.current = visibleKinds
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [showEmblems, setShowEmblems] = useState(true)
  const showEmblemsRef = useRef(showEmblems)
  showEmblemsRef.current = showEmblems
  const hoveredTierRef = useRef<string | null>(null)
  hoveredTierRef.current = hoveredTier
  const [distanceReadout, setDistanceReadout] = useState(4200)
  const media = useHostCapability("media")

  // Faction emblems are MEDIA REFERENCES — resolve each unique one to a URL
  // once, cache it.
  const [emblemUrls, setEmblemUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set(bodies.map((b) => b.emblemMediaId).filter((x): x is string => !!x)))
    const missing = ids.filter((id) => !(id in emblemUrls))
    if (missing.length === 0) return
    let alive = true
    Promise.all(missing.map((id) => media.resolve(id).then((url) => [id, url] as const))).then((pairs) => {
      if (!alive) return
      setEmblemUrls((prev) => {
        const next = { ...prev }
        pairs.forEach(([id, url]) => { if (url) next[id] = url })
        return next
      })
    })
    return () => { alive = false }
  }, [bodies, media, emblemUrls])

  // Custom 3D models (.glb) — same media-reference pattern as emblems.
  // DEV MODE: Support direct file paths for local development (starts with "/" or "./")
  // PROD MODE: Use VVD media references (resolved through media.resolve)
  const [modelUrls, setModelUrls] = useState<Record<string, string>>({})
  const modelUrlsRef = useRef(modelUrls)
  modelUrlsRef.current = modelUrls
  useEffect(() => {
    const ids = Array.from(new Set(bodies.map((b) => b.modelMediaId).filter((x): x is string => !!x)))
    const missing = ids.filter((id) => !(id in modelUrls))
    if (missing.length === 0) return
    let alive = true
    
    // Separate direct file paths from media IDs
    const directPaths = missing.filter((id) => id.startsWith("/") || id.startsWith("./") || id.startsWith("../"))
    const mediaIds = missing.filter((id) => !id.startsWith("/") && !id.startsWith("./") && !id.startsWith("../"))
    
    // Direct paths are used as-is (dev mode)
    const directPairs: [string, string][] = directPaths.map((path) => [path, path])
    
    // Media IDs are resolved through VVD (prod mode)
    const mediaPromise = mediaIds.length > 0 
      ? Promise.all(mediaIds.map((id) => media.resolve(id).then((url) => [id, url] as const)))
      : Promise.resolve([] as [string, string][])
    
    mediaPromise.then((mediaPairs) => {
      if (!alive) return
      const allPairs = [...directPairs, ...mediaPairs]
      setModelUrls((prev) => {
        const next = { ...prev }
        allPairs.forEach(([id, url]) => { if (url) next[id] = url })
        return next
      })
    })
    return () => { alive = false }
  }, [bodies, media, modelUrls])

  // Keep the latest props/callbacks in refs so the long-lived tick loop and
  // pointer handlers (set up once per scene build) always see the current
  // version without needing the whole 3D scene to be torn down every render.
  const bodiesRef = useRef(bodies)
  bodiesRef.current = bodies
  const editingRef = useRef(editing)
  editingRef.current = editing
  const focusedIndexRef = useRef(focusedIndex)
  focusedIndexRef.current = focusedIndex
  const onUpdateBodyRef = useRef(onUpdateBody)
  onUpdateBodyRef.current = onUpdateBody
  const emblemUrlsRef = useRef(emblemUrls)
  emblemUrlsRef.current = emblemUrls

  const sceneStateRef = useRef<any>(null)

  // ── Scene setup — rebuilds whenever the `bodies` array reference changes
  // (add/remove/edit). A few dozen meshes is cheap to recreate, so this
  // stays simple and correct rather than fine-grained-diffing the scene.
  useEffect(() => {
    let disposed = false
    ;(async () => {
      let THREE: any
      try {
        THREE = await import("three")
      } catch {
        return // no three.js available at runtime — the map stays blank rather than crashing
      }
      if (disposed || !canvasRef.current || !containerRef.current) return

      // Custom .glb models are optional and EXPERIMENTAL — this addon path
      // is not guaranteed to resolve in every bundler/three.js version. If
      // it fails, every custom-model feature below silently falls back to
      // the procedural geometry (sphere/hull/icosahedron/etc.) — nothing
      // else in the map depends on this succeeding.
      let GLTFLoaderCtor: any = null
      try {
        const mod: any = await import("three/addons/loaders/GLTFLoader.js")
        GLTFLoaderCtor = mod.GLTFLoader || null
      } catch {
        GLTFLoaderCtor = null
      }
      const gltfLoader = GLTFLoaderCtor ? new GLTFLoaderCtor() : null

      const canvas = canvasRef.current
      const container = containerRef.current
      const w = container.clientWidth || 1200
      const h = container.clientHeight || 700

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(w, h, false)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(52, w / h, 1, 26000)

      scene.add(new THREE.AmbientLight(0xffffff, 0.16))
      scene.add(new THREE.HemisphereLight(0x8ea6ff, 0x0a0e17, 0.35))
      const sunLight = new THREE.PointLight(0xfff2cc, 2.4, 0, 0)
      scene.add(sunLight)

      // A soft radial-gradient sprite texture (canvas-drawn, no shader
      // addon needed) — reused for the sun's glow, each planet's faint
      // atmosphere rim, and comet heads.
      const glowTexture = (() => {
        const size = 128
        const c = document.createElement("canvas")
        c.width = size
        c.height = size
        const ctx = c.getContext("2d")
        if (ctx) {
          const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
          g.addColorStop(0, "rgba(255,255,255,1)")
          g.addColorStop(0.35, "rgba(255,255,255,0.4)")
          g.addColorStop(1, "rgba(255,255,255,0)")
          ctx.fillStyle = g
          ctx.fillRect(0, 0, size, size)
        }
        return new THREE.CanvasTexture(c)
      })()
      const makeGlowSprite = (color: number | string, size: number, opacity: number) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }))
        sprite.scale.set(size, size, 1)
        return sprite
      }

      // Procedural planet surface — no external texture assets (no network
      // dependency, no CORS risk). Gas giants (larger bodies) get horizontal
      // bands; smaller/rocky bodies get a speckled, cratered look. Purely a
      // canvas noise pattern tinted from the body's own base color.
      const makeSurfaceTexture = (baseColor: string, gasGiant: boolean) => {
        const w = 256
        const h = gasGiant ? 128 : 256
        const c = document.createElement("canvas")
        c.width = w
        c.height = h
        const ctx = c.getContext("2d")
        if (!ctx) return null
        ctx.fillStyle = baseColor
        ctx.fillRect(0, 0, w, h)
        if (gasGiant) {
          const bandCount = 7 + Math.floor(Math.random() * 5)
          for (let i = 0; i < bandCount; i++) {
            const y = (i / bandCount) * h
            const bandH = h / bandCount
            ctx.globalAlpha = 0.25 + Math.random() * 0.35
            ctx.fillStyle = shadeHex(baseColor, Math.round((Math.random() - 0.5) * 70))
            ctx.fillRect(0, y, w, bandH * (0.6 + Math.random() * 0.5))
          }
          // A few soft swirl blotches for storm-like detail.
          for (let i = 0; i < 5; i++) {
            ctx.globalAlpha = 0.15 + Math.random() * 0.2
            ctx.fillStyle = shadeHex(baseColor, Math.round((Math.random() - 0.5) * 90))
            const x = Math.random() * w
            const y = Math.random() * h
            const r = 10 + Math.random() * 22
            ctx.beginPath()
            ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2)
            ctx.fill()
          }
        } else {
          for (let i = 0; i < 150; i++) {
            ctx.globalAlpha = 0.15 + Math.random() * 0.35
            ctx.fillStyle = shadeHex(baseColor, Math.round((Math.random() - 0.5) * 80))
            const x = Math.random() * w
            const y = Math.random() * h
            const r = 2 + Math.random() * 9
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.globalAlpha = 1
        const tex = new THREE.CanvasTexture(c)
        tex.wrapS = THREE.RepeatWrapping
        tex.needsUpdate = true
        return tex
      }

      // A flat map-pin icon (teardrop + punched hole), canvas-drawn — used
      // for surface-style location markers.
      const makePinTexture = (color: string) => {
        const size = 64
        const c = document.createElement("canvas")
        c.width = size
        c.height = size
        const ctx = c.getContext("2d")
        if (!ctx) return null
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(size / 2, size * 0.36, size * 0.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(size * 0.5 - size * 0.22, size * 0.46)
        ctx.lineTo(size * 0.5 + size * 0.22, size * 0.46)
        ctx.lineTo(size * 0.5, size * 0.92)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = "#0a0e17"
        ctx.beginPath()
        ctx.arc(size / 2, size * 0.36, size * 0.12, 0, Math.PI * 2)
        ctx.fill()
        return new THREE.CanvasTexture(c)
      }

      // ── Parallax starfield — genuine 3D depth (two shells at different
      // radii), so ordinary perspective gives correct parallax as the
      // camera moves — nothing faked.
      const makeStarLayer = (count: number, radius: number, size: number, opacity: number) => {
        const positions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          const u = Math.random()
          const v = Math.random()
          const theta = 2 * Math.PI * u
          const phi = Math.acos(2 * v - 1)
          const r = radius * (0.85 + Math.random() * 0.15)
          positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
          positions[i * 3 + 1] = r * Math.cos(phi)
          positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
        const mat = new THREE.PointsMaterial({ color: 0xc7d3e8, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false })
        return new THREE.Points(geo, mat)
      }
      const starNear = makeStarLayer(1400, 5200, 3.2, 0.85)
      const starFar = makeStarLayer(2200, 13000, 2.4, 0.5)
      scene.add(starNear)
      scene.add(starFar)

      // ── Tier bands — dashed rings on the orbital plane (y = 0), drawn at
      // their VISUALLY-scaled radius so they line up with where the
      // stretched-out bodies actually sit (tierLabelFor's classification
      // logic elsewhere still uses the raw logical radius — unaffected).
      TIER_BANDS.forEach((band) => {
        const visualRadius = visualFromLogicalRadius(band.radius)
        const pts: any[] = []
        for (let a = 0; a <= 96; a++) {
          const t = (a / 96) * Math.PI * 2
          pts.push(new THREE.Vector3(Math.cos(t) * visualRadius, 0, Math.sin(t) * visualRadius))
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        const mat = new THREE.LineDashedMaterial({ color: new THREE.Color(band.color), dashSize: 5, gapSize: 7, transparent: true, opacity: 0.55 })
        const line = new THREE.LineLoop(geo, mat)
        line.computeLineDistances()
        scene.add(line)
      })

      // Selecting a tier (legend or ring) washes its whole region with a
      // translucent color — one flat annulus per band, pre-built and hidden
      // by default, toggled by hoveredTierRef each frame in the tick loop.
      const tierHighlights: { id: string; mesh: any }[] = []
      TIER_BANDS.forEach((band, i) => {
        const innerLogical = i === 0 ? 0 : TIER_BANDS[i - 1].radius
        const innerR = visualFromLogicalRadius(innerLogical)
        const outerR = visualFromLogicalRadius(band.radius)
        const geo = new THREE.RingGeometry(innerR, outerR, 96, 1)
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(band.color), transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.visible = false
        scene.add(mesh)
        tierHighlights.push({ id: band.id, mesh })
      })

      // ── Belt dust — a genuine scattered band (not just a handful of
      // floating dots) for the asteroid belt and Kuiper belt. Purely
      // decorative and non-interactive (never added to meshEntries, so it's
      // automatically excluded from raycasting/clicking) — the individually
      // named asteroid bodies (Ceres, Pluto, etc.) remain the real,
      // clickable entries sitting among this dust.
      const makeBeltDust = (logicalInner: number, logicalOuter: number, count: number, colorHex: number, size: number, opacity: number) => {
        const inner = visualFromLogicalRadius(logicalInner)
        const outer = visualFromLogicalRadius(logicalOuter)
        const positions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          const r = inner + Math.random() * (outer - inner)
          const t = Math.random() * Math.PI * 2
          positions[i * 3] = Math.cos(t) * r
          positions[i * 3 + 1] = (Math.random() - 0.5) * (outer - inner) * 0.05
          positions[i * 3 + 2] = Math.sin(t) * r
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
        const mat = new THREE.PointsMaterial({ color: colorHex, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false })
        return new THREE.Points(geo, mat)
      }
      // Mercury debris field — shattered remnants in Mercury's orbital zone
      scene.add(makeBeltDust(55, 85, 600, 0x8f8a80, 1.0, 0.7))
      // Main asteroid belt
      scene.add(makeBeltDust(188, 242, 1100, 0x9aa4b2, 1.1, 0.65))
      // Kuiper belt
      scene.add(makeBeltDust(494, 586, 850, 0x8b9bd6, 1.0, 0.45))

      // Loads a .glb and uniformly scales it so its largest dimension
      // matches targetSize — without this, models authored at arbitrary
      // real-world scale would render as a speck or engulf the whole map.
      const loadNormalizedModel = (url: string, targetSize: number): Promise<any> =>
        new Promise((resolve, reject) => {
          if (!gltfLoader) { reject(new Error("no loader")); return }
          gltfLoader.load(
            url,
            (gltf: any) => {
              const root = gltf.scene || gltf.scenes[0]
              const box = new THREE.Box3().setFromObject(root)
              const size = new THREE.Vector3()
              box.getSize(size)
              const maxDim = Math.max(size.x, size.y, size.z) || 1
              root.scale.setScalar(targetSize / maxDim)
              resolve(root)
            },
            undefined,
            (err: any) => reject(err),
          )
        })

      // General per-body custom model support: simplified to single model
      const attachCustomModel = (b: SolarBody, proceduralVisual: any): any => {
        if (!gltfLoader || !b.modelMediaId) return null
        const anchor = new THREE.Group()
        anchor.add(proceduralVisual)
        const modelUrl = modelUrlsRef.current[b.modelMediaId]
        if (!modelUrl) return null
        const targetSize = Math.max(b.size * 2.2, 3)
        loadNormalizedModel(modelUrl, targetSize).then((obj) => {
          proceduralVisual.visible = false
          anchor.add(obj)
          anchor.userData.customModel = obj
        }).catch(() => {})
        return anchor
      }

      // ── Bodies
      const meshEntries: { body: SolarBody; mesh: any; ring: any | null; emblemSprite: any | null }[] = []
      const currentBodies = bodiesRef.current
      const textureLoader = new THREE.TextureLoader()

      currentBodies.forEach((b) => {
        let mesh: any
        if (b.kind === "sun") {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(b.size, 32, 32), new THREE.MeshBasicMaterial({ color: b.color }))
          // Layered soft glow (a few overlapping additive sprites at
          // different sizes/opacities) reads as a real bloom without any
          // post-processing pipeline.
          mesh.add(makeGlowSprite(b.color, b.size * 4.2, 0.55))
          mesh.add(makeGlowSprite(b.color, b.size * 2.6, 0.75))
          mesh.add(makeGlowSprite(0xfff6d8, b.size * 1.5, 0.9))

          const modelUrl = b.modelMediaId ? modelUrlsRef.current[b.modelMediaId] : null

          // Realistic Dyson swarm: dense ring of small satellites enclosing the sun
          // Each satellite faces inward with solar panels pointing toward sun
          const buildSwarm = (url: string, count: number, distance: number): any => {
            const group = new THREE.Group()
            if (!gltfLoader) return group
            // Smaller size for realistic satellite scale
            loadNormalizedModel(url, Math.max(b.size * 0.15, 0.8)).then((template) => {
              for (let i = 0; i < count; i++) {
                const inst = template.clone(true)
                const t = (i / count) * Math.PI * 2 + Math.random() * 0.05 // Even distribution with slight randomness
                const r = distance + (Math.random() - 0.5) * b.size * 0.2 // Tight ring
                const y = (Math.random() - 0.5) * b.size * 0.15 // Less vertical spread
                inst.position.set(Math.cos(t) * r, y, Math.sin(t) * r)
                
                // Point solar panels toward sun center (0,0,0)
                inst.lookAt(0, 0, 0)
                inst.rotateY(Math.PI) // 180° so panels face inward
                
                group.add(inst)
              }
            }).catch(() => {})
            return group
          }

          if (gltfLoader && modelUrl) {
            // Create multiple rings at different distances for realistic Dyson swarm effect
            const swarmRings = new THREE.Group()
            const rings = [
              { distance: b.size * 1.6, count: 180 },  // Inner ring
              { distance: b.size * 1.85, count: 220 }, // Middle ring
              { distance: b.size * 2.1, count: 260 },  // Outer ring
            ]
            rings.forEach(ring => {
              const ringGroup = buildSwarm(modelUrl, ring.count, ring.distance)
              swarmRings.add(ringGroup)
            })
            mesh.add(swarmRings)
            mesh.userData.swarm = swarmRings
          } else {
            // Fallback: a simple particle ring suggesting a Dyson swarm —
            // used until custom models are set (or if the GLTF loader addon
            // isn't available in this environment).
            const swarmCount = 220
            const swarmPos = new Float32Array(swarmCount * 3)
            for (let i = 0; i < swarmCount; i++) {
              const t = Math.random() * Math.PI * 2
              const r = b.size * 1.9 + Math.random() * b.size * 0.6
              swarmPos[i * 3] = Math.cos(t) * r
              swarmPos[i * 3 + 1] = (Math.random() - 0.5) * b.size * 0.3
              swarmPos[i * 3 + 2] = Math.sin(t) * r
            }
            const swarmGeo = new THREE.BufferGeometry()
            swarmGeo.setAttribute("position", new THREE.BufferAttribute(swarmPos, 3))
            const swarm = new THREE.Points(swarmGeo, new THREE.PointsMaterial({ color: 0xfff2cc, size: 1.6, transparent: true, opacity: 0.8 }))
            mesh.add(swarm)
          }
        } else if (b.kind === "station") {
          mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(b.size * 0.9, 2), 0), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0.4 }))
        } else if (b.kind === "ship") {
          // A dart-like hull (cylinder body + cone nose) — visually distinct
          // from a station's angular icosahedron.
          const group = new THREE.Group()
          const bodyLen = Math.max(b.size * 1.7, 3.4)
          const bodyRad = Math.max(b.size * 0.5, 1)
          const hullMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0.6 })
          const hull = new THREE.Mesh(new THREE.CylinderGeometry(bodyRad * 0.65, bodyRad, bodyLen * 0.62, 8), hullMat)
          hull.rotation.z = Math.PI / 2
          const nose = new THREE.Mesh(new THREE.ConeGeometry(bodyRad * 0.65, bodyLen * 0.42, 8), hullMat)
          nose.rotation.z = -Math.PI / 2
          nose.position.x = bodyLen * 0.5
          group.add(hull)
          group.add(nose)
          mesh = group
        } else if (b.kind === "location") {
          if (b.locationStyle === "surface") {
            // A flat, camera-facing 2D pin — like a map marker sitting on
            // the surface, not a 3D object orbiting it.
            const pinTex = makePinTexture(b.color)
            mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, transparent: true, depthWrite: false }))
            const s = Math.max(b.size * 3.2, 5)
            mesh.scale.set(s, s, 1)
          } else {
            // Orbital satellite / floating city — a small glowing 3D marker.
            mesh = new THREE.Mesh(
              new THREE.ConeGeometry(Math.max(b.size * 0.8, 1), Math.max(b.size * 1.9, 2.6), 6),
              new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.2, emissive: new THREE.Color(b.color), emissiveIntensity: 0.35 }),
            )
          }
        } else if (b.shattered) {
          // A broken debris cluster instead of a smooth sphere — several
          // small irregular chunks scattered within the body's own radius,
          // tumbling together as one loose swarm.
          const group = new THREE.Group()
          const chunkCount = 7
          for (let i = 0; i < chunkCount; i++) {
            const chunkSize = Math.max(b.size * (0.25 + pseudo(i * 3 + 1) * 0.32), 0.6)
            const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(chunkSize, 0), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.92, metalness: 0.05 }))
            const spread = b.size * 1.4
            chunk.position.set((pseudo(i * 7 + 2) - 0.5) * spread, (pseudo(i * 7 + 3) - 0.5) * spread * 0.35, (pseudo(i * 7 + 4) - 0.5) * spread)
            chunk.rotation.set(pseudo(i * 7 + 5) * 6.28, pseudo(i * 7 + 6) * 6.28, pseudo(i * 7 + 7) * 6.28)
            group.add(chunk)
          }
          mesh = group
        } else {
          const textured = b.kind === "planet" || b.kind === "moon"
          const surfaceTex = textured ? makeSurfaceTexture(b.color, b.size >= 10) : null
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(Math.max(b.size * 0.9, 1.2), 24, 24),
            new THREE.MeshStandardMaterial(surfaceTex ? { map: surfaceTex, roughness: 0.88, metalness: 0.05 } : { color: b.color, roughness: 0.85, metalness: 0.08 }),
          )
          if (b.kind === "planet") mesh.add(makeGlowSprite(b.color, b.size * 2.6, 0.22))
        }

        // Optional custom .glb — wraps the procedural visual in an anchor
        // so the swap happens without disturbing anything that already
        // references `mesh` (position updates, raycasting, emblem parent).
        // The sun has its own dedicated Dyson-swarm model handling below.
        if (b.kind !== "sun") {
          const wrapped = attachCustomModel(b, mesh)
          if (wrapped) mesh = wrapped
        }

        scene.add(mesh)

        // Emblem — a camera-facing sprite parented to the body's OWN mesh
        // (so it moves with it automatically). Positioned each frame (in
        // the tick loop) at a small camera-relative corner offset from the
        // body's center — clearly visible rather than occluded, and small/
        // close enough that it reads as "belonging" to this object without
        // reaching into neighboring bodies.
        let emblemSprite: any = null
        if (b.emblemMediaId) {
          const url = emblemUrlsRef.current[b.emblemMediaId]
          if (url) {
            const tex = textureLoader.load(url)
            emblemSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }))
            const s = Math.min(Math.max(b.size * 1.4, 7), 16)
            emblemSprite.scale.set(s, s, 1)
            mesh.add(emblemSprite)
          }
        }

        // Orbit ring — sun-centered for planets and unattached stations;
        // parent-centered (updated live each frame) for moons and attached
        // stations.
        // Orbit ring — sun-centered for planets and unattached
        // stations/ships; parent-centered (updated live each frame) for
        // moons, attached stations/ships, and locations.
        let ring: any | null = null
        if (b.kind === "planet" || ((b.kind === "station" || b.kind === "ship") && !b.parentId)) {
          const visualRadius = visualFromLogicalRadius(b.orbitRadius)
          const pts: any[] = []
          for (let a = 0; a <= 96; a++) { const t = (a / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * visualRadius, 0, Math.sin(t) * visualRadius)) }
          const geo = new THREE.BufferGeometry().setFromPoints(pts)
          const mat = new THREE.LineBasicMaterial({ color: 0x8caadc, transparent: true, opacity: 0.25 })
          ring = new THREE.LineLoop(geo, mat)
          scene.add(ring)
        } else if (b.kind === "moon" || b.kind === "location" || ((b.kind === "station" || b.kind === "ship") && b.parentId)) {
          const pts: any[] = []
          for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * b.orbitRadius, 0, Math.sin(t) * b.orbitRadius)) }
          const geo = new THREE.BufferGeometry().setFromPoints(pts)
          const mat = new THREE.LineDashedMaterial({ color: new THREE.Color(b.color), dashSize: 1.5, gapSize: 2.5, transparent: true, opacity: 0.32 })
          ring = new THREE.LineLoop(geo, mat)
          ring.computeLineDistances()
          scene.add(ring)
        }

        meshEntries.push({ body: b, mesh, ring, emblemSprite })
      })

      // ── Comets — purely decorative, ephemeral, local-only (like a camera
      // or a cursor — never synced, never part of the document). Trail
      // geometry is pre-allocated and mutated in place each frame rather
      // than recreated, to avoid per-frame garbage. The trail fades via
      // per-vertex color (brightest near the head) combined with additive
      // blending — dim colors read as "faded" against the near-black
      // background without needing true per-vertex alpha.
      type Comet = { group: any; head: any; trailGeo: any; velocity: any; life: number; maxLife: number; trail: { x: number; y: number; z: number }[] }
      const comets: Comet[] = []
      const cometColor = new THREE.Color(0xbfe6ff)
      const spawnComet = () => {
        const angle = Math.random() * Math.PI * 2
        const dist = 2600 + Math.random() * 500
        const start = new THREE.Vector3(Math.cos(angle) * dist, (Math.random() - 0.5) * 300, Math.sin(angle) * dist)
        const aimAngle = Math.random() * Math.PI * 2
        const aim = new THREE.Vector3(Math.cos(aimAngle) * (150 + Math.random() * 300), 0, Math.sin(aimAngle) * (150 + Math.random() * 300))
        const velocity = aim.clone().sub(start).normalize().multiplyScalar(220 + Math.random() * 120)

        const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xeaf7ff }))
        head.add(makeGlowSprite(0xbfe6ff, 26, 0.8))
        head.position.copy(start)
        const group = new THREE.Group()
        group.add(head)

        const maxPts = 30
        const trailGeo = new THREE.BufferGeometry()
        trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3))
        trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3))
        trailGeo.setDrawRange(0, 0)
        const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
        group.add(new THREE.Line(trailGeo, trailMat))

        scene.add(group)
        comets.push({ group, head, trailGeo, velocity, life: 0, maxLife: 9 + Math.random() * 5, trail: [] })
      }
      let nextCometAt = 20 + Math.random() * 25

      // ── Camera pose — the ONE thing driving the view. Manual drag/pan/
      // zoom mutate it directly; focusing a body sets a "desired" target the
      // SAME pose continuously lerps toward every frame — this is what makes
      // focusing a continuous fly-in rather than a cut, and also means a
      // focused body's own orbital motion is smoothly followed.
      const pose = { azimuth: 0.9, elevation: 0.5, distance: 4200, target: new THREE.Vector3(0, 0, 0) }
      const free = { distance: 4200, target: new THREE.Vector3(0, 0, 0) }

      const raycaster = new THREE.Raycaster()
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const ndc = new THREE.Vector2()

      let dragMode: "none" | "orbit" | "pan" | "reposition" = "none"
      let dragBodyEntry: { body: SolarBody; mesh: any; ring: any | null } | null = null
      let dragBodyIndex = -1
      let dragPreview: { orbitRadius: number; angleOffset: number } | null = null
      let lastX = 0
      let lastY = 0
      let moved = 0

      const pointFromEvent = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect()
        ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
        ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      }

      const pickBody = (clientX: number, clientY: number) => {
        pointFromEvent(clientX, clientY)
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObjects(meshEntries.map((m) => m.mesh), true)
        if (hits.length === 0) return -1
        let obj = hits[0].object
        while (obj && !meshEntries.some((m) => m.mesh === obj)) obj = obj.parent
        return meshEntries.findIndex((m) => m.mesh === obj)
      }

      const onContextMenu = (e: Event) => e.preventDefault()

      const onPointerDown = (e: PointerEvent) => {
        lastX = e.clientX
        lastY = e.clientY
        moved = 0
        const rawIdx = editingRef.current ? pickBody(e.clientX, e.clientY) : -1
        // Sun is now locked and cannot be repositioned
        const idx = rawIdx >= 0 && meshEntries[rawIdx].body.kind !== "sun" ? rawIdx : -1
        if (idx >= 0 && editingRef.current) {
          dragMode = "reposition"
          dragBodyEntry = meshEntries[idx]
          dragBodyIndex = idx
          dragPreview = null
        } else if (e.button === 2 || e.button === 1 || e.shiftKey) {
          dragMode = "pan"
        } else {
          dragMode = "orbit"
        }
      }

      const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
        moved += Math.abs(dx) + Math.abs(dy)

        if (dragMode === "orbit") {
          pose.azimuth -= dx * 0.006
          pose.elevation = Math.min(1.5, Math.max(0.05, pose.elevation + dy * 0.006))
        } else if (dragMode === "pan") {
          const forward = new THREE.Vector3()
          camera.getWorldDirection(forward)
          const worldUp = new THREE.Vector3(0, 1, 0)
          const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
          const camUp = new THREE.Vector3().crossVectors(right, forward).normalize()
          const panScale = pose.distance * 0.0016
          pose.target.addScaledVector(right, -dx * panScale)
          pose.target.addScaledVector(camUp, dy * panScale)
          if (focusedIndexRef.current == null) free.target.copy(pose.target)
        } else if (dragMode === "reposition" && dragBodyEntry) {
          pointFromEvent(e.clientX, e.clientY)
          raycaster.setFromCamera(ndc, camera)
          const hit = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(groundPlane, hit)) {
            const b = dragBodyEntry.body
            const visualPositions = computeVisualPositions(bodiesRef.current, orbitClockMs)
            const parentPos = b.parentId ? visualPositions.get(b.parentId) || { x: 0, y: 0 } : { x: 0, y: 0 }
            const rawParams = ownParamsForPoint({ x: hit.x, y: hit.z }, parentPos, b.periodSeconds, orbitClockMs)
            // A sun-orbiting body's distance was STRETCHED for display — undo
            // that to get back the logical orbitRadius actually stored. A
            // moon/attached-station's local offset was never stretched, so
            // it's already correct as-is.
            const params = b.parentId ? rawParams : { orbitRadius: logicalFromVisualRadius(rawParams.orbitRadius), angleOffset: rawParams.angleOffset }
            dragPreview = params
            dragBodyEntry.mesh.position.set(hit.x, 0, hit.z)
            if (dragBodyEntry.ring) {
              dragBodyEntry.ring.position.set(parentPos.x, 0, parentPos.y)
              const ringRadius = b.parentId ? params.orbitRadius : rawParams.orbitRadius
              const posAttr = dragBodyEntry.ring.geometry.getAttribute("position")
              for (let a = 0; a < posAttr.count; a++) {
                const t = (a / (posAttr.count - 1)) * Math.PI * 2
                posAttr.setXYZ(a, Math.cos(t) * ringRadius, 0, Math.sin(t) * ringRadius)
              }
              posAttr.needsUpdate = true
              if (dragBodyEntry.ring.computeLineDistances) dragBodyEntry.ring.computeLineDistances()
            }
          }
        }
      }

      const onPointerUp = (e: PointerEvent) => {
        if (dragMode === "reposition" && dragBodyEntry && dragPreview) {
          onUpdateBodyRef.current(dragBodyIndex, { orbitRadius: dragPreview.orbitRadius, angleOffset: dragPreview.angleOffset })
        } else if (moved < 6) {
          // Check for clicks on individual Dyson swarm craft first
          pointFromEvent(e.clientX, e.clientY)
          raycaster.setFromCamera(ndc, camera)
          const allHits = raycaster.intersectObjects(meshEntries.map((m) => m.mesh), true)
          
          // Check if we clicked on a Dyson swarm craft (child of sun's swarm group)
          if (allHits.length > 0) {
            const hit = allHits[0]
            let obj = hit.object
            let foundSwarmCraft = false
            
            // Walk up parent chain looking for swarm group
            while (obj && !foundSwarmCraft) {
              const parent = obj.parent
              if (parent && parent.userData && parent.userData.swarm) {
                // We clicked a Dyson swarm craft!
                const sunEntry = meshEntries.find((m) => m.body.kind === "sun")
                if (sunEntry && sunEntry.body.modelMediaId) {
                  setArtifactViewerUrl(modelUrlsRef.current[sunEntry.body.modelMediaId] || null)
                  foundSwarmCraft = true
                }
                break
              }
              obj = parent
            }
            
            if (!foundSwarmCraft) {
              // Regular body click
              const idx = pickBody(e.clientX, e.clientY)
              if (idx >= 0) setFocusedIndex(idx)
              else if (focusedIndexRef.current != null) setFocusedIndex(null)
            }
          } else {
            // No hits, clear focus
            if (focusedIndexRef.current != null) setFocusedIndex(null)
          }
        }
        dragMode = "none"
        dragBodyEntry = null
        dragBodyIndex = -1
        dragPreview = null
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        pose.distance = Math.min(12000, Math.max(15, pose.distance * (e.deltaY > 0 ? 1.1 : 0.9)))
        if (focusedIndexRef.current == null) free.distance = pose.distance
      }

      // Touch controls for mobile/handheld devices
      let touches: Map<number, { x: number; y: number }> = new Map()
      let initialPinchDistance = 0

      const onTouchStart = (e: TouchEvent) => {
        e.preventDefault()
        Array.from(e.touches).forEach(t => {
          touches.set(t.identifier, { x: t.clientX, y: t.clientY })
        })
        if (e.touches.length === 2) {
          const t0 = e.touches[0]
          const t1 = e.touches[1]
          const dx = t1.clientX - t0.clientX
          const dy = t1.clientY - t0.clientY
          initialPinchDistance = Math.sqrt(dx * dx + dy * dy)
        }
      }

      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        if (e.touches.length === 1) {
          // Single finger: rotate camera (orbit)
          const t = e.touches[0]
          const prev = touches.get(t.identifier)
          if (prev) {
            const dx = t.clientX - prev.x
            const dy = t.clientY - prev.y
            pose.azimuth -= dx * 0.008
            pose.elevation = Math.min(1.5, Math.max(0.05, pose.elevation + dy * 0.008))
            touches.set(t.identifier, { x: t.clientX, y: t.clientY })
          }
        } else if (e.touches.length === 2) {
          // Two fingers: pinch to zoom
          const t0 = e.touches[0]
          const t1 = e.touches[1]
          const dx = t1.clientX - t0.clientX
          const dy = t1.clientY - t0.clientY
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (initialPinchDistance > 0) {
            const scale = initialPinchDistance / distance
            pose.distance = Math.min(12000, Math.max(15, pose.distance * scale))
            if (focusedIndexRef.current == null) free.distance = pose.distance
          }
          initialPinchDistance = distance
        }
      }

      const onTouchEnd = (e: TouchEvent) => {
        e.preventDefault()
        Array.from(e.changedTouches).forEach(t => {
          touches.delete(t.identifier)
        })
        if (e.touches.length < 2) {
          initialPinchDistance = 0
        }
      }

      canvas.addEventListener("pointerdown", onPointerDown)
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", onPointerUp)
      canvas.addEventListener("wheel", onWheel, { passive: false })
      canvas.addEventListener("contextmenu", onContextMenu)
      canvas.addEventListener("touchstart", onTouchStart, { passive: false })
      canvas.addEventListener("touchmove", onTouchMove, { passive: false })
      canvas.addEventListener("touchend", onTouchEnd, { passive: false })

      const closeDistanceFor = (b: SolarBody) => Math.max(b.size * 11, 45)
      const camDir = new THREE.Vector3()
      const clock = new THREE.Clock()
      let raf = 0
      let lastReadout = 0
      // A pausable orbit clock — when paused, this simply stops advancing,
      // freezing every body's computed position exactly where it is. The
      // camera, comets-in-flight-visuals, and rendering keep working.
      let orbitClockMs = Date.now()

      const tick = () => {
        if (disposed) return
        const dt = Math.min(clock.getDelta(), 0.1)
        if (!pausedRef.current) orbitClockMs += dt * 1000
        const now = orbitClockMs
        const positions = computeVisualPositions(bodiesRef.current, now)
        const focusedBody = focusedIndexRef.current != null ? bodiesRef.current[focusedIndexRef.current] || null : null
        const focusedBodyId = focusedBody ? focusedBody.id : null
        // A location only reveals once you've actually arrived close on its
        // specific parent — not just "focused" (which starts the fly-in
        // from far away). "Close" means the camera has settled near that
        // body's own close-focus framing distance.
        const superZoomed = focusedBody != null && pose.distance < closeDistanceFor(focusedBody) * 1.4

        // Camera-relative right/up, used to offset each emblem sprite to a
        // corner of its body rather than dead-center (see emblem creation
        // comment above) — computed once per frame, reused for every body.
        const camRight = new THREE.Vector3()
        const camUp = new THREE.Vector3()
        {
          const fwd = new THREE.Vector3()
          camera.getWorldDirection(fwd)
          camRight.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
          camUp.crossVectors(camRight, fwd).normalize()
        }

        meshEntries.forEach((entry) => {
          if (dragBodyEntry === entry) return // being dragged live — position already set imperatively above
          // A "location" (colony/satellite/floating city) only shows once
          // you're genuinely zoomed in close on its specific parent.
          const locationGate = entry.body.kind !== "location" || (entry.body.parentId === focusedBodyId && superZoomed)
          const visible = visibleKindsRef.current[entry.body.kind] && locationGate
          entry.mesh.visible = visible
          if (entry.ring) entry.ring.visible = visible
          if (!visible) return
          const pos = positions.get(entry.body.id) || { x: 0, y: 0 }
          entry.mesh.position.set(pos.x, 0, pos.y)
          const thisIsFocused = focusedBodyId === entry.body.id
          if (entry.body.kind === "sun") {
            sunLight.position.set(pos.x, 0, pos.y)
            // Dyson swarm is always visible (single model, no LOD switching)
          } else if (entry.mesh.userData.customModel) {
            // Custom model for non-sun bodies (no LOD switching)
          }
          if (entry.ring && (entry.body.kind === "moon" || entry.body.kind === "location" || ((entry.body.kind === "station" || entry.body.kind === "ship") && entry.body.parentId))) {
            const parentPos = entry.body.parentId ? positions.get(entry.body.parentId) || { x: 0, y: 0 } : { x: 0, y: 0 }
            entry.ring.position.set(parentPos.x, 0, parentPos.y)
          }
          entry.mesh.rotation.y += dt * 0.15
          if (entry.emblemSprite) {
            entry.emblemSprite.visible = showEmblemsRef.current
            if (showEmblemsRef.current) {
              const off = Math.min(Math.max(entry.body.size * 0.9, 5), 12)
              entry.emblemSprite.position.set(0, 0, 0)
              entry.emblemSprite.position.addScaledVector(camRight, off)
              entry.emblemSprite.position.addScaledVector(camUp, off)
            }
          }
        })

        // Tier region highlight — a translucent wash over whichever tier
        // band is currently selected (legend click or ring click).
        tierHighlights.forEach((h) => { h.mesh.visible = hoveredTierRef.current === h.id })

        // Comets — occasional spawn, straight-line travel, fading trail.
        if (!pausedRef.current) {
          nextCometAt -= dt
          if (nextCometAt <= 0) { spawnComet(); nextCometAt = 25 + Math.random() * 30 }
          for (let i = comets.length - 1; i >= 0; i--) {
            const c = comets[i]
            c.life += dt
            c.head.position.addScaledVector(c.velocity, dt)
            c.trail.push({ x: c.head.position.x, y: c.head.position.y, z: c.head.position.z })
            if (c.trail.length > 30) c.trail.shift()
            const posAttr = c.trailGeo.getAttribute("position")
            const colAttr = c.trailGeo.getAttribute("color")
            const n = c.trail.length
            for (let j = 0; j < n; j++) {
              posAttr.setXYZ(j, c.trail[j].x, c.trail[j].y, c.trail[j].z)
              const t = n > 1 ? j / (n - 1) : 1 // 0 = oldest/tail (dim), 1 = newest/head (bright)
              const brightness = Math.pow(t, 1.6)
              colAttr.setXYZ(j, cometColor.r * brightness, cometColor.g * brightness, cometColor.b * brightness)
            }
            posAttr.needsUpdate = true
            colAttr.needsUpdate = true
            c.trailGeo.setDrawRange(0, n)
            if (c.life > c.maxLife) {
              scene.remove(c.group)
              comets.splice(i, 1)
            }
          }
        }

        // Slow starfield drift for a subtle ambient sense of motion.
        starNear.rotation.y += dt * 0.002
        starFar.rotation.y += dt * 0.001

        // Camera pose — continuously lerp toward the desired state (free
        // pan/zoom target normally, or the focused body's live position).
        let desiredTarget = free.target
        let desiredDistance = free.distance
        if (focusedBody) {
          const p = positions.get(focusedBody.id) || { x: 0, y: 0 }
          desiredTarget = new THREE.Vector3(p.x, 0, p.y)
          desiredDistance = closeDistanceFor(focusedBody)
        }
        const lerpFactor = 1 - Math.exp(-dt * 2.4)
        pose.target.lerp(desiredTarget, lerpFactor)
        pose.distance += (desiredDistance - pose.distance) * lerpFactor

        const camX = pose.target.x + pose.distance * Math.cos(pose.elevation) * Math.sin(pose.azimuth)
        const camY = pose.target.y + pose.distance * Math.sin(pose.elevation)
        const camZ = pose.target.z + pose.distance * Math.cos(pose.elevation) * Math.cos(pose.azimuth)
        camera.position.set(camX, camY, camZ)
        camera.lookAt(pose.target)
        camera.getWorldDirection(camDir)

        // Labels — projected each frame, positioned imperatively (bypasses
        // React state for smoothness).
        const rect = canvas.getBoundingClientRect()
        meshEntries.forEach((entry) => {
          const el = labelRefs.current.get(entry.body.id)
          if (!el) return
          const locationGate = entry.body.kind !== "location" || (entry.body.parentId === focusedBodyId && superZoomed)
          if (!visibleKindsRef.current[entry.body.kind] || !locationGate) { el.style.display = "none"; return }
          const showAlways = entry.body.kind === "planet" || entry.body.kind === "station" || entry.body.kind === "ship" || entry.body.kind === "sun" || entry.body.kind === "location"
          const showMoon = entry.body.kind === "moon" && pose.distance < 220
          if (!showAlways && !showMoon) { el.style.display = "none"; return }
          const worldPos = entry.mesh.position
          const toPoint = worldPos.clone().sub(camera.position)
          if (toPoint.dot(camDir) <= 0) { el.style.display = "none"; return }
          const v = worldPos.clone().project(camera)
          if (v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = "none"; return }
          const x = (v.x * 0.5 + 0.5) * rect.width
          const y = (-v.y * 0.5 + 0.5) * rect.height
          el.style.display = "block"
          el.style.transform = "translate(" + x + "px, " + y + "px)"
        })

        renderer.render(scene, camera)

        lastReadout += dt
        if (lastReadout > 0.3) {
          lastReadout = 0
          setDistanceReadout(Math.round(pose.distance))
        }

        raf = requestAnimationFrame(tick)
      }
      tick()

      sceneStateRef.current = {
        cleanup: () => {
          canvas.removeEventListener("pointerdown", onPointerDown)
          window.removeEventListener("pointermove", onPointerMove)
          window.removeEventListener("pointerup", onPointerUp)
          canvas.removeEventListener("wheel", onWheel)
          canvas.removeEventListener("contextmenu", onContextMenu)
          canvas.removeEventListener("touchstart", onTouchStart)
          canvas.removeEventListener("touchmove", onTouchMove)
          canvas.removeEventListener("touchend", onTouchEnd)
          cancelAnimationFrame(raf)
          // renderer.dispose() alone does NOT free geometries/materials/
          // textures created while building the scene — only the renderer's
          // own internal caches. Without walking the scene and disposing
          // everything explicitly, every rebuild (any body add/remove/edit,
          // or remounting after leaving All Entries) leaks GPU memory that
          // compounds over a session.
          scene.traverse((obj: any) => {
            if (obj.geometry) obj.geometry.dispose()
            const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
            mats.forEach((m: any) => {
              if (m.map) m.map.dispose()
              m.dispose()
            })
          })
          glowTexture.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
        },
        setSize: (nw: number, nh: number) => {
          renderer.setSize(nw, nh, false)
          camera.aspect = nw / nh
          camera.updateProjectionMatrix()
        },
      }
    })()

    return () => {
      disposed = true
      sceneStateRef.current?.cleanup?.()
      sceneStateRef.current = null
    }
  }, [bodies])

  // Resize handling — updates the existing renderer/camera without a full
  // scene rebuild (the ultrawide fix: the camera's own aspect now always
  // matches the real container, so nothing is ever letterboxed with empty
  // gutters on a wide screen).
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      if (box.width > 0 && box.height > 0) sceneStateRef.current?.setSize?.(box.width, box.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const focused = focusedIndex != null ? bodies[focusedIndex] : null
  const attachableBodies = useMemo(
    () => bodies
      .filter((b) => b.kind === "planet" || b.kind === "moon" || b.kind === "station" || b.kind === "ship")
      .map((b) => ({ id: b.id, name: b.linkedDocumentName || b.name, size: b.size })),
    [bodies],
  )

  const statChip = { padding: "4px 10px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.3)", color: "#9fb0cc", fontFamily: MONO, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" as const, whiteSpace: "nowrap" as const }
  const monoBtn = { padding: "5px 11px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.35)", background: "rgba(10,14,23,0.5)", color: "#c7d3e8", cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase" as const }

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "radial-gradient(ellipse at 50% 46%, #0d1424 0%, #070a12 55%, #04050a 100%)" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none" }} />

      {/* Label overlay — plain divs positioned imperatively by the tick loop, not React state, for smoothness */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
        {bodies.map((b) => (
          <div
            key={b.id}
            ref={(el) => { if (el) labelRefs.current.set(b.id, el); else labelRefs.current.delete(b.id) }}
            style={{ position: "absolute", left: 0, top: 0, display: "none", fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.5, color: "#c7d3e8", whiteSpace: "nowrap", paddingLeft: 10 }}
          >
            {(b.linkedDocumentName || b.name || "UNNAMED").toUpperCase()}
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderBottom: "1px solid rgba(140,170,220,0.2)", background: "linear-gradient(rgba(6,8,16,0.7), rgba(6,8,16,0.1))", zIndex: 3, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, border: "1px solid rgba(140,170,220,0.4)", borderRadius: 3, fontFamily: MONO, fontSize: 11, color: "#c7d3e8" }}>
            {(title || NAME).slice(0, 2).toUpperCase()}
          </span>
          <span>
            <span style={{ display: "block", fontFamily: MONO, fontSize: 13, letterSpacing: 2, color: "#e7edf8", fontWeight: 700 }}>{title.toUpperCase()}</span>
            <span style={{ display: "block", fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: "#7186a8", marginTop: 2 }}>SOLAR ATLAS · LIVE NODE</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={statChip}><span style={{ color: "#59d98e" }}>●</span> CHART ONLINE</span>
          <span style={statChip}>NODES {bodies.length}</span>
          <span style={statChip}>DIST {distanceReadout}</span>
          <button type="button" onClick={() => setPaused((p) => !p)} style={monoBtn}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button type="button" onClick={() => setShowEmblems((s) => !s)} style={{ ...monoBtn, opacity: showEmblems ? 1 : 0.55 }}>
            ⚑ Emblems
          </button>
          <button type="button" onClick={onShowClassic} style={monoBtn}>☰ All Entries</button>
          {editing && <button type="button" onClick={onSeed} style={monoBtn}>⨁ Seed</button>}
          {editing && <button type="button" onClick={() => setAdding((a) => !a)} style={monoBtn}>+ Add Object</button>}
        </div>
      </div>

      {adding && <AddObjectPanel bodies={bodies} attachable={attachableBodies} onAdd={onAddBody} onClose={() => setAdding(false)} />}

      <div style={{ position: "absolute", left: 18, bottom: 14, display: "flex", flexDirection: "column", gap: 4, zIndex: 2 }}>
        {TIER_BANDS.map((band) => {
          const active = hoveredTier === band.id
          return (
            <button
              key={band.id}
              type="button"
              onClick={() => setHoveredTier(active ? null : band.id)}
              style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 9, letterSpacing: 0.8, color: active ? "#e7edf8" : "#8a9bbc", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              <span style={{ width: 14, height: 0, borderTop: (active ? "3px" : "2px") + " solid " + band.color }} />{band.label}
            </button>
          )
        })}
        {hoveredTier && (
          <div style={{ marginTop: 6, maxWidth: 260, padding: "8px 10px", borderRadius: 4, border: "1px solid rgba(140,170,220,0.3)", background: "rgba(8,11,19,0.9)", fontFamily: MONO, fontSize: 10, lineHeight: 1.5, color: "#c7d3e8" }}>
            {TIER_DESCRIPTIONS[hoveredTier]}
          </div>
        )}
      </div>

      <div style={{ position: "absolute", right: 18, bottom: 14, display: "flex", flexDirection: "column", gap: 4, zIndex: 2, alignItems: "flex-end" }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.2, color: "#5c6d8c", marginBottom: 2 }}>LAYERS</span>
        {(["sun", "planet", "moon", "asteroid", "station", "ship", "location"] as BodyKind[]).map((k) => {
          const on = visibleKinds[k]
          return (
            <button
              key={k}
              type="button"
              onClick={() => setVisibleKinds((v) => ({ ...v, [k]: !v[k] }))}
              style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.8, color: on ? "#c7d3e8" : "#4a5468", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, border: "1px solid " + (on ? "#c7d3e8" : "#4a5468"), background: on ? "#c7d3e8" : "transparent" }} />
              {k.toUpperCase()}{k !== "sun" ? "S" : ""}
            </button>
          )
        })}
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, color: "#5c6d8c", zIndex: 2 }}>
        DRAG TO ORBIT · RIGHT-DRAG (OR SHIFT-DRAG) TO PAN · SCROLL TO ZOOM · CLICK A NODE TO OPEN
        {editing ? " · DRAG A NODE TO REPOSITION" : ""}
      </div>

      {bodies.length === 0 && !editing && (
        <p style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: 0, opacity: 0.5, fontSize: 13, fontFamily: MONO, color: "#8a9bbc", zIndex: 2, pointerEvents: "none" }}>
          NO NODES CHARTED YET
        </p>
      )}

      {focused && (
        <BodySidePanel
          body={focused}
          tierLabel={labelForBody(focused, bodies)}
          editing={editing}
          emblemUrl={focused.emblemMediaId ? emblemUrls[focused.emblemMediaId] || null : null}
          onBack={() => setFocusedIndex(null)}
          onOpen={(id) => { setFocusedIndex(null); onOpen(id) }}
          onRename={(name) => focusedIndex != null && onUpdateBody(focusedIndex, { name })}
          onLink={(id, name) => focusedIndex != null && onUpdateBody(focusedIndex, { linkedDocumentId: id, linkedDocumentName: name })}
          onUnlink={() => focusedIndex != null && onUpdateBody(focusedIndex, { linkedDocumentId: null, linkedDocumentName: null })}
          onRemove={() => { if (focusedIndex != null) onRemoveBody(focusedIndex); setFocusedIndex(null) }}
          onSetEmblem={(mediaId) => focusedIndex != null && onUpdateBody(focusedIndex, { emblemMediaId: mediaId })}
          onRemoveEmblem={() => focusedIndex != null && onUpdateBody(focusedIndex, { emblemMediaId: null })}
          onSetModel={(which, mediaId) => focusedIndex != null && onUpdateBody(focusedIndex, { modelMediaId: mediaId })}
          onRemoveModel={(which) => focusedIndex != null && onUpdateBody(focusedIndex, { modelMediaId: null })}
          onViewSurface={null}
        />
      )}

      {surfaceViewBodyId && (() => {
        const surfaceBody = bodies.find((b) => b.id === surfaceViewBodyId)
        if (!surfaceBody) return null
        const pins = bodies.filter((b) => b.kind === "location" && b.locationStyle === "surface" && b.parentId === surfaceBody.id)
        return (
          <SurfaceView
            body={surfaceBody}
            locations={pins}
            onOpenPin={(loc) => { if (loc.linkedDocumentId) { setSurfaceViewBodyId(null); setFocusedIndex(null); onOpen(loc.linkedDocumentId) } }}
            onBack={() => setSurfaceViewBodyId(null)}
          />
        )
      })()}

      {artifactViewerUrl && (
        <ArtifactViewer
          modelUrl={artifactViewerUrl}
          artifactName="Dyson Swarm Collector"
          onBack={() => setArtifactViewerUrl(null)}
        />
      )}
    </div>
  )
}
type PageState = {
  title: string
  subtitle: string
  bannerMediaId: string
  sectionOrder: string[]
  featuredIds: string[]
  solarBodies: SolarBody[]
}
const EMPTY_PAGE: PageState = { title: "", subtitle: "", bannerMediaId: "", sectionOrder: [], featuredIds: [], solarBodies: [] }

type PageActions = {
  setText: (key: "title" | "subtitle", value: string) => void
  setBanner: (mediaId: string) => void
  moveSection: (key: string, dir: number) => void
  toggleFeatured: (id: string) => void
  addBody: (body: Omit<SolarBody, "id">) => void
  removeBody: (index: number) => void
  updateBody: (index: number, patch: Partial<SolarBody>) => void
  seedSolarSystem: () => void
}

function WikiPage({ editing, values, page, actions, entryPath }: {
  editing: boolean
  values: AppCustomizationValues
  page: PageState
  actions: PageActions | null
  entryPath: string | null
}) {
  const meta = useWorldMeta()
  const docs = useWorldQuery("documents")
  const media = useHostCapability("media")
  const scope = useHostCapability("scope")
  const hostTheme = useHostTheme()
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [entriesShown, setEntriesShown] = useState(60)
  const [classicView, setClassicView] = useState(false)

  const themeId = resolveCustomizationChoice(THEME_PARAM, values)
  const preset = THEME_PARAM.presets.find((p) => p.id === themeId) || THEME_PARAM.presets[0]
  const T = themeId === WORLD_THEME_ID ? worldTheme(hostTheme) : themeFromPreset(preset)
  const BODY_FF = chosenFont(WIKI_BODY_FONT_PARAM, resolveCustomizationChoice(WIKI_BODY_FONT_PARAM, values)) || font(T)
  const HEAD_FF = chosenFont(WIKI_HEADING_FONT_PARAM, resolveCustomizationChoice(WIKI_HEADING_FONT_PARAM, values)) || "inherit"

  const title = page.title.trim() || (meta ? meta.name : NAME)
  const subtitle = page.subtitle.trim() || (meta && meta.description) || ""
  const order = page.sectionOrder.length > 0 ? page.sectionOrder : DEFAULT_SECTIONS
  const featuredIds = page.featuredIds

  const bannerId = page.bannerMediaId
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!bannerId) { setBannerUrl(null); return }
    let on = true
    setBannerUrl(media.placeholder(bannerId))
    media.resolve(bannerId).then((url) => { if (on && url) setBannerUrl(url) })
    return () => { on = false }
  }, [bannerId, media])
  const pickBanner = async () => {
    if (!media.pick || !actions) return
    const picked = await media.pick({ worldId: scope.worldId, accept: ["image/*"] })
    if (picked) actions.setBanner(picked.id)
  }

  useEffect(() => {
    if (!entryPath) return
    const slug = decodeURIComponent(entryPath.startsWith("/") ? entryPath.slice(1) : entryPath)
    if (!slug) return
    const hit = docs.find((d) => (d.slug || d.id) === slug)
    if (hit) { setOpenId(hit.id); setClassicView(true) }
  }, [entryPath, docs])

  const moveSection = (key: string, dir: number) => actions?.moveSection(key, dir)
  const toggleFeatured = (id: string) => actions?.toggleFeatured(id)

  const cards = useMemo(() => docs.filter((d) => d.documentType === "card" && d.isViewable !== false), [docs])
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((d) => (d.name || "").toLowerCase().includes(q) || (d.aliases || []).some((a) => a.toLowerCase().includes(q)))
  }, [cards, query])
  const featured = useMemo(
    () => featuredIds.map((id) => cards.find((d) => d.id === id)).filter((d): d is (typeof cards)[number] => d != null),
    [featuredIds, cards],
  )
  const extras = useMemo(() => docs.filter((d) => d.documentType !== "card"), [docs])
  const open = openId ? docs.find((d) => d.id === openId) : null

  const chip = { padding: "5px 12px", borderRadius: 999, border: "1px solid " + T.line, background: "transparent", color: T.ink, cursor: "pointer", font: "inherit", fontSize: 13 } as const
  const editChip = { ...chip, borderStyle: "dashed", opacity: 0.85 } as const

  const entryCard = (d: (typeof cards)[number], big: boolean) => (
    <div key={d.id} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpenId(d.id)}
        style={{ width: "100%", textAlign: "left", padding: big ? 16 : 12, borderRadius: 12, border: "1px solid " + T.line, background: T.card, color: T.ink, cursor: "pointer", font: "inherit" }}>
        <span style={{ display: "grid", placeItems: "center", width: big ? 42 : 34, height: big ? 42 : 34, borderRadius: 9, marginBottom: 8, background: T.accent, color: "#fff", fontWeight: 700 }}>
          {d.name ? d.name.slice(0, 1).toUpperCase() : ""}
        </span>
        <span style={{ display: "block", fontWeight: 600, fontSize: big ? 16 : 14, lineHeight: 1.3 }}>{d.name || "Untitled"}</span>
      </button>
      {editing && (
        <button type="button" onClick={() => toggleFeatured(d.id)}
          title={featuredIds.includes(d.id) ? "Remove from Featured" : "Add to Featured"}
          style={{ position: "absolute", top: 6, right: 6, display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", border: "1px solid " + T.line, background: T.bg, color: featuredIds.includes(d.id) ? T.accent : T.ink, cursor: "pointer", opacity: featuredIds.includes(d.id) ? 1 : 0.55 }}>
          <HostIcon icon="star" size={13} />
        </button>
      )}
    </div>
  )

  const sectionHead = (key: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
      <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.55, fontFamily: HEAD_FF }}>{SECTION_NAMES[key] || key}</h3>
      {editing && (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <button type="button" onClick={() => moveSection(key, -1)} title="Move section up" style={{ ...chip, padding: "1px 8px" }}>↑</button>
          <button type="button" onClick={() => moveSection(key, 1)} title="Move section down" style={{ ...chip, padding: "1px 8px" }}>↓</button>
        </span>
      )}
    </div>
  )

  const sections: Record<string, ReactNode> = {
    featured: featured.length > 0 || editing ? (
      <section key="featured" style={{ marginBottom: 26 }}>
        {sectionHead("featured")}
        {featured.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {featured.map((d) => entryCard(d, true))}
          </div>
        ) : (
          <p style={{ margin: 0, opacity: 0.55, fontSize: 13.5 }}>Star entries below to feature them here.</p>
        )}
      </section>
    ) : null,
    entries: (
      <section key="entries" style={{ marginBottom: 26 }}>
        {sectionHead("entries")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {entries.slice(0, entriesShown).map((d) => entryCard(d, false))}
          {entries.length === 0 && (
            <p style={{ gridColumn: "1 / -1", opacity: 0.6 }}>
              {query ? "No entries match “" + query + "”." : "No entries yet — cards you create in the editor appear here, live."}
            </p>
          )}
        </div>
        {entries.length > entriesShown && (
          <button type="button" onClick={() => setEntriesShown((n) => n + 60)} style={{ ...chip, marginTop: 12 }}>
            Show {Math.min(60, entries.length - entriesShown)} more ({entries.length - entriesShown} left)
          </button>
        )}
      </section>
    ),
    extras: extras.length > 0 ? (
      <section key="extras" style={{ marginBottom: 26, borderTop: "1px solid " + T.line, paddingTop: 16 }}>
        {sectionHead("extras")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {extras.map((d) => (
            <button key={d.id} type="button" onClick={() => setOpenId(d.id)} style={chip}>
              {(d.name || "Untitled") + " · " + d.documentType}
            </button>
          ))}
        </div>
      </section>
    ) : null,
  }

  const showMap = !open && !classicView

  return (
    <div style={{ position: "absolute", inset: 0, overflowY: showMap ? "hidden" : "auto", background: T.bg, color: T.ink, fontFamily: BODY_FF }}>
      {showMap && (
        <SolarSystemHome
          T={T}
          title={title}
          bodies={page.solarBodies}
          editing={editing}
          onOpen={(id) => { setOpenId(id); setClassicView(true) }}
          onAddBody={(b) => actions?.addBody(b)}
          onRemoveBody={(i) => actions?.removeBody(i)}
          onUpdateBody={(i, patch) => actions?.updateBody(i, patch)}
          onSeed={() => actions?.seedSolarSystem()}
          onShowClassic={() => setClassicView(true)}
        />
      )}

      {!showMap && (
        <>
          {(bannerUrl || editing) && (
            <div style={{ position: "relative", height: bannerUrl ? 180 : 72, background: bannerUrl ? "center / cover no-repeat url(" + JSON.stringify(bannerUrl) + ")" : T.card, borderBottom: "1px solid " + T.line }}>
              {editing && (
                <span style={{ position: "absolute", right: 14, bottom: 12, display: "inline-flex", gap: 6 }}>
                  <button type="button" onClick={pickBanner} style={{ ...editChip, background: T.bg }}>
                    {bannerUrl ? "Swap banner image" : "Set a banner image"}
                  </button>
                  {bannerUrl && (
                    <button type="button" onClick={() => actions?.setBanner("")} style={{ ...editChip, background: T.bg }}>
                      Remove
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
          <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px 72px" }}>
            <header style={{ borderBottom: "1px solid " + T.line, paddingBottom: 18, marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                {editing ? (
                  <input value={page.title} onChange={(e) => actions?.setText("title", e.target.value)}
                    placeholder={meta ? meta.name : NAME} aria-label="Wiki title"
                    style={{ margin: 0, fontSize: 34, letterSpacing: 0.3, fontWeight: 700, fontFamily: HEAD_FF, color: T.ink, background: "transparent", border: "none", borderBottom: "1px dashed " + T.line, outline: "none", minWidth: 240, flex: 1 }} />
                ) : (
                  <h1 style={{ margin: 0, fontSize: 34, letterSpacing: 0.3, fontFamily: HEAD_FF }}>{title}</h1>
                )}
                {!open && (
                  <button type="button" onClick={() => setClassicView(false)} style={chip}>🪐 Back to Star Map</button>
                )}
              </div>
              {editing ? (
                <input value={page.subtitle} onChange={(e) => actions?.setText("subtitle", e.target.value)}
                  placeholder={(meta && meta.description) || "A line about this place…"} aria-label="Wiki subtitle"
                  style={{ margin: "8px 0 0", width: "100%", maxWidth: 560, opacity: 0.85, fontFamily: "inherit", fontSize: "inherit", color: T.ink, background: "transparent", border: "none", borderBottom: "1px dashed " + T.line, outline: "none" }} />
              ) : subtitle ? (
                <p style={{ margin: "8px 0 0", opacity: 0.75, maxWidth: 560 }}>{subtitle}</p>
              ) : null}
              {!open && (
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setEntriesShown(60) }}
                  placeholder={"Search " + title + "…"}
                  style={{ marginTop: 16, width: "100%", maxWidth: 340, padding: "8px 12px", borderRadius: 10, border: "1px solid " + T.line, background: T.card, color: T.ink, font: "inherit", fontSize: 14, outline: "none" }}
                />
              )}
            </header>

            {open ? (
              <article>
                <button type="button" onClick={() => setOpenId(null)} style={{ ...chip, marginBottom: 14 }}>
                  ← Back
                </button>
                <h2 style={{ margin: "0 0 4px", fontSize: 26 }}>{open.name || "Untitled"}</h2>
                {open.aliases && open.aliases.length > 0 && (
                  <p style={{ margin: "0 0 14px", opacity: 0.6, fontSize: 13 }}>{"Also known as " + open.aliases.join(", ")}</p>
                )}
                <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 14, padding: 18 }}>
                  <HostEmbed documentId={open.id} view="fullscreen" className="min-h-0 flex-1 overflow-hidden [&>*]:h-full" />
                </div>
              </article>
            ) : (
              <>
                {order.map((key) => sections[key] ?? null)}
                <footer style={{ marginTop: 24, opacity: 0.45, fontSize: 12.5 }}>
                  {NAME} — a wiki template. Edit {FILE} to reshape it.
                </footer>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Wiki({ canEdit }: { canEdit: boolean }) {
  const { values, customizing } = useAppCustomization()
  const { data, actions } = useCollabState({
    title: field.value<string>(""),
    subtitle: field.value<string>(""),
    bannerMediaId: field.value<string>(""),
    sectionOrder: field.list<string>(),
    featuredIds: field.list<string>(),
    solarBodies: field.list<SolarBody>(),
  })
  const page = useMemo<PageState>(
    () => ({
      title: data?.title ?? "",
      subtitle: data?.subtitle ?? "",
      bannerMediaId: data?.bannerMediaId ?? "",
      sectionOrder: data ? [...data.sectionOrder] : [],
      featuredIds: data ? [...data.featuredIds] : [],
      solarBodies: data ? [...data.solarBodies] : [],
    }),
    [data],
  )
  const editing = canEdit && customizing
  const pageActions: PageActions | null = actions
    ? {
        setText: (key, value) => actions.set(key, value),
        setBanner: (mediaId) => actions.set("bannerMediaId", mediaId),
        moveSection: (key, dir) => {
          const cur = page.sectionOrder.length > 0 ? [...page.sectionOrder] : [...DEFAULT_SECTIONS]
          const from = cur.indexOf(key)
          const to = from + dir
          if (from < 0 || to < 0 || to >= cur.length) return
          if (page.sectionOrder.length > 0) {
            actions.list("sectionOrder").move(from, to)
          } else {
            cur.splice(to, 0, cur.splice(from, 1)[0])
            actions.list("sectionOrder").push(...cur)
          }
        },
        toggleFeatured: (id) => {
          const i = page.featuredIds.indexOf(id)
          if (i >= 0) actions.list("featuredIds").remove(i)
          else actions.list("featuredIds").push(id)
        },
        addBody: (body) => actions.list("solarBodies").push({ ...body, id: uid() }),
        removeBody: (index) => actions.list("solarBodies").remove(index),
        updateBody: (index, patch) => {
          const current = page.solarBodies[index]
          if (!current) return
          actions.list("solarBodies").replace(index, { ...current, ...patch })
        },
        seedSolarSystem: () => {
          const existingNames = new Set(page.solarBodies.map((b) => (b.name || "").trim().toLowerCase()))
          const seed = buildSeedBodies().filter((b) => !existingNames.has((b.name || "").trim().toLowerCase()))
          if (seed.length === 0) return
          actions.transact(() => { seed.forEach((b) => actions.list("solarBodies").push(b)) })
        },
      }
    : null

  return <WikiPage editing={editing} values={values} page={page} actions={editing ? pageActions : null} entryPath={null} />
}

function frozenCustomization(settings: unknown): AppCustomizationValues {
  if (!settings || typeof settings !== "object") return {}
  const rec = settings as Record<string, unknown>
  const inner = rec.customization
  const values = inner && typeof inner === "object" ? inner : rec
  return values as AppCustomizationValues
}

function parseSolarBodies(v: unknown): SolarBody[] {
  if (!Array.isArray(v)) return []
  const validKinds: BodyKind[] = ["sun", "planet", "moon", "asteroid", "station", "ship", "location"]
  return v
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((x) => ({
      id: typeof x.id === "string" ? x.id : "",
      kind: validKinds.includes(x.kind as BodyKind) ? (x.kind as BodyKind) : "planet",
      parentId: typeof x.parentId === "string" ? x.parentId : null,
      orbitRadius: typeof x.orbitRadius === "number" ? x.orbitRadius : 100,
      angleOffset: typeof x.angleOffset === "number" ? x.angleOffset : 0,
      periodSeconds: typeof x.periodSeconds === "number" && x.periodSeconds > 0 ? x.periodSeconds : 40,
      size: typeof x.size === "number" ? x.size : 8,
      color: typeof x.color === "string" ? x.color : "#7c8cff",
      name: typeof x.name === "string" ? x.name : "",
      linkedDocumentId: typeof x.linkedDocumentId === "string" ? x.linkedDocumentId : null,
      linkedDocumentName: typeof x.linkedDocumentName === "string" ? x.linkedDocumentName : null,
      emblemMediaId: typeof x.emblemMediaId === "string" ? x.emblemMediaId : null,
      shattered: x.shattered === true,
      locationStyle: x.locationStyle === "surface" || x.locationStyle === "orbital" || x.locationStyle === "atmospheric" ? x.locationStyle : undefined,
      modelMediaId: typeof x.modelMediaId === "string" ? x.modelMediaId : null,
      modelMediaIdLowPoly: typeof x.modelMediaIdLowPoly === "string" ? x.modelMediaIdLowPoly : null,
    }))
}

function frozenPage(snapshot: unknown): PageState {
  const extra = snapshot && typeof snapshot === "object" ? (snapshot as { extra?: unknown }).extra : null
  const raw = extra && typeof extra === "object" ? (extra as { page?: unknown }).page : null
  if (!raw || typeof raw !== "object") return EMPTY_PAGE
  const p = raw as Partial<Record<keyof PageState, unknown>>
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
  return {
    title: typeof p.title === "string" ? p.title : "",
    subtitle: typeof p.subtitle === "string" ? p.subtitle : "",
    bannerMediaId: typeof p.bannerMediaId === "string" ? p.bannerMediaId : "",
    sectionOrder: strings(p.sectionOrder),
    featuredIds: strings(p.featuredIds),
    solarBodies: parseSolarBodies(p.solarBodies),
  }
}

export function ScifiThemeBaked({ snapshot, settings, entryPath }: PublishedAppSurfaceProps) {
  return <WikiPage editing={false} values={frozenCustomization(settings)} page={frozenPage(snapshot)} actions={null} entryPath={entryPath} />
}

const view = defineTool({
  id: "scifi-theme",
  name: "scifi-theme",
  documentTypes: ["scifi-theme"],
  needs: ["world"],
  surface: "plain",
  render: function ScifiThemeView({ context }) {
    return <Wiki canEdit={context.canEdit} />
  },
})

export default defineApp({
  id: "scifi-theme",
  name: "scifi-theme",
  route: "scifi-theme",
  category: "site",
  customization: [THEME_PARAM, WIKI_HEADING_FONT_PARAM, WIKI_BODY_FONT_PARAM],
  publish: { bake, renderBaked: ScifiThemeBaked },
  Host: function ScifiThemeHost({ children }) {
    return <>{children}</>
  },
  Surface: function ScifiThemeSurface({ children }) {
    return <div style={{ position: "relative", height: "100%", width: "100%" }}>{children}</div>
  },
  tools: new ToolRegistry().register(view),
})
