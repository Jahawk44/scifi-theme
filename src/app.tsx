import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

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

// ── Theme ───────────────────────────────────────────────────────────────────
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

const HUD = {
  amber: "#ff8c42",
  amberDim: "rgba(255,158,84,0.35)",
  amberFaint: "rgba(255,158,84,0.2)",
  amberBg: "rgba(255,158,84,0.12)",
  warm: "#f0d9c4",
  warmLabel: "#c9a06a",
  blue: "rgba(140,170,220,0.4)",
  blueDim: "rgba(140,170,220,0.3)",
  blueFaint: "rgba(140,170,220,0.18)",
  blueBg: "rgba(140,170,220,0.14)",
  ink: "#e7edf8",
  inkDim: "#c7d3e8",
  inkFaint: "#9fb0cc",
  label: "#8a9bbc",
  muted: "#7186a8",
  mutedDark: "#5c6d8c",
  panel: "rgba(10,14,23,0.6)",
  panelSolid: "rgba(8,11,19,0.94)",
  danger: "#e07a7a",
} as const

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
  name: string
  linkedDocumentId: string | null
  linkedDocumentName: string | null
  emblemMediaId: string | null
  shattered?: boolean
  locationStyle?: "surface" | "orbital" | "atmospheric"
  modelMediaId?: string | null
  surfaceMapDocumentId?: string | null
  surfaceMapDocumentName?: string | null
  facingAngle?: number
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

const DISTANCE_SCALE_A = 2.4
const DISTANCE_SCALE_P = 1.35
function visualFromLogicalRadius(r: number) {
  return DISTANCE_SCALE_A * Math.pow(Math.max(r, 0), DISTANCE_SCALE_P)
}
function logicalFromVisualRadius(r: number) {
  return Math.pow(Math.max(r, 0) / DISTANCE_SCALE_A, 1 / DISTANCE_SCALE_P)
}

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

const TIME_SCALE = 0.15
const PLANET_CLICK_BOOST = 3.4

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
  const asteroid = (name: string, orbitRadius: number, size = 3, color = "#3fc9b5") =>
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
    modelMediaId: null
  })

  const mercuryId = planet("Mercury", 70, 5, "#b5b0a8", 22)
  const mercuryBody = bodies.find((b) => b.id === mercuryId)
  if (mercuryBody) mercuryBody.shattered = true
  for (let i = 0; i < 5; i++) asteroid("Mercury Remnant " + (i + 1), 58 + i * 5, 1.4, "#e0955a")
  planet("Venus", 95, 7, "#e0c079", 34)
  const earth = planet("Earth", 130, 7.5, "#4a90d9", 46)
  moon(earth, "Moon", 16, 2.5, "#cfd4da", 8)
  const mars = planet("Mars", 170, 6, "#c1502e", 60)
  moon(mars, "Phobos", 12, 1.6, "#9a8b7c", 5)
  moon(mars, "Deimos", 18, 1.6, "#9a8b7c", 9)

  asteroid("Ceres", 205, 3.4, "#5be0cc")
  asteroid("Vesta", 215, 2.6, "#4fd6c2")
  asteroid("Pallas", 222, 2.4, "#63e3d0")
  asteroid("Hygiea", 230, 2.4, "#57d9c6")
  for (let i = 0; i < 6; i++) asteroid("Asteroid " + (i + 1), 208 + i * 4, 3, "#3fc9b5")

  const jupiter = planet("Jupiter", 300, 16, "#d9a066", 120)
  moon(jupiter, "Io", 24, 2.2, "#d8c46a", 10)
  moon(jupiter, "Europa", 29, 2, "#cdd3d8", 14)
  moon(jupiter, "Ganymede", 34, 2.6, "#a89f92", 18)
  moon(jupiter, "Callisto", 40, 2.4, "#7f7468", 22)

  const saturn = planet("Saturn", 360, 14, "#e3c27a", 150)
  moon(saturn, "Mimas", 12, 0.9, "#d4d6d9", 7)
  moon(saturn, "Enceladus", 15, 1.4, "#eef2f5", 9)
  moon(saturn, "Tethys", 17, 1.6, "#e8ebee", 10)
  moon(saturn, "Dione", 19, 1.6, "#d8dade", 11)
  moon(saturn, "Rhea", 20, 1.8, "#c9ccd1", 12)
  moon(saturn, "Titan", 26, 2.6, "#d8a94a", 16)
  moon(saturn, "Iapetus", 40, 1.7, "#8f8577", 55)

  const uranus = planet("Uranus", 410, 11, "#8fd3e0", 190)
  moon(uranus, "Miranda", 9, 0.8, "#b0b8bc", 6)
  moon(uranus, "Ariel", 12, 1.5, "#c7ccd0", 8)
  moon(uranus, "Umbriel", 15, 1.5, "#7d8286", 11)
  moon(uranus, "Titania", 18, 1.8, "#b7c2c9", 20)
  moon(uranus, "Oberon", 22, 1.8, "#a7b2b9", 26)

  const neptune = planet("Neptune", 455, 10.5, "#5b7fe0", 220)
  moon(neptune, "Triton", 18, 2, "#c8d2e0", 20)

  asteroid("Pluto", 505, 3, "#a8b3ff")
  for (let i = 0; i < 8; i++) asteroid("KBO-" + (i + 1), 520 + i * 6, 2, "#7c8cff")

  return bodies
}

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

function computeVisualPositions(bodies: SolarBody[], now: number): Map<string, { x: number; y: number }> {
  const byId = new Map(bodies.map((b) => [b.id, b]))
  const cache = new Map<string, { x: number; y: number }>()
  function posOf(b: SolarBody): { x: number; y: number } {
    const cached = cache.get(b.id)
    if (cached) return cached
    let base = { x: 0, y: 0 }
    let radius = b.orbitRadius
    if (b.parentId) {
      const parent = byId.get(b.parentId)
      if (parent) base = posOf(parent)
    } else {
      radius = visualFromLogicalRadius(b.orbitRadius)
    }
    let angleDeg = (b.angleOffset + (now / 1000 / b.periodSeconds) * 360 * TIME_SCALE) % 360
    if (!Number.isFinite(radius) || radius < (b.parentId ? 3 : 10)) {
      radius = b.parentId ? 3 : 10
      angleDeg = Array.from(b.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360
    }
    const angleRad = (angleDeg * Math.PI) / 180
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

function WorldPicker({ onPick, placeholder, types = ["card"], allowCreate = true }: {
  onPick: (id: string, name: string) => void
  placeholder?: string
  types?: string[]
  allowCreate?: boolean
}) {
  const search = useHostCapability("search")
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    let live = true
    search.query?.(q, { types, limit: 8 }).then((r: { id: string; name: string }[]) => { if (live) setHits(r || []) }).catch(() => { if (live) setHits([]) })
    return () => { live = false }
  }, [q, search, types.join(",")])
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
      {allowCreate && q.trim() && hits.length === 0 && (
        <button type="button" onClick={createNew} style={{ ...hitStyle, borderStyle: "dashed" }}>
          {'Create "' + q.trim() + '" as a new entry'}
        </button>
      )}
      {!allowCreate && q.trim() && hits.length === 0 && (
        <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, color: "#6a7a9c" }}>No matching map found.</p>
      )}
    </div>
  )
}

function AddObjectPanel({ bodies, attachable, onAdd, onClose }: {
  bodies: SolarBody[]
  attachable: { id: string; name: string; size: number }[]
  onAdd: (body: Omit<SolarBody, "id">) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BodyKind>("planet")
  const [parentId, setParentId] = useState<string>("")
  const [name, setName] = useState("")

  const needsParent = kind === "moon" || kind === "station" || kind === "ship"

  const defaultsFor = () => {
    const attachedTo = needsParent ? parentId || null : null
    const orbitRadius = nextOrbitRadius(bodies, attachedTo)
    if (kind === "moon") return { orbitRadius, periodSeconds: 12 + orbitRadius * 0.4, size: 3 }
    if (kind === "station" || kind === "ship") return attachedTo ? { orbitRadius, periodSeconds: 16 + orbitRadius * 0.4, size: 5 } : { orbitRadius, periodSeconds: 40 + orbitRadius * 0.3, size: 5 }
    if (kind === "asteroid") return { orbitRadius, periodSeconds: 40 + orbitRadius * 0.2, size: 2.5 }
    return { orbitRadius, periodSeconds: 40 + orbitRadius * 0.25, size: 10 }
  }

  const colorFor = (seed: string) => (kind === "station" ? "#38bdf8" : kind === "ship" ? "#e2e8f4" : PLANET_PALETTE[Math.floor(pseudo(seed.length + kind.length) * PLANET_PALETTE.length)])

  const addPlaceholder = () => {
    if (!name.trim()) return
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
    })
    onClose()
  }

  const link = (id: string, linkedName: string) => {
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

  return (
    <div style={{ position: "absolute", top: 64, left: 20, zIndex: 6, width: 270, padding: 14, borderRadius: 6, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(8,11,19,0.94)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#c9a06a", letterSpacing: 1 }}>ADD OBJECT</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {kindBtn("planet", "PLANET")}
        {kindBtn("moon", "MOON")}
        {kindBtn("asteroid", "ASTEROID")}
        {kindBtn("station", "STATION")}
        {kindBtn("ship", "SHIP")}
      </div>

      {needsParent && (
        <>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ padding: "6px 8px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.3)", background: "rgba(10,14,23,0.6)", color: "#c7d3e8", fontFamily: MONO, fontSize: 10.5 }}>
            <option value="">{kind === "station" || kind === "ship" ? "— orbit the Sun directly —" : "— unattached —"}</option>
            {attachable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(kind === "station" || kind === "ship") && (
            <div style={{ fontFamily: MONO, fontSize: 9, color: "#5c6d8c" }}>
              Leave unattached and it orbits the Sun independently, like a planet.
            </div>
          )}
        </>
      )}

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ padding: "6px 9px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.35)", background: "rgba(10,14,23,0.5)", color: "#c7d3e8", fontFamily: MONO, fontSize: 11 }} />
      <button
        type="button"
        onClick={addPlaceholder}
        disabled={!name.trim()}
        style={{ padding: "7px 10px", borderRadius: 3, border: "1px solid rgba(255,158,84,0.4)", background: "rgba(255,158,84,0.12)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10.5, cursor: name.trim() ? "pointer" : "default", opacity: name.trim() ? 1 : 0.5 }}
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

const HUD_CJK = "能量核心阵列轨道信号中继光束通量稳定同步节点热平衡采集矩阵频率脉冲增益锁定扫描解析坐标".split("")
const HUD_LABELS = ["COLLECTOR SYNC", "PANEL ARRAY", "GRID LOAD", "CORE TEMP", "ORBIT LOCK", "SIGNAL GAIN", "SWARM NODE", "RELAY LINK", "BEAM ALIGN", "FLUX STABLE", "NODE STATUS", "THERMAL BAL"]
function hudHex(len: number) {
  let s = ""
  for (let i = 0; i < len; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)]
  return s
}
function hudGlyphLine() {
  const n = 5 + Math.floor(Math.random() * 8)
  return Array.from({ length: n }, () => HUD_CJK[Math.floor(Math.random() * HUD_CJK.length)]).join("")
}
function hudLine(): string {
  const r = Math.random()
  if (r < 0.34) return "0x" + hudHex(6 + Math.floor(Math.random() * 4))
  if (r < 0.62) return hudGlyphLine()
  const label = HUD_LABELS[Math.floor(Math.random() * HUD_LABELS.length)]
  return label + " " + (80 + Math.random() * 900).toFixed(1)
}

let sfxCtx: AudioContext | null = null
let sfxGain: GainNode | null = null
function sfxContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!sfxCtx) {
    try {
      const Ctor: any = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctor) return null
      sfxCtx = new Ctor()
      sfxGain = sfxCtx.createGain()
      sfxGain.gain.value = 0.16
      sfxGain.connect(sfxCtx.destination)
    } catch {
      return null
    }
  }
  if (sfxCtx.state === "suspended") sfxCtx.resume().catch(() => {})
  return sfxCtx
}
function sfxTone(freq: number, duration: number, type: OscillatorType = "sine", peak = 0.5, glideTo?: number) {
  const ctx = sfxContext()
  if (!ctx || !sfxGain) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), ctx.currentTime + duration)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(sfxGain)
    osc.start()
    osc.stop(ctx.currentTime + duration + 0.02)
  } catch { /* audio is best-effort */ }
}
const SFX = {
  select: () => sfxTone(720, 0.09, "sine", 0.4, 1000),
  confirm: () => { sfxTone(660, 0.08, "triangle", 0.35); setTimeout(() => sfxTone(920, 0.13, "triangle", 0.3), 65) },
  cancel: () => sfxTone(320, 0.14, "sine", 0.3, 170),
  open: () => sfxTone(480, 0.16, "sine", 0.32, 760),
  back: () => sfxTone(560, 0.13, "sine", 0.28, 320),
  toggle: () => sfxTone(440, 0.05, "square", 0.14),
  remove: () => sfxTone(220, 0.2, "sawtooth", 0.22, 90),
}

const HUD_KEYFRAMES = `
@keyframes hudRain { from { transform: translateY(0); } to { transform: translateY(-50%); } }
@keyframes hudScan { 0% { transform: translateY(-10%); opacity: 0; } 8% { opacity: 0.5; } 92% { opacity: 0.5; } 100% { transform: translateY(110%); opacity: 0; } }
@keyframes hudTwinkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
@keyframes hudShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes hudMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes hudPulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes hudSweep { 0% { background-position: 0 -120%; } 100% { background-position: 0 120%; } }
`

function HudRainColumn({ lineCount, fontSize, opacity, duration }: { lineCount: number; fontSize: number; opacity: number; duration: number }) {
  const lines = useMemo(() => Array.from({ length: lineCount }, () => hudLine()), [lineCount])
  const track = (
    <>
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap", padding: "3px 0" }}>{l}</div>
      ))}
    </>
  )
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", maskImage: "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)" }}>
      <div style={{ animation: "hudRain " + duration + "s linear infinite", fontFamily: MONO, fontSize, color: "#e0a165", opacity, textShadow: "0 0 6px rgba(255,158,84,0.45)" }}>
        {track}
        {track}
      </div>
    </div>
  )
}

function LiveClock({ style }: { style?: CSSProperties }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span style={style}>{now.toLocaleTimeString([], { hour12: false })}</span>
}

function HudReadout({ label, style }: { label: string; style?: CSSProperties }) {
  const [val, setVal] = useState(() => (10 + Math.random() * 90).toFixed(1))
  useEffect(() => {
    const id = setInterval(() => setVal((10 + Math.random() * 90).toFixed(1)), 1400 + Math.random() * 1200)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ border: "1px solid rgba(255,158,84,0.4)", background: "rgba(10,14,23,0.55)", padding: "5px 8px", fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.6, color: "#f0d9c4", ...style }}>
      <div style={{ opacity: 0.75 }}>{label}</div>
      <div style={{ color: "#ffb066", marginTop: 2 }}>{val}</div>
    </div>
  )
}

function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200))
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return w
}

function SurfaceMapPanel({ body, revealed, onBack }: {
  body: SolarBody
  revealed: boolean
  onBack: () => void
}) {
  if (!body.surfaceMapDocumentId) return null
  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 8, background: "#04050a",
        opacity: revealed ? 1 : 0,
        transform: revealed ? "scale(1)" : "scale(1.06)",
        transition: "opacity 480ms ease, transform 480ms cubic-bezier(.2,.8,.2,1)",
        pointerEvents: revealed ? "auto" : "none",
      }}
    >
      <HostEmbed documentId={body.surfaceMapDocumentId} view="fullscreen" className="min-h-0 flex-1 overflow-hidden [&>*]:h-full h-full" />
      <button
        type="button"
        onClick={onBack}
        style={{
          position: "absolute", top: 16, left: 16, zIndex: 2,
          padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(255,158,84,0.4)",
          background: "rgba(10,14,23,0.55)", color: "#f0d9c4", fontFamily: MONO, fontSize: 10, letterSpacing: 0.6,
          cursor: "pointer", backdropFilter: "blur(4px)",
        }}
      >
        ← ORBIT
      </button>
    </div>
  )
}

function BodySidePanel({ body, tierLabel, editing, emblemUrl, docs, onBack, onOpen, onRename, onLink, onUnlink, onRemove, onSetEmblem, onRemoveEmblem, onSetModel, onRemoveModel, onLinkSurfaceMap, onUnlinkSurfaceMap, onSetSize, onSetFacing, modelLoadFailed }: {
  body: SolarBody
  tierLabel: string
  editing: boolean
  emblemUrl: string | null
  docs: WikiDocRow[]
  onBack: () => void
  onOpen: (id: string) => void
  onRename: (name: string) => void
  onLink: (id: string, name: string | null) => void
  onUnlink: () => void
  onRemove: () => void
  onSetEmblem: (mediaId: string) => void
  onRemoveEmblem: () => void
  onSetModel: (mediaId: string) => void
  onRemoveModel: () => void
  onLinkSurfaceMap: (id: string, name: string) => void
  onUnlinkSurfaceMap: () => void
  onSetSize: (size: number) => void
  onSetFacing: (facingAngle: number) => void
  modelLoadFailed?: boolean
}) {
  const [shown, setShown] = useState(false)
  const [nameDraft, setNameDraft] = useState(body.name)
  const [linking, setLinking] = useState(false)
  const [keepNameOnLink, setKeepNameOnLink] = useState(false)
  const [linkingSurfaceMap, setLinkingSurfaceMap] = useState(false)
  const SCALE_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5]
  const FACING_STEPS = [0, 45, 90, 135, 180, 225, 270, 315]
  const nearestStepIndex = (steps: number[], value: number) => {
    let best = 0, bestDiff = Infinity
    steps.forEach((s, i) => { const d = Math.abs(s - value); if (d < bestDiff) { bestDiff = d; best = i } })
    return best
  }
  const [pendingSizeIdx, setPendingSizeIdx] = useState(() => nearestStepIndex(SCALE_STEPS, body.size))
  const [pendingFacingIdx, setPendingFacingIdx] = useState(() => nearestStepIndex(FACING_STEPS, body.facingAngle || 0))
  useEffect(() => {
    setPendingSizeIdx(nearestStepIndex(SCALE_STEPS, body.size))
    setPendingFacingIdx(nearestStepIndex(FACING_STEPS, body.facingAngle || 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id, body.size, body.facingAngle])
  const scaleDirty = SCALE_STEPS[pendingSizeIdx] !== body.size
  const facingDirty = FACING_STEPS[pendingFacingIdx] !== (body.facingAngle || 0)
  const media = useHostCapability("media")
  const scope = useHostCapability("scope")
  const linkedDoc = body.linkedDocumentId ? docs.find((d) => d.id === body.linkedDocumentId) : null
  useEffect(() => {
    setNameDraft(body.name)
    setShown(false)
    setLinkingSurfaceMap(false)
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [body.id])

  const pickModel = async () => {
    if (!media.pick) return
    const picked = await media.pick({ worldId: scope.worldId, accept: ["model/gltf-binary", ".glb", ".gltf"] })
    if (picked) onSetModel(picked.id)
  }

  const displayName = body.linkedDocumentName || body.name || "UNNAMED"
  const label = { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: "#8a9bbc" } as const
  const btn = { padding: "7px 14px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.3)", background: "transparent", color: "#9fb0cc", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, cursor: "pointer" } as const

  return (
    <div
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(760px, 92vw)", zIndex: 5,
        background: "linear-gradient(90deg, rgba(6,8,16,0) 0%, rgba(6,8,16,0.94) 14%)",
        display: "flex", flexDirection: "column", padding: "84px 22px 110px",
        opacity: shown ? 1 : 0, transform: shown ? "translateX(0)" : "translateX(24px)",
        transition: "opacity 380ms ease, transform 380ms cubic-bezier(.2,.8,.2,1)",
        overflowY: "auto",
      }}
    >
      <button type="button" onClick={onBack} style={{ ...btn, alignSelf: "flex-start", marginBottom: 18 }}>← BACK TO CHART</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={label}>{tierLabel}</span>
      </div>
      <h2 style={{ margin: "2px 0 18px", fontFamily: MONO, fontSize: 20, letterSpacing: 1, color: "#e7edf8" }}>{displayName.toUpperCase()}</h2>

      {body.linkedDocumentId ? (
        <>
          {linkedDoc && linkedDoc.documentType !== "card" ? (
            <div style={{ borderRadius: 8, border: "1px solid rgba(140,170,220,0.2)", background: "rgba(255,255,255,0.03)", padding: "20px 16px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{linkedDoc.documentType === "timeline" ? "⏱" : linkedDoc.documentType === "map" ? "🗺" : "📄"}</div>
              <p style={{ ...label, fontSize: 11, lineHeight: 1.6, opacity: 0.8, margin: "0 0 2px" }}>
                {linkedDoc.documentType.toUpperCase()} — best viewed full page
              </p>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 400, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(140,170,220,0.2)", borderRadius: 8, padding: 14, marginBottom: 14, overflowY: "auto" }}>
              <HostEmbed documentId={body.linkedDocumentId} view="fullscreen" className="w-full h-full [&>*]:w-full [&>*]:h-full" />
            </div>
          )}
          <button type="button" onClick={() => onOpen(body.linkedDocumentId as string)} style={{ ...btn, border: "1px solid rgba(140,170,220,0.4)", background: "rgba(140,170,220,0.14)", color: "#e7edf8", marginBottom: 8 }}>
            OPEN FULL PAGE →
          </button>
        </>
      ) : (
        <p style={{ ...label, fontSize: 11, lineHeight: 1.6, opacity: 0.75, marginBottom: 14 }}>
          Not linked to a world entry yet.
        </p>
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
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 7, ...label, fontSize: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={keepNameOnLink} onChange={(e) => setKeepNameOnLink(e.target.checked)} />
                Keep this object's current name
              </label>
              <WorldPicker onPick={(id, name) => { onLink(id, keepNameOnLink ? null : name); setLinking(false) }} />
            </>
          ) : (
            <button type="button" onClick={() => setLinking(true)} style={{ ...btn, borderStyle: "dashed" }}>Link to a world entry…</button>
          )}
          {body.modelMediaId ? (
            <>
              <button type="button" onClick={() => onRemoveModel()} style={{ ...btn, borderStyle: "dashed" }}>
                {body.kind === "sun" ? "Remove Dyson swarm model (.glb)" : "Remove 3D model (.glb)"}
              </button>
              {modelLoadFailed && (
                <div style={{
                  padding: "8px 10px", borderRadius: 4, border: "1px solid rgba(255,158,84,0.4)",
                  background: "rgba(255,158,84,0.08)", color: "#ffb27a", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5,
                }}>
                  ⚠ This model failed to load — the viewport is showing the placeholder shape instead. Check that the .glb file is valid and reachable, then try removing and re-attaching it.
                </div>
              )}
            </>
          ) : (
            <button type="button" onClick={() => pickModel()} style={{ ...btn, borderStyle: "dashed" }}>
              {body.kind === "sun" ? "Set Dyson Swarm Model (.glb)" : "Set 3D Model (.glb)"}
            </button>
          )}
          {(body.kind === "planet" || body.kind === "moon") && (
            body.surfaceMapDocumentId ? (
              <button type="button" onClick={onUnlinkSurfaceMap} style={{ ...btn, borderStyle: "dashed" }}>
                Unlink surface map ({body.surfaceMapDocumentName || "linked"})
              </button>
            ) : linkingSurfaceMap ? (
              <WorldPicker
                types={["map"]}
                allowCreate={false}
                placeholder="Search existing maps…"
                onPick={(id, name) => { onLinkSurfaceMap(id, name); setLinkingSurfaceMap(false) }}
              />
            ) : (
              <button type="button" onClick={() => setLinkingSurfaceMap(true)} style={{ ...btn, borderStyle: "dashed" }}>
                Link surface map… (zoom-in reveals it)
              </button>
            )
          )}
          {(body.kind === "station" || body.kind === "ship") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "9px 9px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.25)", background: "rgba(10,14,23,0.4)" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", ...label, marginBottom: 3 }}>
                  <span>SCALE</span>
                  <span>{SCALE_STEPS[pendingSizeIdx]}×</span>
                </div>
                <input
                  type="range" min={0} max={SCALE_STEPS.length - 1} step={1} value={pendingSizeIdx}
                  onChange={(e) => setPendingSizeIdx(parseInt(e.target.value, 10))}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", ...label, marginBottom: 3 }}>
                  <span>ROTATION (FIXED HEADING)</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ display: "inline-block", transform: "rotate(" + FACING_STEPS[pendingFacingIdx] + "deg)" }}>➤</span>
                    {FACING_STEPS[pendingFacingIdx]}°
                  </span>
                </div>
                <input
                  type="range" min={0} max={FACING_STEPS.length - 1} step={1} value={pendingFacingIdx}
                  onChange={(e) => setPendingFacingIdx(parseInt(e.target.value, 10))}
                  style={{ width: "100%" }}
                />
                <div style={{ ...label, fontSize: 8.5, opacity: 0.65, marginTop: 3, lineHeight: 1.4 }}>
                  A fixed facing instead of a continuous spin — this craft won't tumble in place like a planet's axial rotation.
                </div>
              </div>
              {(scaleDirty || facingDirty) && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => { SFX.confirm(); onSetSize(SCALE_STEPS[pendingSizeIdx]); onSetFacing(FACING_STEPS[pendingFacingIdx]) }}
                    style={{ ...btn, flex: 1, border: "1px solid rgba(89,217,142,0.5)", background: "rgba(89,217,142,0.14)", color: "#c8f4d8" }}
                  >
                    ✓ Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => { SFX.cancel(); setPendingSizeIdx(nearestStepIndex(SCALE_STEPS, body.size)); setPendingFacingIdx(nearestStepIndex(FACING_STEPS, body.facingAngle || 0)) }}
                    style={{ ...btn, flex: 1, border: "1px solid rgba(240,120,120,0.5)", background: "rgba(240,90,90,0.1)", color: "#f4c8c8" }}
                  >
                    ✕ Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => { SFX.remove(); onRemove() }} style={{ ...btn, border: "1px solid rgba(224,122,122,0.4)", color: "#e07a7a" }}>Remove object</button>
        </div>
      )}
    </div>
  )
}

function SolarSystemHome({ T, title, bodies, editing, docs, onOpen, onAddBody, onRemoveBody, onUpdateBody, onSeed, onShowClassic }: {
  T: ThemeSpec
  title: string
  bodies: SolarBody[]
  editing: boolean
  docs: WikiDocRow[]
  onOpen: (id: string) => void
  onAddBody: (body: Omit<SolarBody, "id">) => string | void
  onRemoveBody: (index: number) => void
  onUpdateBody: (index: number, patch: Partial<SolarBody>) => void
  onSeed: () => void
  onShowClassic: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [surfaceTarget, setSurfaceTarget] = useState<{ bodyId: string; revealed: boolean } | null>(null)
  const surfaceTargetRef = useRef(surfaceTarget)
  surfaceTargetRef.current = surfaceTarget
  const surfaceExitLockRef = useRef<string | null>(null)
  const exitSurfaceView = () => {
    if (surfaceTarget) surfaceExitLockRef.current = surfaceTarget.bodyId
    setSurfaceTarget(null)
  }
  const [adding, setAdding] = useState(false)
  const pendingFocusIdRef = useRef<string | null>(null)
  const [hoveredTier, setHoveredTier] = useState<string | null>(null)
  const [visibleKinds, setVisibleKinds] = useState<Record<BodyKind, boolean>>({ sun: true, planet: true, moon: true, asteroid: true, station: true, ship: true, location: true })
  const visibleKindsRef = useRef(visibleKinds)
  visibleKindsRef.current = visibleKinds
  const [showSkybox, setShowSkybox] = useState(true)
  const showSkyboxRef = useRef(showSkybox)
  showSkyboxRef.current = showSkybox
  const poseRef = useRef<{ azimuth: number; elevation: number; distance: number; target: any } | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [navQuery, setNavQuery] = useState("")
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [showEmblems, setShowEmblems] = useState(true)
  const showEmblemsRef = useRef(showEmblems)
  showEmblemsRef.current = showEmblems
  const hoveredTierRef = useRef<string | null>(null)
  hoveredTierRef.current = hoveredTier
  const tierZoomRequestRef = useRef<{ id: string; outer: number } | "reset" | null>(null)
  const [distanceReadout, setDistanceReadout] = useState(4200)
  const [rebuildNonce, setRebuildNonce] = useState(0)
  const media = useHostCapability("media")

  const [emblemUrls, setEmblemUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set(bodies.map((b) => b.emblemMediaId).filter((x): x is string => !!x)))
    const missing = ids.filter((id) => !(id in emblemUrls))
    if (missing.length === 0) return
    let alive = true
    Promise.all(missing.map(async (id) => {
      try { return [id, await media.resolve(id)] as const } catch { return [id, null] as const }
    })).then((pairs) => {
      if (!alive) return
      setEmblemUrls((prev) => {
        const next = { ...prev }
        pairs.forEach(([id, url]) => { if (url) next[id] = url })
        return next
      })
    })
    return () => { alive = false }
  }, [bodies, media, emblemUrls])

  const [modelUrls, setModelUrls] = useState<Record<string, string>>({})
  const modelUrlsRef = useRef(modelUrls)
  modelUrlsRef.current = modelUrls
  useEffect(() => {
    const ids = Array.from(new Set(bodies.map((b) => b.modelMediaId).filter((x): x is string => !!x)))
    const missing = ids.filter((id) => !(id in modelUrls))
    if (missing.length === 0) return
    let alive = true
    const directPaths = missing.filter((id) => id.startsWith("/") || id.startsWith("./") || id.startsWith("../"))
    const mediaIds = missing.filter((id) => !id.startsWith("/") && !id.startsWith("./") && !id.startsWith("../"))
    const directPairs: [string, string][] = directPaths.map((path) => [path, path])
    const mediaPromise = mediaIds.length > 0
      ? Promise.all(mediaIds.map(async (id) => {
          try { return [id, await media.resolve(id)] as const } catch { return [id, null] as const }
        }))
      : Promise.resolve([] as [string, string | null][])
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

  const unpublishableMedia = useMemo(() => {
    const isDevPath = (v: string) => v.startsWith("/") || v.startsWith("./") || v.startsWith("../")
    const isValidUrl = (v: string) => /^https?:\/\//.test(v) || /^data:/.test(v)
    const hits: { name: string; field: string }[] = []
    bodies.forEach((b) => {
      if (b.modelMediaId) {
        if (isDevPath(b.modelMediaId)) hits.push({ name: b.name || "Unnamed", field: "3D model" })
        else if (b.modelMediaId in modelUrls && !isValidUrl(modelUrls[b.modelMediaId])) hits.push({ name: b.name || "Unnamed", field: "3D model" })
      }
      if (b.emblemMediaId) {
        if (isDevPath(b.emblemMediaId)) hits.push({ name: b.name || "Unnamed", field: "emblem" })
        else if (b.emblemMediaId in emblemUrls && !isValidUrl(emblemUrls[b.emblemMediaId])) hits.push({ name: b.name || "Unnamed", field: "emblem" })
      }
    })
    return hits
  }, [bodies, modelUrls, emblemUrls])

  const nukeAllMedia = () => {
    bodies.forEach((b, i) => {
      if (b.modelMediaId || b.emblemMediaId) onUpdateBody(i, { modelMediaId: null, emblemMediaId: null })
    })
    setConfirmNuke(false)
  }

  const logMediaAudit = () => {
    const isValidUrl = (v: string) => /^https?:\/\//.test(v) || /^data:/.test(v)
    const resolutionState = (id: string | null, urls: Record<string, string>) => {
      if (!id) return "—"
      if (!(id in urls)) return "pending (still resolving)"
      return isValidUrl(urls[id]) ? "OK" : "INVALID: " + JSON.stringify(urls[id])
    }
    const rows = bodies
      .filter((b) => b.modelMediaId || b.emblemMediaId)
      .map((b) => ({
        name: b.name || "Unnamed",
        kind: b.kind,
        modelMediaId: b.modelMediaId || "—",
        modelStatus: resolutionState(b.modelMediaId, modelUrls),
        emblemMediaId: b.emblemMediaId || "—",
        emblemStatus: resolutionState(b.emblemMediaId, emblemUrls),
      }))
    console.group("[solar-map] Media audit — " + rows.length + " of " + bodies.length + " bodies have a media reference set")
    if (rows.length === 0) {
      console.log("No body has modelMediaId or emblemMediaId set.")
    } else if (console.table) {
      console.table(rows)
    } else {
      rows.forEach((r) => console.log(r))
    }
    console.log("Bodies flagged as definitely unpublishable right now:", unpublishableMedia)
    console.groupEnd()
  }

  const bodiesRef = useRef(bodies)
  bodiesRef.current = bodies
  const editingRef = useRef(editing)
  editingRef.current = editing
  const focusedIdRef = useRef(focusedId)
  focusedIdRef.current = focusedId
  const onUpdateBodyRef = useRef(onUpdateBody)
  onUpdateBodyRef.current = onUpdateBody
  const emblemUrlsRef = useRef(emblemUrls)
  emblemUrlsRef.current = emblemUrls

  const [pendingReposition, setPendingReposition] = useState<{ name: string } | null>(null)
  const setPendingRepositionRef = useRef(setPendingReposition)
  setPendingRepositionRef.current = setPendingReposition
  const confirmRepositionRef = useRef<() => void>(() => {})
  const [confirmNuke, setConfirmNuke] = useState(false)
  const cancelRepositionRef = useRef<() => void>(() => {})

  const [modelLoadErrors, setModelLoadErrors] = useState<Record<string, boolean>>({})
  const setModelLoadErrorsRef = useRef(setModelLoadErrors)
  setModelLoadErrorsRef.current = setModelLoadErrors

  const sceneStateRef = useRef<any>(null)

  const structuralKey = useMemo(
    () =>
      bodies
        .map((b) =>
          [b.id, b.kind, b.parentId, b.size, b.color, b.name, b.linkedDocumentId, b.emblemMediaId, b.modelMediaId, b.locationStyle || "", b.shattered ? 1 : 0].join(
            "¦",
          ),
        )
        .join("§"),
    [bodies],
  )
  const modelReadyKey = useMemo(
    () =>
      Array.from(new Set(bodies.map((b) => b.modelMediaId).filter((x): x is string => !!x)))
        .map((id) => id + ":" + (id in modelUrls ? 1 : 0))
        .join(","),
    [bodies, modelUrls],
  )
  useEffect(() => {
    let disposed = false
    ;(async () => {
      let THREE: any
      try {
        THREE = await import("three")
      } catch {
        return
      }
      if (disposed || !canvasRef.current || !containerRef.current) return

      let GLTFLoaderCtor: any = null
      try {
        const mod: any = await import("three/addons/loaders/GLTFLoader.js")
        GLTFLoaderCtor = mod.GLTFLoader || null
      } catch {
        GLTFLoaderCtor = null
      }
      const gltfLoader = GLTFLoaderCtor ? new GLTFLoaderCtor() : null
      if (gltfLoader) {
        let DRACOLoaderCtor: any = null
        try {
          const dracoMod: any = await import("three/addons/loaders/DRACOLoader.js")
          DRACOLoaderCtor = dracoMod.DRACOLoader || dracoMod.default?.DRACOLoader || null
          if (!DRACOLoaderCtor) throw new Error("module resolved but exported no DRACOLoader")
        } catch (err) {
          console.warn("[solar-map] DRACOLoader unavailable via three/addons — falling back to CDN:", err)
          try {
            const rev = THREE.REVISION || "160"
            const cdnMod: any = await import("https://esm.sh/three@0." + rev + ".0/examples/jsm/loaders/DRACOLoader.js")
            DRACOLoaderCtor = cdnMod.DRACOLoader || cdnMod.default?.DRACOLoader || null
          } catch (cdnErr) {
            console.warn("[solar-map] DRACOLoader CDN fallback also failed:", cdnErr)
          }
        }
        if (DRACOLoaderCtor) {
          const dracoLoader = new DRACOLoaderCtor()
          dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/")
          gltfLoader.setDRACOLoader(dracoLoader)
        }
      }

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

      const skyboxMaterial = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = pos.xyww;
          }
        `,
        fragmentShader: `
          varying vec3 vDir;
          uniform float uTime;

          float hash13(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.zyx + 31.32);
            return fract((p.x + p.y) * p.z);
          }
          vec3 hash33(vec3 p) {
            p = fract(p * vec3(0.1031, 0.1030, 0.0973));
            p += dot(p, p.yxz + 33.33);
            return fract((p.xxy + p.yxx) * p.zyx);
          }
          float noise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            vec3 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), u.x),
                  mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
              mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x),
                  mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y),
              u.z
            );
          }
          float fbm(vec3 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
              v += a * noise(p);
              p = p * 2.03 + vec3(17.1, 9.2, 3.7);
              a *= 0.5;
            }
            return v;
          }
          float stars(vec3 dir, float scale, float density, float size) {
            vec3 p = dir * scale;
            vec3 id = floor(p);
            vec3 f = fract(p) - 0.5;
            vec3 offset = (hash33(id) - 0.5) * 0.7;
            float d = length(f - offset);
            float exists = step(1.0 - density, hash13(id + 17.0));
            float star = smoothstep(size, 0.0, d) * exists;
            float tw = 0.8 + 0.2 * sin(uTime * (1.0 + hash13(id) * 3.0) + hash13(id + 5.0) * 40.0);
            return star * tw;
          }
          float galaxy(vec3 dir, vec3 center, float size, float squash, float angle) {
            vec3 c = normalize(center);
            float cosA = dot(dir, c);
            if (cosA < 0.5) return 0.0;
            vec3 up = abs(c.y) < 0.95 ? vec3(0,1,0) : vec3(1,0,0);
            vec3 t1 = normalize(cross(c, up));
            vec3 t2 = cross(c, t1);
            vec3 rel = dir - c * cosA;
            float x0 = dot(rel, t1);
            float y0 = dot(rel, t2);
            float ca = cos(angle), sa = sin(angle);
            float x = ( x0 * ca - y0 * sa) / size;
            float y = ( x0 * sa + y0 * ca) / (size * squash);
            float r2 = x*x + y*y;
            float core = exp(-r2 * 40.0) * 1.6;
            float disk = exp(-sqrt(r2) * 4.0) * 0.45;
            disk *= 0.7 + 0.6 * noise(dir * 60.0);
            return core + disk;
          }
          void main() {
            vec3 dir = normalize(vDir);
            vec3 col = vec3(0.008, 0.009, 0.022);
            float n1 = fbm(dir * 3.0 + vec3(11.0, 4.0, 7.0));
            float n2 = fbm(dir * 4.5 + vec3(3.0, 21.0, 12.0));
            float n3 = fbm(dir * 6.0 - vec3(8.0, 2.0, 15.0));
            float neb1 = smoothstep(0.55, 0.85, n1);
            col += vec3(0.35, 0.10, 0.45) * neb1 * 0.55;
            float neb2 = smoothstep(0.58, 0.9, n2);
            col += vec3(0.05, 0.25, 0.40) * neb2 * 0.5;
            float neb3 = smoothstep(0.6, 0.95, n3);
            col += vec3(0.30, 0.16, 0.08) * neb3 * 0.3;
            vec3 bandNormal = normalize(vec3(0.2, 1.0, 0.35));
            float bandDist = abs(dot(dir, bandNormal));
            float band = exp(-bandDist * bandDist * 30.0);
            float bandClouds = fbm(dir * 8.0 + vec3(5.0));
            col += vec3(0.55, 0.5, 0.55) * band * bandClouds * 0.5;
            float dust = smoothstep(0.5, 0.75, fbm(dir * 12.0 - vec3(9.0)));
            col -= vec3(0.25) * band * dust * 0.5;
            col += vec3(1.0, 0.9, 0.75) * galaxy(dir, vec3( 0.7,  0.4, -0.5), 0.05, 0.35, 0.8);
            col += vec3(0.8, 0.85, 1.0) * galaxy(dir, vec3(-0.6,  0.2,  0.75), 0.035, 0.5, 2.1);
            col += vec3(0.95, 0.8, 0.9) * galaxy(dir, vec3( 0.1, -0.8,  0.55), 0.028, 0.3, 4.0);
            float s = 0.0;
            s += stars(dir, 90.0, 0.10, 0.12) * 0.5;
            s += stars(dir, 45.0, 0.06, 0.10) * 0.9;
            s += stars(dir, 22.0, 0.03, 0.07) * 1.4;
            s += stars(dir, 130.0, 0.22, 0.14) * band * 0.6;
            vec3 cell = floor(dir * 45.0);
            vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.65), hash13(cell + 3.0));
            col += tint * s;
            col = max(col, 0.0);
            col = pow(col, vec3(1.0 / 2.2));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
      const skybox = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32), skyboxMaterial)
      skybox.visible = showSkyboxRef.current
      skybox.frustumCulled = false
      skybox.renderOrder = -1000
      scene.add(skybox)

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
        const mat = new THREE.PointsMaterial({
          map: glowTexture, color: colorHex, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        return new THREE.Points(geo, mat)
      }
      const beltDustGroups: any[] = [
        makeBeltDust(55, 85, 230, 0x8f8b85, 2.4, 0.4),
        makeBeltDust(55, 85, 35, 0xb8b4ad, 4, 0.6),
        makeBeltDust(188, 242, 1800, 0x3fe6cc, 2.6, 0.42),
        makeBeltDust(188, 242, 260, 0x9ffbe9, 4.4, 0.8),
        makeBeltDust(494, 586, 1000, 0x7d8ce0, 2.6, 0.4),
        makeBeltDust(494, 586, 170, 0xb9c2ff, 4.4, 0.75),
      ]
      beltDustGroups.forEach((g) => scene.add(g))

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
              const scale = targetSize / maxDim
              root.scale.setScalar(scale)
              const center = new THREE.Vector3()
              box.getCenter(center).multiplyScalar(scale)
              root.position.sub(center)
              const wrapper = new THREE.Group()
              wrapper.add(root)
              resolve(wrapper)
            },
            undefined,
            (err: any) => reject(err),
          )
        })

      const attachCustomModel = (b: SolarBody, proceduralVisual: any): any => {
        if (!gltfLoader || !b.modelMediaId) return null
        const anchor = new THREE.Group()
        anchor.add(proceduralVisual)
        const modelUrl = modelUrlsRef.current[b.modelMediaId]
        if (!modelUrl) return null
        setModelLoadErrorsRef.current((prev) => (prev[b.id] ? { ...prev, [b.id]: false } : prev))
        const targetSize = Math.max(b.size * 2.2, 3)
        loadNormalizedModel(modelUrl, targetSize).then((obj) => {
          proceduralVisual.visible = false
          anchor.add(obj)
          anchor.userData.customModel = obj
        }).catch((err) => {
          console.error("[solar-map] failed to load 3D model for \"" + (b.name || b.id) + "\":", err)
          setModelLoadErrorsRef.current((prev) => ({ ...prev, [b.id]: true }))
        })
        return anchor
      }

      const meshEntries: { body: SolarBody; mesh: any; ring: any | null; emblemSprite: any | null }[] = []
      const currentBodies = bodiesRef.current
      const textureLoader = new THREE.TextureLoader()

      currentBodies.forEach((b) => {
        let mesh: any
        if (b.kind === "sun") {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(b.size, 32, 32), new THREE.MeshBasicMaterial({ color: b.color }))
          mesh.add(makeGlowSprite(b.color, b.size * 4.2, 0.55))
          mesh.add(makeGlowSprite(b.color, b.size * 2.6, 0.75))
          mesh.add(makeGlowSprite(0xfff6d8, b.size * 1.5, 0.9))

          // Dyson swarm decoration — orbits the sun as a separate group, never
          // replaces the sun's own sphere+glow above. If the sun has a
          // modelMediaId (a swarm-craft .glb), each shell instances that model
          // in a Fibonacci-sphere distribution with panels facing the sun;
          // otherwise a simple particle-point swarm is used as a lightweight
          // fallback so there's still a visible swarm with no model uploaded.
          const swarmModelUrl = b.modelMediaId ? modelUrlsRef.current[b.modelMediaId] : null
          const DYSON_PANEL_AXIS = new THREE.Vector3(0, 1, 0)
          const buildSwarmShell = (url: string, count: number, distance: number): any => {
            const group = new THREE.Group()
            if (!gltfLoader) return group
            loadNormalizedModel(url, Math.max(b.size * 0.15, 0.8)).then((template) => {
              const golden = Math.PI * (3 - Math.sqrt(5))
              for (let i = 0; i < count; i++) {
                const inst = template.clone(true)
                const yFrac = count > 1 ? 1 - (i / (count - 1)) * 2 : 0
                const ringR = Math.sqrt(Math.max(0, 1 - yFrac * yFrac))
                const theta = golden * i
                const jitter = distance * (1 + (Math.random() - 0.5) * 0.06)
                inst.position.set(Math.cos(theta) * ringR * jitter, yFrac * jitter, Math.sin(theta) * ringR * jitter)
                const sunDir = inst.position.clone().negate().normalize()
                inst.quaternion.setFromUnitVectors(DYSON_PANEL_AXIS, sunDir)
                inst.rotateOnWorldAxis(sunDir, Math.random() * Math.PI * 2)
                group.add(inst)
              }
            }).catch((err) => {
              console.error("[solar-map] failed to load Dyson swarm model for \"" + (b.name || b.id) + "\":", err)
              setModelLoadErrorsRef.current((prev) => ({ ...prev, [b.id]: true }))
            })
            return group
          }

          if (gltfLoader && swarmModelUrl) {
            setModelLoadErrorsRef.current((prev) => (prev[b.id] ? { ...prev, [b.id]: false } : prev))
            const swarmShells = new THREE.Group()
            const shells = [
              { distance: b.size * 1.6, count: 180 },
              { distance: b.size * 1.85, count: 220 },
              { distance: b.size * 2.1, count: 260 },
            ]
            shells.forEach(shell => {
              const shellGroup = buildSwarmShell(swarmModelUrl, shell.count, shell.distance)
              swarmShells.add(shellGroup)
            })
            mesh.add(swarmShells)
            mesh.userData.swarm = swarmShells
          } else {
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
            const pinTex = makePinTexture(b.color)
            mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, transparent: true, depthWrite: false }))
            const s = Math.max(b.size * 3.2, 5)
            mesh.scale.set(s, s, 1)
          } else {
            mesh = new THREE.Mesh(
              new THREE.ConeGeometry(Math.max(b.size * 0.8, 1), Math.max(b.size * 1.9, 2.6), 6),
              new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.2, emissive: new THREE.Color(b.color), emissiveIntensity: 0.35 }),
            )
          }
        } else if (b.shattered) {
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

        if (b.kind !== "sun") {
          const wrapped = attachCustomModel(b, mesh)
          if (wrapped) mesh = wrapped
        }

        scene.add(mesh)

        let emblemSprite: any = null

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

      const meshList = meshEntries.map((m) => m.mesh)

      const maxSafeBoost = new Map<string, number>()
      meshEntries.forEach((entry) => {
        if (entry.body.kind !== "planet" && entry.body.kind !== "sun") return
        let closestMoonOrbit = Infinity
        meshEntries.forEach((child) => {
          if (child.body.parentId === entry.body.id && child.body.kind === "moon") {
            closestMoonOrbit = Math.min(closestMoonOrbit, child.body.orbitRadius)
          }
        })
        if (closestMoonOrbit === Infinity) {
          maxSafeBoost.set(entry.body.id, PLANET_CLICK_BOOST)
        } else {
          const safeScale = Math.max(1, (closestMoonOrbit * 0.8) / Math.max(entry.body.size, 0.01))
          maxSafeBoost.set(entry.body.id, Math.min(PLANET_CLICK_BOOST, safeScale))
        }
      })

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

      type Ripple = { mesh: any; life: number; maxLife: number; startScale: number; endScale: number }
      const ripples: Ripple[] = []
      const rippleGeo = new THREE.RingGeometry(0.985, 1, 96)
      const RIPPLE_MAX_RADIUS = 760
      const spawnRipple = (x: number, z: number) => {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x7ef9ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
        const mesh = new THREE.Mesh(rippleGeo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(x, 0.5, z)
        mesh.scale.setScalar(6)
        scene.add(mesh)
        ripples.push({ mesh, life: 0, maxLife: 2.2, startScale: 6, endScale: RIPPLE_MAX_RADIUS })
      }

      const HOVER_COLOR = 0x8ff7ff
      const hoverGroup = new THREE.Group()
      hoverGroup.visible = false
      const hoverGlow = makeGlowSprite(HOVER_COLOR, 1, 0.22)
      hoverGroup.add(hoverGlow)
      const hoverShell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: HOVER_COLOR, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }),
      )
      hoverGroup.add(hoverShell)
      const scanMat = new THREE.MeshBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      const scanRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 56), scanMat)
      scanRing.rotation.x = Math.PI / 2
      scanRing.visible = false
      hoverGroup.add(scanRing)
      const scanTrailMat = new THREE.MeshBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      const scanTrail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 56), scanTrailMat)
      scanTrail.rotation.x = Math.PI / 2
      scanTrail.visible = false
      hoverGroup.add(scanTrail)
      scene.add(hoverGroup)
      let hoverClientX = -99999
      let hoverClientY = -99999

      const pose = poseRef.current ?? (poseRef.current = { azimuth: 0.9, elevation: 0.5, distance: 4200, target: new THREE.Vector3(0, 0, 0) })
      const free = { distance: 4200, target: new THREE.Vector3(0, 0, 0) }
      let lastFocusedId: string | null = null

      const raycaster = new THREE.Raycaster()
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const ndc = new THREE.Vector2()

      let dragMode: "none" | "orbit" | "pan" | "reposition" = "none"
      let dragBodyEntry: { body: SolarBody; mesh: any; ring: any | null } | null = null
      let dragBodyIndex = -1
      let dragPreview: { orbitRadius: number; angleOffset: number } | null = null
      let dragArmed = false
      let dragAnchor: { hitX: number; hitZ: number; bodyX: number; bodyZ: number } | null = null
      let awaitingConfirmEntry: { body: SolarBody; mesh: any; ring: any | null } | null = null
      let awaitingConfirmIndex = -1
      let awaitingConfirmPatch: { orbitRadius: number; angleOffset: number } | null = null
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
        const hits = raycaster.intersectObjects(meshList, true)
        if (hits.length === 0) return -1
        const resolved: number[] = []
        const seen = new Set<number>()
        for (const hit of hits) {
          let obj = hit.object
          while (obj && !meshEntries.some((m) => m.mesh === obj)) obj = obj.parent
          if (!obj) continue
          const idx = meshEntries.findIndex((m) => m.mesh === obj)
          if (idx >= 0 && !seen.has(idx)) { seen.add(idx); resolved.push(idx) }
        }
        if (resolved.length === 0) return -1
        const closest = resolved[0]
        const closestBody = meshEntries[closest].body
        if (closestBody.kind === "planet" || closestBody.kind === "sun") {
          const childHit = resolved.find((idx) => {
            const b = meshEntries[idx].body
            return b.parentId === closestBody.id && (b.kind === "moon" || b.kind === "station" || b.kind === "ship" || b.kind === "location")
          })
          if (childHit != null) return childHit
        }
        return closest
      }

      const performTapSelect = (clientX: number, clientY: number) => {
        pointFromEvent(clientX, clientY)
        raycaster.setFromCamera(ndc, camera)
        const allHits = raycaster.intersectObjects(meshList, true)

        if (allHits.length > 0) {
          const idx = pickBody(clientX, clientY)
          const clickedId = idx >= 0 ? currentBodies[idx]?.id : null
          if (clickedId) {
            setFocusedId(clickedId)
            const b = bodiesRef.current.find((x) => x.id === clickedId)
            if (b) {
              const pos = computeVisualPositions(bodiesRef.current, orbitClockMs).get(b.id) || { x: 0, y: 0 }
              spawnRipple(pos.x, pos.y)
              SFX.select()
            }
          }
          else if (focusedIdRef.current != null) setFocusedId(null)
        } else {
          if (focusedIdRef.current != null) setFocusedId(null)
        }
      }

      const onContextMenu = (e: Event) => e.preventDefault()
      const onPointerLeave = () => { hoverClientX = -99999; hoverClientY = -99999 }

      const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType === "touch") return
        lastX = e.clientX
        lastY = e.clientY
        moved = 0
        const rawIdx = editingRef.current ? pickBody(e.clientX, e.clientY) : -1
        const idx = rawIdx >= 0 && meshEntries[rawIdx].body.kind !== "sun" ? rawIdx : -1
        if (idx >= 0 && editingRef.current) {
          dragMode = "none"
          dragBodyEntry = meshEntries[idx]
          dragBodyIndex = idx
          dragPreview = null
          dragArmed = true
          dragAnchor = null
        } else if (e.button === 2 || e.button === 1 || e.shiftKey) {
          dragMode = "pan"
          dragArmed = false
        } else {
          dragMode = "orbit"
          dragArmed = false
        }
      }

      const onPointerMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return
        hoverClientX = e.clientX
        hoverClientY = e.clientY
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
        moved += Math.abs(dx) + Math.abs(dy)

        if (dragArmed && dragBodyEntry && dragMode !== "reposition" && moved >= 6) {
          pointFromEvent(e.clientX, e.clientY)
          raycaster.setFromCamera(ndc, camera)
          const anchorHit = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(groundPlane, anchorHit)) {
            dragAnchor = { hitX: anchorHit.x, hitZ: anchorHit.z, bodyX: dragBodyEntry.mesh.position.x, bodyZ: dragBodyEntry.mesh.position.z }
            dragMode = "reposition"
          }
        }

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
          if (focusedIdRef.current == null) free.target.copy(pose.target)
        } else if (dragMode === "reposition" && dragBodyEntry && dragAnchor) {
          pointFromEvent(e.clientX, e.clientY)
          raycaster.setFromCamera(ndc, camera)
          const hit = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(groundPlane, hit)) {
            const targetX = dragAnchor.bodyX + (hit.x - dragAnchor.hitX)
            const targetZ = dragAnchor.bodyZ + (hit.z - dragAnchor.hitZ)
            const b = dragBodyEntry.body
            const visualPositions = computeVisualPositions(bodiesRef.current, orbitClockMs)
            const parentPos = b.parentId ? visualPositions.get(b.parentId) || { x: 0, y: 0 } : { x: 0, y: 0 }
            const rawParams = ownParamsForPoint({ x: targetX, y: targetZ }, parentPos, b.periodSeconds, orbitClockMs)
            const params = b.parentId ? rawParams : { orbitRadius: logicalFromVisualRadius(rawParams.orbitRadius), angleOffset: rawParams.angleOffset }
            const minRadius = b.parentId ? 4 : 15
            params.orbitRadius = Math.max(params.orbitRadius, minRadius)
            dragPreview = params
            dragBodyEntry.mesh.position.set(targetX, 0, targetZ)
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
        if (e.pointerType === "touch") return
        if (dragMode === "reposition" && dragBodyEntry && dragPreview) {
          awaitingConfirmEntry = dragBodyEntry
          awaitingConfirmIndex = dragBodyIndex
          awaitingConfirmPatch = dragPreview
          setPendingRepositionRef.current({ name: dragBodyEntry.body.name || "Object" })
        } else if (moved < 6) {
          performTapSelect(e.clientX, e.clientY)
        }
        dragMode = "none"
        dragBodyEntry = null
        dragBodyIndex = -1
        dragPreview = null
        dragArmed = false
        dragAnchor = null
      }

      const confirmPendingReposition = () => {
        if (awaitingConfirmIndex >= 0 && awaitingConfirmPatch) {
          onUpdateBodyRef.current(awaitingConfirmIndex, { orbitRadius: awaitingConfirmPatch.orbitRadius, angleOffset: awaitingConfirmPatch.angleOffset })
          SFX.confirm()
        }
        awaitingConfirmEntry = null
        awaitingConfirmIndex = -1
        awaitingConfirmPatch = null
        setPendingRepositionRef.current(null)
      }
      const cancelPendingReposition = () => {
        SFX.cancel()
        if (awaitingConfirmEntry && awaitingConfirmEntry.ring) {
          const b = awaitingConfirmEntry.body
          const ring = awaitingConfirmEntry.ring
          const pts: any[] = []
          if (b.kind === "planet" || ((b.kind === "station" || b.kind === "ship") && !b.parentId)) {
            const visualRadius = visualFromLogicalRadius(b.orbitRadius)
            for (let a = 0; a <= 96; a++) { const t = (a / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * visualRadius, 0, Math.sin(t) * visualRadius)) }
            ring.position.set(0, 0, 0)
          } else {
            for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * b.orbitRadius, 0, Math.sin(t) * b.orbitRadius)) }
            const parentPos = b.parentId ? computeVisualPositions(bodiesRef.current, orbitClockMs).get(b.parentId) || { x: 0, y: 0 } : { x: 0, y: 0 }
            ring.position.set(parentPos.x, 0, parentPos.y)
          }
          ring.geometry.setFromPoints(pts)
          if (ring.computeLineDistances) ring.computeLineDistances()
        }
        awaitingConfirmEntry = null
        awaitingConfirmIndex = -1
        awaitingConfirmPatch = null
        setPendingRepositionRef.current(null)
      }
      confirmRepositionRef.current = confirmPendingReposition
      cancelRepositionRef.current = cancelPendingReposition

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        pose.distance = Math.min(12000, Math.max(15, pose.distance * (e.deltaY > 0 ? 1.1 : 0.9)))
        if (focusedIdRef.current == null) free.distance = pose.distance
      }

      const touches: Map<number, { x: number; y: number }> = new Map()
      let initialPinchDistance = 0
      let touchMoved = 0
      let touchWasMultiTouch = false
      let tapCandidate: { x: number; y: number } | null = null

      const onTouchStart = (e: TouchEvent) => {
        e.preventDefault()
        Array.from(e.touches).forEach(t => {
          touches.set(t.identifier, { x: t.clientX, y: t.clientY })
        })
        if (e.touches.length === 1) {
          touchMoved = 0
          touchWasMultiTouch = false
          tapCandidate = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        } else {
          touchWasMultiTouch = true
          tapCandidate = null
        }
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
          const t = e.touches[0]
          const prev = touches.get(t.identifier)
          if (prev) {
            const dx = t.clientX - prev.x
            const dy = t.clientY - prev.y
            touchMoved += Math.abs(dx) + Math.abs(dy)
            pose.azimuth -= dx * 0.008
            pose.elevation = Math.min(1.5, Math.max(0.05, pose.elevation + dy * 0.008))
            touches.set(t.identifier, { x: t.clientX, y: t.clientY })
          }
        } else if (e.touches.length === 2) {
          touchWasMultiTouch = true
          tapCandidate = null
          const t0 = e.touches[0]
          const t1 = e.touches[1]
          const dx = t1.clientX - t0.clientX
          const dy = t1.clientY - t0.clientY
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (initialPinchDistance > 0) {
            const scale = initialPinchDistance / distance
            pose.distance = Math.min(12000, Math.max(15, pose.distance * scale))
            if (focusedIdRef.current == null) free.distance = pose.distance
          }
          initialPinchDistance = distance
        }
      }

      const onTouchEnd = (e: TouchEvent) => {
        e.preventDefault()
        if (!touchWasMultiTouch && touchMoved < 6 && tapCandidate && e.touches.length === 0) {
          performTapSelect(tapCandidate.x, tapCandidate.y)
        }
        Array.from(e.changedTouches).forEach(t => {
          touches.delete(t.identifier)
        })
        if (e.touches.length < 2) {
          initialPinchDistance = 0
        }
        if (e.touches.length === 0) {
          tapCandidate = null
        }
      }

      const onContextLost = (e: Event) => { e.preventDefault() }
      const onContextRestored = () => { setRebuildNonce((n) => n + 1) }

      canvas.addEventListener("webglcontextlost", onContextLost, false)
      canvas.addEventListener("webglcontextrestored", onContextRestored, false)

      canvas.addEventListener("pointerdown", onPointerDown)
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", onPointerUp)
      canvas.addEventListener("pointerleave", onPointerLeave)
      canvas.addEventListener("wheel", onWheel, { passive: false })
      canvas.addEventListener("contextmenu", onContextMenu)
      canvas.addEventListener("touchstart", onTouchStart, { passive: false })
      canvas.addEventListener("touchmove", onTouchMove, { passive: false })
      canvas.addEventListener("touchend", onTouchEnd, { passive: false })


      const closeDistanceFor = (b: SolarBody) => Math.max(b.size * 11, 45)
      const camDir = new THREE.Vector3()
      // THREE.Clock is deprecated (logs a console warning on every scene
      // rebuild) in favor of THREE.Timer, whose API differs enough that
      // swapping it in blind risks a real behavior change we can't visually
      // verify here. This tiny shim reproduces only the two members this
      // file actually reads — getDelta() and elapsedTime — with the same
      // semantics (elapsedTime accumulates as of the last getDelta() call).
      const clock = (() => {
        let last = performance.now()
        let elapsedTime = 0
        return {
          getDelta(): number {
            const now = performance.now()
            const dt = (now - last) / 1000
            last = now
            elapsedTime += dt
            return dt
          },
          get elapsedTime() { return elapsedTime },
        }
      })()
      let raf = 0
      let lastReadout = 0
      let orbitClockMs = Date.now()

      const tick = () => {
        if (disposed) return
        const dt = Math.min(clock.getDelta(), 0.1)
        if (!pausedRef.current) orbitClockMs += dt * 1000
        const now = orbitClockMs
        const positions = computeVisualPositions(bodiesRef.current, now)
        const focusedBody = focusedIdRef.current != null ? bodiesRef.current.find((b) => b.id === focusedIdRef.current) || null : null
        const focusedBodyId = focusedBody ? focusedBody.id : null
        if (focusedBodyId && focusedBodyId !== lastFocusedId && focusedBody!.parentId) {
          const parentPos = positions.get(focusedBody!.parentId)
          const ownPos = positions.get(focusedBodyId)
          if (parentPos && ownPos) {
            const dx = ownPos.x - parentPos.x
            const dz = ownPos.y - parentPos.y
            if (dx !== 0 || dz !== 0) pose.azimuth = Math.atan2(dx, dz)
          }
        }
        lastFocusedId = focusedBodyId
        const beltsVisible = visibleKindsRef.current.asteroid
        beltDustGroups.forEach((g) => { g.visible = beltsVisible })
        skybox.visible = showSkyboxRef.current
        skyboxMaterial.uniforms.uTime.value = clock.elapsedTime
        const superZoomed = focusedBody != null && pose.distance < closeDistanceFor(focusedBody) * 1.4

        const camRight = new THREE.Vector3()
        const camUp = new THREE.Vector3()
        {
          const fwd = new THREE.Vector3()
          camera.getWorldDirection(fwd)
          camRight.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
          camUp.crossVectors(camRight, fwd).normalize()
        }

        meshEntries.forEach((entry) => {
          if (dragBodyEntry === entry) return
          if (awaitingConfirmEntry === entry) return
          const isZoomGatedOrbiter = entry.body.kind === "location" || ((entry.body.kind === "station" || entry.body.kind === "ship") && entry.body.parentId)
          const locationGate = !isZoomGatedOrbiter || (entry.body.parentId === focusedBodyId && superZoomed) || entry.body.id === focusedBodyId
          const visible = visibleKindsRef.current[entry.body.kind] && locationGate
          entry.mesh.visible = visible
          if (entry.ring) entry.ring.visible = visible
          if (!visible) return
          const pos = positions.get(entry.body.id) || { x: 0, y: 0 }
          entry.mesh.position.set(pos.x, 0, pos.y)
          const thisIsFocused = focusedBodyId === entry.body.id
          if (entry.body.kind === "sun" || entry.body.kind === "planet") {
            const distToCam = camera.position.distanceTo(entry.mesh.position)
            const cd = closeDistanceFor(entry.body)
            const shrinkFar = cd * 20
            const shrinkNear = cd * 0.85
            const t = Math.max(0, Math.min(1, (distToCam - shrinkNear) / Math.max(shrinkFar - shrinkNear, 1)))
            const boost = maxSafeBoost.get(entry.body.id) ?? PLANET_CLICK_BOOST
            entry.mesh.scale.setScalar(1 + (boost - 1) * t)
          }
          if (entry.body.kind === "sun") {
            sunLight.position.set(pos.x, 0, pos.y)
          } else if (entry.mesh.userData.customModel) {
          }
          if (entry.ring && (entry.body.kind === "moon" || entry.body.kind === "location" || ((entry.body.kind === "station" || entry.body.kind === "ship") && entry.body.parentId))) {
            const parentPos = entry.body.parentId ? positions.get(entry.body.parentId) || { x: 0, y: 0 } : { x: 0, y: 0 }
            entry.ring.position.set(parentPos.x, 0, parentPos.y)
          }
          if (entry.body.kind === "station" || entry.body.kind === "ship") {
            entry.mesh.rotation.y = ((entry.body.facingAngle || 0) * Math.PI) / 180
          } else {
            entry.mesh.rotation.y += dt * 0.15
          }
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

        tierHighlights.forEach((h) => { h.mesh.visible = hoveredTierRef.current === h.id })

        let hoveredIdx = -1
        if (dragMode === "none" && hoverClientX > -50000) {
          hoveredIdx = pickBody(hoverClientX, hoverClientY)
        }
        canvas.style.cursor = hoveredIdx >= 0 ? "pointer" : dragMode === "pan" ? "grabbing" : "grab"
        if (hoveredIdx >= 0 && meshEntries[hoveredIdx].mesh.visible) {
          const entry = meshEntries[hoveredIdx]
          hoverGroup.visible = true
          hoverGroup.position.copy(entry.mesh.position)
          const s = Math.max(entry.body.size * 1.7, 6) * (entry.mesh.scale.x || 1)
          const pulse = 0.94 + Math.sin(now / 320) * 0.06
          hoverGlow.scale.set(s * 2.1 * pulse, s * 2.1 * pulse, 1)
          hoverShell.scale.setScalar(s * 1.1)
          hoverShell.rotation.y += dt * 0.3
          hoverShell.rotation.x += dt * 0.12

          const SCAN_CYCLE_MS = 3400
          const SCAN_DURATION_MS = 1300
          const shellR = s * 1.1
          const cyclePos = now % SCAN_CYCLE_MS
          if (cyclePos < SCAN_DURATION_MS) {
            const p = cyclePos / SCAN_DURATION_MS
            const fade = Math.min(p * 6, (1 - p) * 6, 1)
            const y = -1 + p * 2
            const r = Math.sqrt(Math.max(1 - y * y, 0.02)) * shellR
            scanRing.visible = true
            scanRing.position.y = y * shellR
            scanRing.scale.set(r, r, 1)
            scanMat.opacity = 0.8 * fade

            const trailP = Math.max(0, p - 0.08)
            const trailY = -1 + trailP * 2
            const trailR = Math.sqrt(Math.max(1 - trailY * trailY, 0.02)) * shellR
            scanTrail.visible = true
            scanTrail.position.y = trailY * shellR
            scanTrail.scale.set(trailR, trailR, 1)
            scanTrailMat.opacity = 0.35 * fade
          } else {
            scanRing.visible = false
            scanTrail.visible = false
          }
        } else {
          hoverGroup.visible = false
        }

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
              const t = n > 1 ? j / (n - 1) : 1
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

        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i]
          r.life += dt
          const t = Math.min(1, r.life / r.maxLife)
          const eased = 1 - (1 - t) * (1 - t)
          r.mesh.scale.setScalar(r.startScale + eased * (r.endScale - r.startScale))
          r.mesh.material.opacity = 0.85 * (1 - t) * (1 - t)
          if (r.life > r.maxLife) {
            scene.remove(r.mesh)
            r.mesh.material.dispose()
            ripples.splice(i, 1)
          }
        }

        starNear.rotation.y += dt * 0.002
        starFar.rotation.y += dt * 0.001

        if (tierZoomRequestRef.current) {
          const req = tierZoomRequestRef.current
          if (req === "reset") {
            free.target.set(0, 0, 0)
            free.distance = 4200
          } else {
            const outerVisual = visualFromLogicalRadius(req.outer)
            free.target.set(0, 0, 0)
            free.distance = Math.max(outerVisual * 1.25, 200)
          }
          tierZoomRequestRef.current = null
        }

        let desiredTarget = free.target
        let desiredDistance = free.distance
        if (focusedBody) {
          const p = positions.get(focusedBody.id) || { x: 0, y: 0 }
          desiredTarget = new THREE.Vector3(p.x, 0, p.y)
          desiredDistance = closeDistanceFor(focusedBody)
        }
        if (surfaceExitLockRef.current && (!focusedBody || focusedBody.id !== surfaceExitLockRef.current || pose.distance > closeDistanceFor(focusedBody) * 0.9)) {
          surfaceExitLockRef.current = null
        }
        const exitLocked = focusedBody != null && surfaceExitLockRef.current === focusedBody.id
        if (focusedBody && focusedBody.surfaceMapDocumentId && !surfaceTargetRef.current && !exitLocked && pose.distance < closeDistanceFor(focusedBody) * 0.62) {
          setSurfaceTarget({ bodyId: focusedBody.id, revealed: false })
        } else if (surfaceTargetRef.current && !surfaceTargetRef.current.revealed) {
          const cancelBody = bodiesRef.current.find((x) => x.id === surfaceTargetRef.current!.bodyId)
          if (!cancelBody || pose.distance > closeDistanceFor(cancelBody) * 0.95) setSurfaceTarget(null)
        }
        const surfaceZoom = surfaceTargetRef.current
        if (surfaceZoom) {
          const sb = bodiesRef.current.find((x) => x.id === surfaceZoom.bodyId)
          if (sb) {
            const p = positions.get(sb.id) || { x: 0, y: 0 }
            desiredTarget = new THREE.Vector3(p.x, 0, p.y)
            desiredDistance = closeDistanceFor(sb) * 0.22
            if (!surfaceZoom.revealed && pose.distance < closeDistanceFor(sb) * 0.34) {
              setSurfaceTarget((s) => (s && s.bodyId === surfaceZoom.bodyId ? { ...s, revealed: true } : s))
            }
          }
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
        skybox.position.copy(camera.position)

        const rect = canvas.getBoundingClientRect()
        const fovRad = (camera.fov * Math.PI) / 180
        meshEntries.forEach((entry) => {
          const el = labelRefs.current.get(entry.body.id)
          if (!el) return
          const isZoomGatedOrbiter = entry.body.kind === "location" || ((entry.body.kind === "station" || entry.body.kind === "ship") && entry.body.parentId)
          const locationGate = !isZoomGatedOrbiter || (entry.body.parentId === focusedBodyId && superZoomed) || entry.body.id === focusedBodyId
          if (!visibleKindsRef.current[entry.body.kind] || !locationGate) { el.style.display = "none"; return }
          const worldPos = entry.mesh.position
          const toPoint = worldPos.clone().sub(camera.position)
          const distToCam = toPoint.length()
          const showAlways = entry.body.kind === "planet" || entry.body.kind === "station" || entry.body.kind === "ship" || entry.body.kind === "sun" || entry.body.kind === "location"
          const showMoon = entry.body.kind === "moon" && distToCam < 220
          if (!showAlways && !showMoon) { el.style.display = "none"; return }
          if (toPoint.dot(camDir) <= 0) { el.style.display = "none"; return }
          const v = worldPos.clone().project(camera)
          if (v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = "none"; return }
          const x = (v.x * 0.5 + 0.5) * rect.width
          const y = (-v.y * 0.5 + 0.5) * rect.height
          const apparentRadiusPx = ((entry.body.size * (entry.mesh.scale.x || 1)) / Math.max(distToCam, 1)) / Math.tan(fovRad / 2) * (rect.height / 2)
          const labelOffset = Math.min(Math.max(apparentRadiusPx + 6, 8), 70)
          el.style.display = "block"
          el.style.transform = "translate(" + (x + labelOffset) + "px, " + y + "px) translateY(-50%)"
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
          confirmRepositionRef.current = () => {}
          cancelRepositionRef.current = () => {}
          setPendingRepositionRef.current(null)
          canvas.removeEventListener("pointerdown", onPointerDown)
          window.removeEventListener("pointermove", onPointerMove)
          window.removeEventListener("pointerup", onPointerUp)
          canvas.removeEventListener("pointerleave", onPointerLeave)
          canvas.removeEventListener("wheel", onWheel)
          canvas.removeEventListener("contextmenu", onContextMenu)
          canvas.removeEventListener("touchstart", onTouchStart)
          canvas.removeEventListener("touchmove", onTouchMove)
          canvas.removeEventListener("touchend", onTouchEnd)
          canvas.removeEventListener("webglcontextlost", onContextLost)
          canvas.removeEventListener("webglcontextrestored", onContextRestored)
          cancelAnimationFrame(raf)
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
  }, [structuralKey, rebuildNonce, modelReadyKey])

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

  useEffect(() => {
    if (!pendingFocusIdRef.current) return
    if (bodies.some((b) => b.id === pendingFocusIdRef.current)) {
      setFocusedId(pendingFocusIdRef.current)
      pendingFocusIdRef.current = null
    }
  }, [bodies])

  const focused = focusedId != null ? bodies.find((b) => b.id === focusedId) || null : null
  const focusedIndex = focused ? bodies.findIndex((b) => b.id === focused.id) : -1
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

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
        {bodies.map((b) => (
          <div
            key={b.id}
            ref={(el) => { if (el) labelRefs.current.set(b.id, el); else labelRefs.current.delete(b.id) }}
            style={{ position: "absolute", left: 0, top: 0, display: "none", fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.5, color: "#c7d3e8", whiteSpace: "nowrap", transform: "translateY(-50%)" }}
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
          <button type="button" onClick={onShowClassic} style={monoBtn}>☰ All Entries</button>
          {editing && <button type="button" onClick={onSeed} style={monoBtn}>⨁ Seed</button>}
          {editing && <button type="button" onClick={() => setAdding((a) => !a)} style={monoBtn}>+ Add Object</button>}
          {editing && <button type="button" onClick={logMediaAudit} style={monoBtn}>🔍 Audit Media</button>}
          {editing && (
            <button type="button" onClick={() => setConfirmNuke(true)} style={{ ...monoBtn, border: "1px solid rgba(240,120,120,0.5)", color: "#f4c8c8" }}>
              ☢ Nuclear Clear
            </button>
          )}
        </div>
      </div>

      {editing && unpublishableMedia.length > 0 && (
        <div style={{
          position: "absolute", top: 62, left: 20, right: 20, zIndex: 3, padding: "9px 14px", borderRadius: 4,
          border: "1px solid rgba(255,158,84,0.4)", background: "rgba(20,14,8,0.85)", backdropFilter: "blur(4px)",
          fontFamily: MONO, fontSize: 11, color: "#ffb27a", lineHeight: 1.5,
        }}>
          ⚠ Publish will fail — {unpublishableMedia.map((h, i) => (
            <span key={i}>{i > 0 && ", "}<b>{h.name}</b>'s {h.field}</span>
          ))} {unpublishableMedia.length === 1 ? "isn't" : "aren't"} a real uploaded file (a local dev path, or a reference to media that's missing/deleted). Open the body's panel and re-set the {unpublishableMedia.length === 1 ? "field" : "fields"} through the actual upload picker.
        </div>
      )}

      {adding && (
        <AddObjectPanel
          bodies={bodies}
          attachable={attachableBodies}
          onAdd={(b) => {
            const newId = onAddBody(b)
            if (typeof newId === "string") pendingFocusIdRef.current = newId
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {pendingReposition && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            zIndex: 7,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 5,
            border: "1px solid rgba(255,158,84,0.45)",
            background: "rgba(8,11,19,0.94)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, color: "#f0d9c4" }}>
            REPOSITION {pendingReposition.name.toUpperCase()}?
          </span>
          <button
            type="button"
            onClick={() => confirmRepositionRef.current()}
            style={{ padding: "5px 11px", borderRadius: 3, border: "1px solid #59d98e", background: "rgba(89,217,142,0.15)", color: "#c8f4d8", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            ✓ Confirm
          </button>
          <button
            type="button"
            onClick={() => cancelRepositionRef.current()}
            style={{ padding: "5px 11px", borderRadius: 3, border: "1px solid rgba(240,120,120,0.5)", background: "rgba(240,90,90,0.12)", color: "#f4c8c8", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {confirmNuke && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            zIndex: 7,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 5,
            border: "1px solid rgba(240,120,120,0.6)",
            background: "rgba(8,11,19,0.94)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, color: "#f4c8c8" }}>
            CLEAR 3D MODEL + EMBLEM FROM {bodies.filter((b) => b.modelMediaId || b.emblemMediaId).length} BODIES?
          </span>
          <button
            type="button"
            onClick={nukeAllMedia}
            style={{ padding: "5px 11px", borderRadius: 3, border: "1px solid rgba(240,120,120,0.5)", background: "rgba(240,90,90,0.2)", color: "#f4c8c8", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            ☢ Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmNuke(false)}
            style={{ padding: "5px 11px", borderRadius: 3, border: "1px solid rgba(140,170,220,0.35)", background: "rgba(10,14,23,0.5)", color: "#c7d3e8", cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {editing && (
        <div style={{ position: "absolute", left: 18, top: navOpen ? 74 : "50%", bottom: navOpen ? 110 : "auto", transform: navOpen ? undefined : "translateY(-50%)", zIndex: 4, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <button
            type="button"
            onClick={() => { SFX.toggle(); setNavOpen((v) => !v) }}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 4,
              border: "1px solid " + (navOpen ? HUD.amberDim : HUD.blueFaint),
              background: navOpen ? HUD.amberBg : "rgba(10,14,23,0.65)", color: navOpen ? HUD.warm : HUD.inkFaint,
              cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase",
              backdropFilter: "blur(3px)", flexShrink: 0,
            }}
          >
            ☰ Objects
          </button>
          {navOpen && (
            <div style={{
              width: 240, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 5,
              border: "1px solid " + HUD.blueFaint, background: "rgba(8,11,19,0.94)", backdropFilter: "blur(6px)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)", overflow: "hidden",
            }}>
              <div style={{ padding: "9px 12px", borderBottom: "1px solid " + HUD.blueFaint, fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, color: HUD.mutedDark, textTransform: "uppercase" }}>
                All Objects — {bodies.filter((b) => b.kind !== "sun").length}
              </div>
              <input
                autoFocus
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder="Search objects…"
                style={{ padding: "9px 12px", border: "none", borderBottom: "1px solid " + HUD.blueFaint, background: "transparent", color: HUD.inkDim, fontFamily: MONO, fontSize: 12, outline: "none", flexShrink: 0 }}
              />
              <div style={{ overflowY: "auto", padding: 6 }}>
                {bodies
                  .filter((b) => b.kind !== "sun" && (b.name || "").toLowerCase().includes(navQuery.trim().toLowerCase()))
                  .map((b) => {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { SFX.select(); setFocusedId(b.id); setHoveredTier(null) }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                          padding: "7px 9px", borderRadius: 3, border: "none", background: "transparent",
                          color: HUD.inkFaint, cursor: "pointer", fontFamily: MONO, fontSize: 12.5,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,158,84,0.08)"; e.currentTarget.style.color = HUD.ink }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = HUD.inkFaint }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "Unnamed"}</span>
                        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 8.5, color: HUD.mutedDark, textTransform: "uppercase", flexShrink: 0 }}>{b.kind}</span>
                      </button>
                    )
                  })}
                {bodies.filter((b) => b.kind !== "sun" && (b.name || "").toLowerCase().includes(navQuery.trim().toLowerCase())).length === 0 && (
                  <div style={{ padding: "10px 9px", fontFamily: MONO, fontSize: 11, color: HUD.mutedDark }}>No matches.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{
        position: "absolute", left: 18, bottom: 100, zIndex: 2, display: "flex", flexDirection: "column", gap: 6,
        padding: "10px 12px", borderRadius: 5, background: "rgba(6,8,16,0.55)", backdropFilter: "blur(3px)",
      }}>
        {TIER_BANDS.map((band) => {
          const active = hoveredTier === band.id
          return (
            <button
              key={band.id}
              type="button"
              onClick={() => {
                SFX.toggle()
                if (active) {
                  setHoveredTier(null)
                  tierZoomRequestRef.current = "reset"
                } else {
                  setHoveredTier(band.id)
                  setFocusedId(null)
                  tierZoomRequestRef.current = { id: band.id, outer: band.radius }
                }
              }}
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

      <div style={{
        position: "absolute", right: 18, bottom: 140, zIndex: 2, display: "flex", flexDirection: "column", gap: 5,
        alignItems: "flex-end", padding: "9px 12px", borderRadius: 5,
        border: "1px solid rgba(140,170,220,0.22)", background: "rgba(10,14,23,0.55)", backdropFilter: "blur(3px)",
      }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.2, color: "#7186a8", marginBottom: 2 }}>LAYERS</span>
        {(["sun", "planet", "moon", "asteroid", "station", "ship", "location"] as BodyKind[]).map((k) => {
          const on = visibleKinds[k]
          return (
            <button
              key={k}
              type="button"
              onClick={() => { SFX.toggle(); setVisibleKinds((v) => ({ ...v, [k]: !v[k] })) }}
              style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.8, color: on ? "#c7d3e8" : "#4a5468", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, border: "1px solid " + (on ? "#c7d3e8" : "#4a5468"), background: on ? "#c7d3e8" : "transparent" }} />
              {k.toUpperCase()}{k !== "sun" ? "S" : ""}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { SFX.toggle(); setShowSkybox((v) => !v) }}
          style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.8, color: showSkybox ? "#c7d3e8" : "#4a5468", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 2, border: "1px solid " + (showSkybox ? "#c7d3e8" : "#4a5468"), background: showSkybox ? "#c7d3e8" : "transparent" }} />
          SKYBOX
        </button>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, color: "#5c6d8c", zIndex: 2 }}>
        DRAG TO ORBIT · RIGHT-DRAG (OR SHIFT-DRAG) TO PAN · SCROLL TO ZOOM · CLICK A NODE TO OPEN
        {editing ? " · DRAG A NODE TO REPOSITION (CONFIRM TO SAVE)" : ""}
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
          docs={docs}
          onBack={() => setFocusedId(null)}
          onOpen={(id) => { setFocusedId(null); onOpen(id) }}
          onRename={(name) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { name })}
          onLink={(id, name) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { linkedDocumentId: id, linkedDocumentName: name })}
          onUnlink={() => focusedIndex >= 0 && onUpdateBody(focusedIndex, { linkedDocumentId: null, linkedDocumentName: null })}
          onRemove={() => { if (focusedIndex >= 0) onRemoveBody(focusedIndex); setFocusedId(null) }}
          onSetEmblem={(mediaId) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { emblemMediaId: mediaId })}
          onRemoveEmblem={() => focusedIndex >= 0 && onUpdateBody(focusedIndex, { emblemMediaId: null })}
          onSetModel={(mediaId) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { modelMediaId: mediaId })}
          onRemoveModel={() => focusedIndex >= 0 && onUpdateBody(focusedIndex, { modelMediaId: null })}
          onLinkSurfaceMap={(id, name) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { surfaceMapDocumentId: id, surfaceMapDocumentName: name })}
          onUnlinkSurfaceMap={() => focusedIndex >= 0 && onUpdateBody(focusedIndex, { surfaceMapDocumentId: null, surfaceMapDocumentName: null })}
          onSetSize={(size) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { size })}
          onSetFacing={(facingAngle) => focusedIndex >= 0 && onUpdateBody(focusedIndex, { facingAngle })}
          modelLoadFailed={!!modelLoadErrors[focused.id]}
        />
      )}

      {surfaceTarget && (() => {
        const surfaceBody = bodies.find((b) => b.id === surfaceTarget.bodyId)
        if (!surfaceBody) return null
        return (
          <SurfaceMapPanel
            body={surfaceBody}
            revealed={surfaceTarget.revealed}
            onBack={exitSurfaceView}
          />
        )
      })()}

    </div>
  )
}
type PageState = {
  title: string
  subtitle: string
  bannerMediaId: string
  bannerFocusY: number
  sectionOrder: string[]
  featuredIds: string[]
  solarBodies: SolarBody[]
}
const EMPTY_PAGE: PageState = { title: "", subtitle: "", bannerMediaId: "", bannerFocusY: 50, sectionOrder: [], featuredIds: [], solarBodies: [] }

type PageActions = {
  setText: (key: "title" | "subtitle", value: string) => void
  setBanner: (mediaId: string) => void
  setBannerFocus: (focusY: number) => void
  moveSection: (key: string, dir: number) => void
  toggleFeatured: (id: string) => void
  addBody: (body: Omit<SolarBody, "id">) => string
  removeBody: (index: number) => void
  updateBody: (index: number, patch: Partial<SolarBody>) => void
  seedSolarSystem: () => void
}

function tickStyle(pos: "tl" | "br", color: string = HUD.blueDim): CSSProperties {
  return {
    position: "absolute", width: 9, height: 9, pointerEvents: "none",
    borderColor: color, borderStyle: "solid", borderWidth: 0,
    ...(pos === "tl" ? { top: 7, left: 7, borderTopWidth: 1.5, borderLeftWidth: 1.5 } : { bottom: 7, right: 7, borderBottomWidth: 1.5, borderRightWidth: 1.5 }),
  }
}

const STARFIELD_BG =
  "radial-gradient(1.6px 1.6px at 40px 60px, rgba(220,230,255,0.55) 50%, transparent 51%)," +
  "radial-gradient(1.2px 1.2px at 140px 25px, rgba(220,230,255,0.4) 50%, transparent 51%)," +
  "radial-gradient(1.4px 1.4px at 230px 130px, rgba(220,230,255,0.45) 50%, transparent 51%)," +
  "radial-gradient(1px 1px at 300px 85px, rgba(220,230,255,0.35) 50%, transparent 51%)"
const STARFIELD_SIZE = "340px 340px, 340px 340px, 340px 340px, 340px 340px"

const THUMB_RETICLE_CSS = `
.entry-thumb-hero { position: relative; overflow: hidden; }
.entry-thumb-hero .reticle { position: absolute; inset: 0; opacity: 0; transition: opacity 200ms ease; pointer-events: none; }
.entry-thumb-hero:hover .reticle { opacity: 1; }
.entry-thumb-hero .reticle::before, .entry-thumb-hero .reticle::after { content: ""; position: absolute; background: rgba(126,249,255,0.65); box-shadow: 0 0 6px rgba(126,249,255,0.5); }
.entry-thumb-hero .reticle::before { left: 50%; top: 30%; bottom: 30%; width: 1px; transform: translateX(-50%) scaleY(0.4); transition: transform 220ms ease; }
.entry-thumb-hero .reticle::after { top: 50%; left: 30%; right: 30%; height: 1px; transform: translateY(-50%) scaleX(0.4); transition: transform 220ms ease; }
.entry-thumb-hero:hover .reticle::before { transform: translateX(-50%) scaleY(1); }
.entry-thumb-hero:hover .reticle::after { transform: translateY(-50%) scaleX(1); }
.entry-thumb-hero .reticle-corner { position: absolute; width: 14px; height: 14px; border-color: rgba(126,249,255,0.85); border-style: solid; border-width: 0; opacity: 0; transition: opacity 200ms ease, transform 220ms ease; }
.entry-thumb-hero:hover .reticle-corner { opacity: 1; }
.entry-thumb-hero .reticle-corner.tl { top: 8px; left: 8px; border-top-width: 1.5px; border-left-width: 1.5px; transform: translate(4px, 4px); }
.entry-thumb-hero:hover .reticle-corner.tl { transform: translate(0, 0); }
.entry-thumb-hero .reticle-corner.tr { top: 8px; right: 8px; border-top-width: 1.5px; border-right-width: 1.5px; transform: translate(-4px, 4px); }
.entry-thumb-hero:hover .reticle-corner.tr { transform: translate(0, 0); }
.entry-thumb-hero .reticle-corner.bl { bottom: 8px; left: 8px; border-bottom-width: 1.5px; border-left-width: 1.5px; transform: translate(4px, -4px); }
.entry-thumb-hero:hover .reticle-corner.bl { transform: translate(0, 0); }
.entry-thumb-hero .reticle-corner.br { bottom: 8px; right: 8px; border-bottom-width: 1.5px; border-right-width: 1.5px; transform: translate(-4px, -4px); }
.entry-thumb-hero:hover .reticle-corner.br { transform: translate(0, 0); }
.entry-thumb-hero .reticle-scan { position: absolute; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, rgba(126,249,255,0.9), transparent); opacity: 0; }
.entry-thumb-hero:hover .reticle-scan { opacity: 1; animation: thumbScanSweep 1.4s linear infinite; }
@keyframes thumbScanSweep { 0% { top: 6%; } 100% { top: 94%; } }
`

const DOC_CREATED_KEYS = ["createdAt", "created_at", "createdTime", "insertedAt"]
const DOC_UPDATED_KEYS = ["updatedAt", "updated_at", "editedAt", "lastEditedAt", "modifiedAt", "lastModified"]
function docTimestamp(d: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = d[k]
    if (typeof v === "number" && v > 0) return v
    if (typeof v === "string") {
      const t = Date.parse(v)
      if (!Number.isNaN(t)) return t
    }
  }
  return null
}
function recentBadge(d: Record<string, unknown>): "new" | "updated" | null {
  const THRESHOLD_MS = 1000 * 60 * 60 * 24 * 3
  const now = Date.now()
  const created = docTimestamp(d, DOC_CREATED_KEYS)
  if (created != null && now - created < THRESHOLD_MS) return "new"
  const updated = docTimestamp(d, DOC_UPDATED_KEYS)
  if (updated != null && now - updated < THRESHOLD_MS) return "updated"
  return null
}

const DOC_TYPE_PALETTE = [
  { line: "#ff8c42", dim: "rgba(255,158,84,0.4)", bg: "rgba(255,158,84,0.13)", text: "#f0d9c4" },
  { line: "#5fd6e0", dim: "rgba(95,214,224,0.4)", bg: "rgba(95,214,224,0.12)", text: "#c9eef0" },
  { line: "#a98cff", dim: "rgba(169,140,255,0.4)", bg: "rgba(169,140,255,0.12)", text: "#e2dcff" },
  { line: "#ff8ca8", dim: "rgba(255,140,168,0.4)", bg: "rgba(255,140,168,0.12)", text: "#ffdbe4" },
  { line: "#8fdba3", dim: "rgba(143,219,163,0.4)", bg: "rgba(143,219,163,0.12)", text: "#dbf3e0" },
  { line: "#8fb3ea", dim: "rgba(143,179,234,0.4)", bg: "rgba(143,179,234,0.12)", text: "#dbe6fb" },
] as const
const DOC_TYPE_ICONS = ["📁", "🛰️", "🏛️", "📜", "📅", "⚙️"] as const
function docTypeHash(type: string | undefined): number {
  const key = (type || "entry").toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash
}
function colorForDocType(type: string | undefined) {
  return DOC_TYPE_PALETTE[docTypeHash(type) % DOC_TYPE_PALETTE.length]
}
function iconForDocType(type: string | undefined) {
  return DOC_TYPE_ICONS[docTypeHash(type) % DOC_TYPE_ICONS.length]
}

const DOC_KIND_KEYS = ["kind", "cardType", "card_type", "templateName", "template", "type", "category"]
function docKindLabel(d: Record<string, unknown>): string {
  for (const k of DOC_KIND_KEYS) {
    const v = d[k]
    if (typeof v === "string" && v.trim()) return v
  }
  return (d.documentType as string) || "entry"
}

function EntryHero({ mediaId, docType, glyph, style, variant = "tile" }: {
  mediaId: string | null | undefined
  docType: string | undefined
  glyph: string
  style?: CSSProperties
  variant?: "tile" | "article"
}) {
  const media = useHostCapability("media")
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    if (!mediaId) { setUrl(null); return }
    let on = true
    try {
      const ph = media.placeholder(mediaId)
      if (ph) setUrl(ph)
    } catch { /* ignore */ }
    media.resolve(mediaId).then((u) => {
      if (!on) return
      if (!u) { setFailed(true); return }
      const probe = new Image()
      probe.onload = () => { if (on) setUrl(u) }
      probe.onerror = () => { if (on) setFailed(true) }
      probe.src = u
    }).catch(() => { if (on) setFailed(true) })
    return () => { on = false }
  }, [mediaId, media])
  const dc = colorForDocType(docType)
  const showImage = !!url && !failed

  if (variant === "article") {
    // Article hero — a plain, framed image panel rather than the tile's
    // poster treatment: text lives in the right column now, so this is pure
    // visual. A real image is shown at its OWN aspect ratio (object-fit:
    // contain) instead of being cropped to fill. No image → a simple amber
    // ring + initials badge.
    return (
      <div style={{ ...style, position: "relative", overflow: "hidden", background: "radial-gradient(ellipse at 50% 38%, rgba(255,158,84,0.06), transparent 62%), linear-gradient(165deg, rgba(15,19,30,0.96), rgba(6,8,16,0.99))" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.1, backgroundImage: "repeating-linear-gradient(0deg, " + dc.dim + " 0px, " + dc.dim + " 1px, transparent 1px, transparent 5px)" }} />
        <span style={tickStyle("tl", dc.dim)} />
        <span style={tickStyle("br", dc.dim)} />
        {showImage ? (
          <img src={url as string} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div style={{
              width: 132, height: 132, borderRadius: "50%", border: "1.5px solid " + dc.dim,
              background: "radial-gradient(circle at 38% 32%, " + dc.bg + ", rgba(255,255,255,0.01) 70%)",
              display: "grid", placeItems: "center", boxShadow: "0 0 40px " + dc.bg + ", inset 0 0 22px rgba(0,0,0,0.4)",
            }}>
              <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: dc.text, letterSpacing: 1 }}>{glyph}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (showImage) {
    return <div style={{ ...style, backgroundImage: "url(" + JSON.stringify(url) + ")", backgroundSize: "cover", backgroundPosition: "center" }} />
  }
  return (
    <div style={{ ...style, position: "relative", overflow: "hidden", background: "linear-gradient(160deg, rgba(20,26,40,0.92), rgba(8,11,19,0.98))" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.32, backgroundImage: "repeating-linear-gradient(0deg, " + dc.dim + " 0px, " + dc.dim + " 1px, transparent 1px, transparent 4px)" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 42%, " + dc.bg + ", transparent 65%)" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.55, background: "linear-gradient(180deg, transparent 0%, transparent 60%, " + dc.line + " 50%, transparent 51%)", backgroundSize: "100% 220%", animation: "hudSweep 4.5s linear infinite" }} />
      <span style={tickStyle("tl", dc.dim)} />
      <span style={tickStyle("br", dc.dim)} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <span style={{ fontFamily: MONO, fontSize: 30, color: dc.text, opacity: 0.85, textShadow: "0 0 16px " + dc.bg }}>{glyph}</span>
      </div>
    </div>
  )
}

// ── FrozenCardBody ────────────────────────────────────────────────────────
// Renders the baked Prosemirror/Yjs content from snapshot.documents[id] as
// styled rich text. Used on the published site instead of <HostEmbed>, which
// requires a live collab socket that doesn't exist there.
//
// VVD card documents bake their body as a Prosemirror doc JSON under the
// "body" or "content" key (the exact key depends on the card's codec field
// name — we try both). Prosemirror JSON shape:
//   { type: "doc", content: [ { type, attrs, content, marks } ] }
// Marks: { type: "bold" | "italic" | "link", attrs?: { href } }
//
// We render a typed subset sufficient for typical world-lore card bodies.
// Unknown node/mark types fall back to their inline text.
type PmNode = { type: string; text?: string; attrs?: Record<string, unknown>; content?: PmNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[] }

function pmInline(node: PmNode, T: WikiTheme, key: number): ReactNode {
  let el: ReactNode = node.text ?? ""
  if (node.marks) {
    for (const m of node.marks) {
      if (m.type === "bold") el = <strong key={key}>{el}</strong>
      else if (m.type === "italic") el = <em key={key}>{el}</em>
      else if (m.type === "link" && m.attrs?.href) el = <a key={key} href={String(m.attrs.href)} target="_blank" rel="noopener noreferrer" style={{ color: T.link ?? HUD.amber, textDecoration: "underline" }}>{el}</a>
    }
  }
  return el
}

function pmBlock(node: PmNode, T: WikiTheme, idx: number): ReactNode {
  const kids = (node.content ?? []).map((c, i) => pmInline(c, T, i))
  const base: CSSProperties = { margin: "0 0 0.9em", lineHeight: 1.7 }
  switch (node.type) {
    case "paragraph": return <p key={idx} style={base}>{kids.length ? kids : <br />}</p>
    case "heading": {
      const lvl = typeof node.attrs?.level === "number" ? node.attrs.level : 2
      const sizes: Record<number, string> = { 1: "1.5em", 2: "1.25em", 3: "1.1em" }
      return <p key={idx} style={{ ...base, fontWeight: 700, fontSize: sizes[lvl] ?? "1em", marginTop: "1.1em" }}>{kids}</p>
    }
    case "bullet_list": return <ul key={idx} style={{ ...base, paddingLeft: "1.4em" }}>{(node.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map((b, j) => pmBlock(b, T, j))}</li>)}</ul>
    case "ordered_list": return <ol key={idx} style={{ ...base, paddingLeft: "1.4em" }}>{(node.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map((b, j) => pmBlock(b, T, j))}</li>)}</ol>
    case "blockquote": return <blockquote key={idx} style={{ ...base, borderLeft: "3px solid " + HUD.blueDim, paddingLeft: "1em", opacity: 0.8 }}>{(node.content ?? []).map((b, i) => pmBlock(b, T, i))}</blockquote>
    case "horizontal_rule": return <hr key={idx} style={{ border: "none", borderTop: "1px solid " + HUD.blueFaint, margin: "1.2em 0" }} />
    default: return kids.length ? <p key={idx} style={base}>{kids}</p> : null
  }
}

function FrozenCardBody({ docContent, open, T, isPhone, BODY_FF }: {
  docContent: Record<string, unknown>
  open: WikiDocRow
  T: WikiTheme
  isPhone: boolean
  BODY_FF: string
}) {
  // Try common field names for the prose body. VVD card codecs use "body"
  // by convention but some use "content" or "prose".
  const rawBody = docContent.body ?? docContent.content ?? docContent.prose ?? null

  // Also collect simple scalar fields to show as metadata
  const metaFields: { label: string; value: string }[] = []
  for (const [k, v] of Object.entries(docContent)) {
    if (k === "body" || k === "content" || k === "prose") continue
    if (typeof v === "string" && v.trim()) metaFields.push({ label: k, value: v.trim() })
    else if (typeof v === "number") metaFields.push({ label: k, value: String(v) })
  }

  let pmDoc: PmNode | null = null
  if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
    const rb = rawBody as Record<string, unknown>
    if (rb.type === "doc" && Array.isArray(rb.content)) pmDoc = rb as PmNode
  }

  const hasContent = pmDoc || metaFields.length > 0

  return (
    <div style={{
      padding: isPhone ? "18px 20px 32px" : "24px 36px 48px",
      overflowY: "auto", height: "100%",
      fontFamily: BODY_FF, color: T.ink ?? HUD.ink, fontSize: 15, lineHeight: 1.7,
    }}>
      {/* Entry title + type */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.2, color: HUD.mutedDark, textTransform: "uppercase", marginBottom: 4 }}>
          {open.documentType}
        </div>
        <h2 style={{ margin: 0, fontSize: isPhone ? 22 : 28, fontWeight: 700, color: T.heading ?? HUD.ink, lineHeight: 1.2 }}>
          {open.name}
        </h2>
        {open.aliases?.length > 0 && (
          <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 11, color: HUD.mutedDark }}>
            Also known as: {open.aliases.join(", ")}
          </div>
        )}
      </div>

      {/* Prose body */}
      {pmDoc && (
        <div style={{ maxWidth: 740 }}>
          {(pmDoc.content ?? []).map((block, i) => pmBlock(block, T, i))}
        </div>
      )}

      {/* Scalar metadata fields (non-prose) */}
      {metaFields.length > 0 && (
        <div style={{ marginTop: pmDoc ? 24 : 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", maxWidth: 560 }}>
          {metaFields.map(({ label, value }) => (
            <>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.5, color: HUD.mutedDark, textTransform: "uppercase", paddingTop: 1 }}>{label}</span>
              <span style={{ fontSize: 13, color: T.ink ?? HUD.ink, overflowWrap: "anywhere" }}>{value}</span>
            </>
          ))}
        </div>
      )}

      {!hasContent && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: HUD.mutedDark, opacity: 0.7 }}>
          No content available for this entry.
        </div>
      )}
    </div>
  )
}

// SlowEmbedNotice — HostEmbed doesn't expose a load/error callback, so we
// have no way to know whether an embedded document is still loading, failed
// silently, or is a tool type that simply never resolves on a read-only
// published host (some tools' own components may expect a live collab
// socket that doesn't exist there — see docs/reference/wiki.md's published-
// host capability table: collab is Gone). Rather than guess at a fix inside
// a tool we don't own, this just gives the visitor a way out after a
// reasonable wait instead of a silent, unexplained hang.
function SlowEmbedNotice({ docId }: { docId: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [docId])
  if (!slow) return null
  return (
    <div style={{
      position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 5,
      padding: "10px 16px", borderRadius: 4, border: "1px solid " + HUD.blueDim, background: "rgba(10,14,23,0.85)",
      backdropFilter: "blur(8px)", color: HUD.inkFaint, fontFamily: MONO, fontSize: 11, letterSpacing: 0.4,
      maxWidth: 420, textAlign: "center", lineHeight: 1.5, pointerEvents: "none",
    }}>
      Still loading — some entry types can take a moment on the published site, or may not preview here yet. Use "← Back to index" if it doesn't finish.
    </div>
  )
}

// EmbedDiagnostic — wraps a HostEmbed and reports, via console.error, whether
// it actually rendered any DOM content, at what measured size, and what that
// content actually IS (a short preview), at three checkpoints. We have no
// load/error callback from HostEmbed itself and no way to inspect its
// internals otherwise. Also listens for any window error / unhandled promise
// rejection while mounted, in case HostEmbed's internal loading fails
// silently (no visible red console error) rather than throwing where we'd
// normally see it.
function EmbedDiagnostic({ docId, documentType, children }: { docId: string; documentType: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const report = (label: string) => {
      const el = ref.current
      if (!el) { console.error("[embed-diag]", label, "— wrapper ref is null"); return }
      const rect = el.getBoundingClientRect()
      const child = el.firstElementChild as HTMLElement | null
      const html = el.innerHTML
      console.error(
        "[embed-diag]", label, "— docId:", docId, "documentType:", documentType,
        "| wrapper size:", rect.width + "x" + rect.height,
        "| wrapper childElementCount:", el.childElementCount,
        "| wrapper innerHTML length:", html.length,
        "| direct child tag:", child ? child.tagName : "(none)",
        "| direct child size:", child ? child.getBoundingClientRect().width + "x" + child.getBoundingClientRect().height : "n/a",
        "| innerHTML preview:", html.length > 0 ? html.slice(0, 400) : "(empty)",
      )
    }
    const onError = (e: ErrorEvent) => {
      console.error("[embed-diag] window error while", docId, "(" + documentType + ") was mounted:", e.message, e.error)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[embed-diag] unhandled promise rejection while", docId, "(" + documentType + ") was mounted:", e.reason)
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    const t1 = setTimeout(() => report("+1.5s"), 1500)
    const t2 = setTimeout(() => report("+6s"), 6000)
    const t3 = setTimeout(() => report("+14s"), 14000)
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [docId, documentType])
  // FIX: was "w-full min-h-full" / minHeight:"100%" — a percentage MIN-height
  // does not establish a definite height for CSS percentage-height resolution
  // in descendants (only an explicit `height` does, per CSS2.1 10.5). That
  // silently zeroed out HostEmbed's own `h-full` cascade for canvas/graph
  // tools (timeline), even though this box's own rendered size looked fine.
  // Must be `height`, matching the pattern already used for the real fix
  // elsewhere in this file (search for "h-full (a real, definite height)").
  return <div ref={ref} className="w-full h-full" style={{ width: "100%", height: "100%" }}>{children}</div>
}

// WikiTheme — just the colour tokens WikiPage uses internally, so we can
// pass the computed theme into FrozenCardBody without threading the full preset.
type WikiTheme = { ink?: string; heading?: string; card?: string; link?: string; bg?: string }

function WikiPage({ editing, values, page, actions, entryPath, frozenDocs, frozenDocContent }: {
  editing: boolean
  values: AppCustomizationValues
  page: PageState
  actions: PageActions | null
  entryPath: string | null
  frozenDocs?: WikiDocRow[] | null
  /** snapshot.documents keyed by doc id — used on the published site to render
   *  card bodies without needing a live HostEmbed / collab socket. */
  frozenDocContent?: Record<string, Record<string, unknown>> | null
}) {
  const meta = useWorldMeta()
  // On a published page there is no live socket back to the world's catalog
  // — useWorldQuery is a LIVE read and quietly resolves to [] there (see
  // frozenIndex's comment above). `frozenDocs`, when supplied by
  // ScifiThemeBaked, is the baked catalog and takes priority; the live hook
  // is still called unconditionally to keep hook order stable and is what
  // actually drives the editor view.
  const liveDocs = useWorldQuery("documents")
  const docs = frozenDocs ?? liveDocs
  const media = useHostCapability("media")
  const scope = useHostCapability("scope")
  const hostTheme = useHostTheme()
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [classicView, setClassicView] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  const themeId = resolveCustomizationChoice(THEME_PARAM, values)
  const preset = THEME_PARAM.presets.find((p) => p.id === themeId) || THEME_PARAM.presets[0]
  const T = themeId === WORLD_THEME_ID ? worldTheme(hostTheme) : themeFromPreset(preset)
  const BODY_FF = chosenFont(WIKI_BODY_FONT_PARAM, resolveCustomizationChoice(WIKI_BODY_FONT_PARAM, values)) || font(T)
  const HEAD_FF = chosenFont(WIKI_HEADING_FONT_PARAM, resolveCustomizationChoice(WIKI_HEADING_FONT_PARAM, values)) || "inherit"

  const title = page.title.trim() || (meta ? meta.name : NAME)
  const subtitle = page.subtitle.trim() || (meta && meta.description) || ""
  const order = page.sectionOrder.length > 0 ? page.sectionOrder : DEFAULT_SECTIONS
  const featuredIds = page.featuredIds

  // page.bannerMediaId is only ever populated on the LIVE editor right now —
  // the published site's extra.page keeps coming back null (see
  // ScifiThemeBaked's diagnostic: appState() doesn't look like real wiki
  // page state on this platform version), so there is currently no way to
  // bake the owner's actual banner choice. As a stopgap, fall back to the
  // world's own avatar image — world() metadata DOES bake successfully
  // (title/subtitle already fall back to it above), so this at least shows
  // something on the published site instead of nothing. meta.avatarMediaId
  // isn't a field this app has previously confirmed exists on useWorldMeta's
  // return shape, so this is read defensively and is a no-op if it's absent.
  const worldAvatarId = typeof (meta as unknown as { avatarMediaId?: unknown })?.avatarMediaId === "string"
    ? (meta as unknown as { avatarMediaId: string }).avatarMediaId
    : ""
  const bannerId = page.bannerMediaId || worldAvatarId
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!bannerId) { setBannerUrl(null); return }
    let on = true
    setBannerUrl(media.placeholder(bannerId))
    media.resolve(bannerId).then((url) => {
      if (!on) return
      if (url) setBannerUrl(url)
      if (editing) {
        const valid = !!url && (/^https?:\/\//.test(url) || /^data:/.test(url))
        console.log("[wiki] banner media audit — id:", JSON.stringify(bannerId), "resolved:", url ? JSON.stringify(url) : "(resolve returned nothing)", "| publishable:", valid)
      }
    }).catch((err) => {
      if (editing) console.log("[wiki] banner media audit — id:", JSON.stringify(bannerId), "resolve FAILED:", err)
    })
    return () => { on = false }
  }, [bannerId, media, editing])
  const pickBanner = async () => {
    if (!media.pick || !actions) return
    const picked = await media.pick({ worldId: scope.worldId, accept: ["image/*"] })
    if (picked) actions.setBanner(picked.id)
  }

  const bannerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [repositioning, setRepositioning] = useState(false)
  const [liveFocusY, setLiveFocusY] = useState<number | null>(null)
  const focusYFromClientY = (clientY: number) => {
    const el = bannerRef.current
    if (!el) return page.bannerFocusY
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return page.bannerFocusY
    return Math.max(0, Math.min(100, Math.round(((clientY - rect.top) / rect.height) * 100)))
  }
  const onBannerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!repositioning) return
    e.preventDefault()
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setLiveFocusY(focusYFromClientY(e.clientY))
  }
  const onBannerPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!repositioning || !draggingRef.current) return
    setLiveFocusY(focusYFromClientY(e.clientY))
  }
  const onBannerPointerUp = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (liveFocusY != null) actions?.setBannerFocus(liveFocusY)
  }
  const toggleRepositioning = () => {
    setRepositioning((on) => !on)
    setLiveFocusY(null)
    draggingRef.current = false
  }
  const focusY = liveFocusY ?? page.bannerFocusY

  const vw = useViewportWidth()
  const isPhone = vw < 640
  const isTablet = vw >= 640 && vw < 1024
  const isDesktop = !isPhone && !isTablet
  const entriesStep = isPhone ? 24 : 60
  const [entriesShown, setEntriesShown] = useState(entriesStep)
  const scrollToSection = (key: string) => {
    document.getElementById("wiki-section-" + key)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  useEffect(() => {
    if (!entryPath) return
    // The platform always resolves entryPath to a real document id before
    // renderBaked runs (slug/name-slug/raw-id forms all 404 upstream if they
    // don't match) — open it directly rather than re-deriving it from
    // `docs`, which may not have loaded yet.
    setOpenId(entryPath)
    setClassicView(true)
  }, [entryPath])

  const moveSection = (key: string, dir: number) => actions?.moveSection(key, dir)
  const toggleFeatured = (id: string) => actions?.toggleFeatured(id)

  const cards = useMemo(() => docs.filter((d) => d.documentType === "card" && d.isViewable !== false), [docs])
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const cardCategories = useMemo(() => {
    const set = new Set<string>()
    cards.forEach((d) => set.add(docKindLabel(d)))
    return Array.from(set).sort()
  }, [cards])
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = cards
    if (categoryFilter) list = list.filter((d) => docKindLabel(d) === categoryFilter)
    if (!q) return list
    return list.filter((d) => (d.name || "").toLowerCase().includes(q) || (d.aliases || []).some((a) => a.toLowerCase().includes(q)))
  }, [cards, query, categoryFilter])
  const [listSort, setListSort] = useState<"recent" | "alpha">("recent")
  const listEntries = useMemo(() => {
    if (viewMode !== "list") return entries
    const arr = [...entries]
    if (listSort === "alpha") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    } else {
      arr.sort((a, b) => {
        const ta = docTimestamp(a, DOC_UPDATED_KEYS) ?? docTimestamp(a, DOC_CREATED_KEYS) ?? 0
        const tb = docTimestamp(b, DOC_UPDATED_KEYS) ?? docTimestamp(b, DOC_CREATED_KEYS) ?? 0
        return tb - ta
      })
    }
    return arr
  }, [entries, viewMode, listSort])
  const featured = useMemo(
    () => featuredIds.map((id) => cards.find((d) => d.id === id)).filter((d): d is (typeof cards)[number] => d != null),
    [featuredIds, cards],
  )
  const extras = useMemo(() => docs.filter((d) => d.documentType !== "card" && d.documentType !== "folder" && d.documentType !== "timeline"), [docs])
  const timelineDoc = useMemo(() => docs.find((d) => d.documentType === "timeline") || null, [docs])
  const open = openId ? docs.find((d) => d.id === openId) : null

  const chip = { padding: isPhone ? "7px 12px" : "6px 13px", borderRadius: 3, border: "1px solid " + HUD.blueDim, background: "rgba(10,14,23,0.55)", color: HUD.inkFaint, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase" as const, whiteSpace: "nowrap" as const } as const
  const editChip = { ...chip, borderStyle: "dashed" as const, opacity: 0.9 } as const
  const navChip = { ...chip, border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } as const

  const extraGroups = useMemo(() => {
    const map = new Map<string, typeof extras>()
    extras.forEach((d) => {
      const key = d.documentType || "other"
      const arr = map.get(key)
      if (arr) arr.push(d)
      else map.set(key, [d])
    })
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [extras])
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const tickerSegments = useMemo(() => {
    const segs = [
      cards.length + " " + (cards.length === 1 ? "ENTRY" : "ENTRIES") + " ARCHIVED",
      extras.length + " LORE " + (extras.length === 1 ? "ITEM" : "ITEMS") + " LINKED",
      extraGroups.length + " " + (extraGroups.length === 1 ? "CATEGORY" : "CATEGORIES") + " TRACKED",
    ]
    cards.forEach((d) => {
      const b = recentBadge(d)
      if (b) segs.push(b.toUpperCase() + ": " + (d.name || "Untitled").toString().toUpperCase())
    })
    segs.push("SYNC NOMINAL")
    return segs
  }, [cards, extras, extraGroups])

  const entryCard = (d: (typeof cards)[number], big: boolean) => {
    const isFeatured = featuredIds.includes(d.id)
    const badge = recentBadge(d)
    const dc = colorForDocType(docKindLabel(d))
    const heroH = big ? 150 : 104
    return (
      <div key={d.id} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => { SFX.open(); setOpenId(d.id) }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = dc.dim
            e.currentTarget.style.transform = "translateY(-2px)"
            e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,0.35), 0 0 0 1px " + dc.dim + ", 0 0 20px " + dc.bg
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = HUD.blueFaint
            e.currentTarget.style.transform = "translateY(0)"
            e.currentTarget.style.boxShadow = "none"
          }}
          style={{
            width: "100%", textAlign: "left", display: "flex", flexDirection: "column",
            padding: 0, borderRadius: 6, border: "1px solid " + HUD.blueFaint,
            background: "linear-gradient(155deg, rgba(22,28,44,0.92), rgba(9,12,20,0.96))",
            color: HUD.inkDim, cursor: "pointer", font: "inherit", position: "relative", overflow: "hidden",
            transition: "border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
          }}
        >
          <div className="entry-thumb-hero" style={{ position: "relative", height: heroH, flexShrink: 0 }}>
            <EntryHero mediaId={d.avatarMediaId} docType={docKindLabel(d)} glyph={d.name ? d.name.slice(0, 1).toUpperCase() : "?"} style={{ position: "absolute", inset: 0 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,8,16,0) 35%, rgba(6,8,16,0.55) 72%, rgba(6,8,16,0.92) 100%)" }} />
            <div className="reticle">
              <span className="reticle-scan" />
            </div>
            <span className="reticle-corner tl" />
            <span className="reticle-corner tr" />
            <span className="reticle-corner bl" />
            <span className="reticle-corner br" />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: big ? "0 16px 12px" : "0 12px 9px" }}>
              <span style={{ display: "block", fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: dc.text, opacity: 0.85, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
                {docKindLabel(d)}
              </span>
              <span style={{ display: "block", fontWeight: 600, fontSize: big ? 17 : 13.5, lineHeight: 1.25, color: HUD.ink, fontFamily: BODY_FF, textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}>
                {d.name || "Untitled"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: big ? "8px 14px 10px" : "6px 11px 8px" }}>
            <span style={{ fontFamily: MONO, fontSize: big ? 10 : 9, letterSpacing: 0.8, color: dc.text, textTransform: "uppercase", opacity: 0.9 }}>
              Open file →
            </span>
          </div>
          <span style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2, opacity: 0.7, zIndex: 1,
            background: "linear-gradient(90deg, " + dc.line + ", transparent 75%)",
          }} />
          <span style={tickStyle("tl", dc.dim)} />
          <span style={tickStyle("br", dc.dim)} />
        </button>
        {badge && (
          <span style={{
            position: "absolute", top: 8, left: 8, padding: "2px 7px", borderRadius: 2, zIndex: 2,
            fontFamily: MONO, fontSize: 8, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700,
            color: badge === "new" ? "#241304" : "#071322",
            background: badge === "new" ? HUD.amber : "#8fb3ea",
            boxShadow: "0 0 10px " + (badge === "new" ? "rgba(255,158,84,0.55)" : "rgba(140,170,220,0.5)"),
          }}>
            {badge === "new" ? "New" : "Updated"}
          </span>
        )}
        {editing && (
          <button type="button" onClick={() => toggleFeatured(d.id)}
            title={isFeatured ? "Remove from Featured" : "Add to Featured"}
            style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 3, border: "1px solid " + (isFeatured ? HUD.amberDim : HUD.blueFaint), background: "rgba(6,8,16,0.85)", color: isFeatured ? HUD.amber : HUD.inkFaint, cursor: "pointer", opacity: isFeatured ? 1 : 0.6 }}>
            <HostIcon icon="star" size={12} />
          </button>
        )}
      </div>
    )
  }

  const entryRow = (d: (typeof cards)[number]) => {
    const isFeatured = featuredIds.includes(d.id)
    const badge = recentBadge(d)
    const dc = colorForDocType(docKindLabel(d))
    return (
      <div key={d.id} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => { SFX.open(); setOpenId(d.id) }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = dc.dim; e.currentTarget.style.background = dc.bg }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = HUD.blueFaint; e.currentTarget.style.background = "rgba(14,18,28,0.6)" }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer", font: "inherit",
            padding: "10px 14px 10px 12px", borderRadius: 5, border: "1px solid " + HUD.blueFaint, borderLeft: "3px solid " + dc.line,
            background: "rgba(14,18,28,0.6)", color: HUD.inkDim, transition: "border-color 140ms ease, background 140ms ease",
          }}
        >
          <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", border: "1px solid " + dc.dim, background: dc.bg, color: dc.text, fontFamily: MONO, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
            {d.name ? d.name.slice(0, 1).toUpperCase() : "?"}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: HUD.ink, fontFamily: BODY_FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.name || "Untitled"}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: dc.text, opacity: 0.75, textTransform: "uppercase", flexShrink: 0 }}>
              {docKindLabel(d)}
            </span>
            {badge && (
              <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, padding: "1px 6px", borderRadius: 2, flexShrink: 0, color: badge === "new" ? "#241304" : "#071322", background: badge === "new" ? HUD.amber : "#8fb3ea" }}>
                {badge === "new" ? "New" : "Updated"}
              </span>
            )}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: HUD.mutedDark, flexShrink: 0 }}>›</span>
        </button>
        {editing && (
          <button type="button" onClick={() => toggleFeatured(d.id)}
            title={isFeatured ? "Remove from Featured" : "Add to Featured"}
            style={{ position: "absolute", top: "50%", right: 34, transform: "translateY(-50%)", zIndex: 2, display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 3, border: "1px solid " + (isFeatured ? HUD.amberDim : HUD.blueFaint), background: "rgba(6,8,16,0.85)", color: isFeatured ? HUD.amber : HUD.inkFaint, cursor: "pointer", opacity: isFeatured ? 1 : 0.6 }}>
            <HostIcon icon="star" size={11} />
          </button>
        )}
      </div>
    )
  }

  const sectionHead = (key: string) => (
    <div id={"wiki-section-" + key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "0 0 12px", paddingBottom: 8, borderBottom: "1px solid " + HUD.blueFaint, scrollMarginTop: 20 }}>
      <h3 style={{ margin: 0, fontFamily: MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.6, color: HUD.warmLabel, fontWeight: 700 }}>
        {SECTION_NAMES[key] || key}
      </h3>
      {editing && (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <button type="button" onClick={() => moveSection(key, -1)} title="Move section up" style={{ ...chip, padding: "2px 8px" }}>↑</button>
          <button type="button" onClick={() => moveSection(key, 1)} title="Move section down" style={{ ...chip, padding: "2px 8px" }}>↓</button>
        </span>
      )}
    </div>
  )

  const sections: Record<string, ReactNode> = {
    featured: featured.length > 0 || editing ? (
      <section key="featured" style={{ marginBottom: 34 }}>
        {sectionHead("featured")}
        {featured.length > 0 ? (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, scrollSnapType: "x proximity" }}>
            {featured.map((d) => (
              <div key={d.id} style={{ flex: "0 0 auto", width: isPhone ? 210 : 250, scrollSnapAlign: "start" }}>
                {entryCard(d, true)}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 11, letterSpacing: 0.4, color: HUD.muted }}>Star entries below to feature them here.</p>
        )}
      </section>
    ) : null,
    entries: (
      <section key="entries" style={{ marginBottom: 34 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "0 0 12px", paddingBottom: 8, borderBottom: "1px solid " + HUD.blueFaint, scrollMarginTop: 20 }} id="wiki-section-entries">
          <h3 style={{ margin: 0, fontFamily: MONO, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.6, color: HUD.warm, fontWeight: 700 }}>
            [ {SECTION_NAMES.entries || "entries"} ]
          </h3>
          <span style={{ display: "inline-flex", gap: 4 }}>
            {editing && (
              <>
                <button type="button" onClick={() => moveSection("entries", -1)} title="Move section up" style={{ ...chip, padding: "2px 8px" }}>↑</button>
                <button type="button" onClick={() => moveSection("entries", 1)} title="Move section down" style={{ ...chip, padding: "2px 8px" }}>↓</button>
              </>
            )}
            <button type="button" onClick={() => setViewMode("grid")} title="Grid view" style={{ ...chip, padding: "4px 9px", ...(viewMode === "grid" ? { border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } : {}) }}>▦</button>
            <button type="button" onClick={() => setViewMode("list")} title="List view" style={{ ...chip, padding: "4px 9px", ...(viewMode === "list" ? { border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } : {}) }}>☰</button>
          </span>
        </div>
        {cardCategories.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            <button type="button" onClick={() => { setCategoryFilter(null); setEntriesShown(entriesStep) }}
              style={{ ...chip, ...(categoryFilter === null ? { border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } : {}) }}>
              All
            </button>
            {cardCategories.map((c) => {
              const tc = colorForDocType(c)
              const active = categoryFilter === c
              return (
                <button key={c} type="button" onClick={() => { setCategoryFilter(active ? null : c); setEntriesShown(entriesStep) }}
                  style={{ ...chip, border: "1px solid " + (active ? tc.line : HUD.blueDim), color: active ? tc.text : HUD.inkFaint, background: active ? tc.bg : "rgba(10,14,23,0.55)" }}>
                  {c}
                </button>
              )
            })}
          </div>
        )}
        {viewMode === "grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(" + (isPhone ? 150 : isTablet ? 175 : 190) + "px, 1fr))", gap: isPhone ? 10 : 12 }}>
            {entries.slice(0, entriesShown).map((d) => entryCard(d, false))}
            {entries.length === 0 && (
              <p style={{ gridColumn: "1 / -1", fontFamily: MONO, fontSize: 11, letterSpacing: 0.4, color: HUD.muted }}>
                {query ? "No entries match “" + query + "”." : "No entries yet — cards you create in the editor appear here, live."}
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <button type="button" onClick={() => setListSort("recent")} style={{ ...chip, ...(listSort === "recent" ? { border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } : {}) }}>
                Recently updated
              </button>
              <button type="button" onClick={() => setListSort("alpha")} style={{ ...chip, ...(listSort === "alpha" ? { border: "1px solid " + HUD.amberDim, color: HUD.warm, background: HUD.amberBg } : {}) }}>
                A–Z
              </button>
            </div>
            {listEntries.slice(0, entriesShown).map((d) => entryRow(d))}
            {entries.length === 0 && (
              <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.4, color: HUD.muted }}>
                {query ? "No entries match “" + query + "”." : "No entries yet — cards you create in the editor appear here, live."}
              </p>
            )}
          </div>
        )}
        {entries.length > entriesShown && (
          <button type="button" onClick={() => setEntriesShown((n) => n + entriesStep)} style={{ ...chip, marginTop: 14 }}>
            Show {Math.min(entriesStep, entries.length - entriesShown)} more ({entries.length - entriesShown} left)
          </button>
        )}
      </section>
    ),
    extras: extras.length > 0 ? (
      <section key="extras" style={{ marginBottom: 30, borderTop: "1px solid " + HUD.blueFaint, paddingTop: 18 }}>
        {sectionHead("extras")}
        {extraGroups.map(([type, list]) => {
          const collapsed = collapsedGroups[type] === true
          const tc = colorForDocType(type)
          const icon = iconForDocType(type)
          return (
            <div key={type} style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setCollapsedGroups((m) => ({ ...m, [type]: !collapsed }))}
                style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none", padding: 0, marginBottom: 8, cursor: "pointer" }}
              >
                <span style={{ fontFamily: MONO, fontSize: 9, color: HUD.mutedDark }}>{collapsed ? "▸" : "▾"}</span>
                <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: HUD.label, textTransform: "uppercase" }}>
                  {type} · {list.length}
                </span>
              </button>
              {!collapsed && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 16 }}>
                  {list.map((d) => (
                    <button key={d.id} type="button" onClick={() => { SFX.open(); setOpenId(d.id) }} style={chip}>
                      {d.name || "Untitled"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>
    ) : null,
  }

  const showMap = !isPhone && !open && !classicView
  const bannerHeight = bannerUrl ? (isPhone ? 130 : isTablet ? 170 : 220) : (isPhone ? 56 : 72)

  return (
    <div style={{ position: "absolute", inset: 0, minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: BODY_FF, overflow: "hidden" }}>
      <style>{THUMB_RETICLE_CSS}</style>
      {!showMap && !open && (
        <>
          <style>{HUD_KEYFRAMES}</style>
          <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none", backgroundImage: STARFIELD_BG, backgroundSize: STARFIELD_SIZE, animation: "hudTwinkle 5s ease-in-out infinite" }} />
          <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.3, pointerEvents: "none", backgroundImage: STARFIELD_BG, backgroundSize: STARFIELD_SIZE, backgroundPosition: "90px 60px", animation: "hudTwinkle 7s ease-in-out infinite 1.4s" }} />
          <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(1100px 650px at 12% -10%, rgba(255,158,84,0.07), transparent 60%), radial-gradient(950px 650px at 105% 0%, rgba(90,140,210,0.09), transparent 55%)" }} />
        </>
      )}

      {showMap && (
        <SolarSystemHome
          T={T}
          title={title}
          bodies={page.solarBodies}
          editing={editing}
          docs={docs}
          onOpen={(id) => { setOpenId(id); setClassicView(true) }}
          onAddBody={(b) => actions?.addBody(b)}
          onRemoveBody={(i) => actions?.removeBody(i)}
          onUpdateBody={(i, patch) => actions?.updateBody(i, patch)}
          onSeed={() => actions?.seedSolarSystem()}
          onShowClassic={() => setClassicView(true)}
        />
      )}

      {!showMap && open && open.documentType !== "card" && (
        // Timeline/Map/etc. — a genuinely different kind of tool (canvas or
        // graph-based, not flowing text). Full viewport, no scroll wrapper
        // fighting its own internal pan/zoom: just a back button and 100% of
        // the screen. className uses h-full (a real, definite height from
        // this div's own position:absolute;inset:0), not min-h-full — see
        // the card branch below for why that distinction matters here.
        <div style={{ position: "absolute", inset: 0, background: T.bg }}>
          <div style={{ position: "absolute", top: 14, left: 14, zIndex: 5 }}>
            <button
              type="button"
              onClick={() => { SFX.back(); setOpenId(null) }}
              style={{
                padding: "6px 13px", borderRadius: 3, border: "1px solid " + HUD.blueDim, background: "rgba(10,14,23,0.72)",
                backdropFilter: "blur(8px)", color: HUD.inkFaint, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase",
              }}
            >
              ← Back to index
            </button>
          </div>
          <SlowEmbedNotice docId={open.id} />
          <EmbedDiagnostic docId={open.id} documentType={open.documentType}>
            <HostEmbed documentId={open.id} view="fullscreen" className="w-full h-full [&>*]:w-full [&>*]:h-full" />
          </EmbedDiagnostic>
        </div>
      )}

      {!showMap && open && open.documentType === "card" && (
        // Full-bleed article — hero-left/content-right split (stacked on
        // mobile), our own header, native document body embedded below it.
        (() => {
          const dc = colorForDocType(docKindLabel(open))
          return (
            <div style={{ position: "absolute", inset: 0, display: isDesktop ? "flex" : "block", overflowY: isDesktop ? "hidden" : "auto", background: T.bg }}>
              <style>{HUD_KEYFRAMES}</style>
              <div
                style={{
                  position: "relative", flexShrink: 0, overflow: "hidden",
                  width: isDesktop ? "42%" : "100%",
                  maxWidth: isDesktop ? 560 : undefined,
                  height: isDesktop ? "100%" : isTablet ? 340 : 240,
                  borderRight: isDesktop ? "1px solid " + HUD.blueFaint : undefined,
                  borderBottom: !isDesktop ? "1px solid " + HUD.blueFaint : undefined,
                }}
              >
                <EntryHero
                  variant="article"
                  mediaId={open.avatarMediaId}
                  docType={docKindLabel(open)}
                  glyph={open.name ? open.name.slice(0, 1).toUpperCase() : "?"}
                  style={{ position: "absolute", inset: 0 }}
                />
              </div>

              <div style={{ position: "relative", flex: 1, minWidth: 0, overflowY: isDesktop ? "auto" : "visible" }}>
                <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none", backgroundImage: STARFIELD_BG, backgroundSize: STARFIELD_SIZE, animation: "hudTwinkle 5s ease-in-out infinite" }} />
                <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(900px 500px at 100% -10%, rgba(255,158,84,0.06), transparent 55%)" }} />

                <div style={{ position: "relative", padding: isPhone ? "14px 18px 0" : "16px 34px 0" }}>
                  <button
                    type="button"
                    onClick={() => { SFX.back(); setOpenId(null) }}
                    style={{
                      padding: "6px 13px", borderRadius: 3, border: "1px solid " + HUD.blueDim, background: "rgba(10,14,23,0.55)",
                      color: HUD.inkFaint, cursor: "pointer", fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase",
                    }}
                  >
                    ← Back to index
                  </button>
                </div>

                {/* FIX (Bug 1 — published embed 0px height, card branch): This container
                    must use `height` (not `minHeight`) to give children a DEFINITE height
                    for CSS % resolution. CSS2.1 §10.5: a percentage height resolves only
                    against a definite parent height; `min-height` alone is not definite.
                    The same bug was fixed in EmbedDiagnostic itself (min-h-full → h-full);
                    this is the parent container that needed the same treatment. On published
                    pages HostEmbed rendered 0 children because its height:100% cascaded
                    through EmbedDiagnostic's height:100% to resolve against this div's
                    auto height (not its min-height). Since the content IS always a HostEmbed
                    (not flowing text that grows), a fixed px height is correct here. */}
                <div style={{ position: "relative", height: isPhone ? 480 : isTablet ? 560 : 640, margin: isPhone ? "18px 18px 40px" : "22px 34px 56px", borderRadius: 6, border: "1px solid " + HUD.blueFaint, background: "rgba(10,14,23,0.35)", overflow: "hidden" }}>
                  <span style={tickStyle("tl", dc.dim)} />
                  <span style={tickStyle("br", dc.dim)} />
                  {frozenDocContent?.[open.id]
                    ? (
                      // Published site: HostEmbed needs a live collab socket that
                      // doesn't exist here. Render the baked document content from
                      // snapshot.documents[id] directly instead.
                      <FrozenCardBody
                        docContent={frozenDocContent[open.id]}
                        open={open}
                        T={T}
                        isPhone={isPhone}
                        BODY_FF={BODY_FF}
                      />
                    ) : (
                      // Live editor: use HostEmbed as normal.
                      <>
                        <SlowEmbedNotice docId={open.id} />
                        <EmbedDiagnostic docId={open.id} documentType={open.documentType}>
                          <HostEmbed documentId={open.id} view="fullscreen" className="w-full h-full [&>*]:w-full [&>*]:h-full" />
                        </EmbedDiagnostic>
                      </>
                    )
                  }
                </div>
              </div>
            </div>
          )
        })()
      )}

      {!showMap && !open && (
        <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 4, borderBottom: "1px solid " + HUD.blueFaint, background: "rgba(6,8,16,0.72)", backdropFilter: "blur(6px)", padding: isPhone ? "6px 12px" : "6px 20px", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: HUD.warmLabel, textTransform: "uppercase" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: HUD.amber, boxShadow: "0 0 6px " + HUD.amberDim, animation: "hudPulseDot 2.2s ease-in-out infinite", display: "inline-block" }} />
              {!isPhone && "SYS "}NOMINAL
            </span>
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative", height: 16 }}>
              <div style={{ position: "absolute", whiteSpace: "nowrap", display: "flex", gap: 28, animation: "hudMarquee 26s linear infinite", fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.8, color: HUD.mutedDark, textTransform: "uppercase" }}>
                {[...tickerSegments, ...tickerSegments].map((seg, i) => (
                  <span key={i}>◈ {seg}</span>
                ))}
              </div>
            </div>
            {!isPhone && (
              <LiveClock style={{ flexShrink: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: HUD.mutedDark }} />
            )}
          </div>
          {(bannerUrl || editing) && (
            <div
              ref={bannerRef}
              onPointerDown={onBannerPointerDown}
              onPointerMove={onBannerPointerMove}
              onPointerUp={onBannerPointerUp}
              onPointerCancel={onBannerPointerUp}
              style={{
                position: "relative", height: bannerHeight, overflow: "hidden",
                background: bannerUrl ? HUD.panelSolid : T.card,
                borderBottom: "1px solid " + HUD.blueFaint,
                touchAction: repositioning ? "none" : undefined,
                cursor: repositioning ? "ns-resize" : undefined,
              }}
            >
              {bannerUrl && (
                <div
                  style={{
                    position: "absolute", inset: 0,
                    backgroundImage: "url(" + JSON.stringify(bannerUrl) + ")",
                    backgroundSize: "cover", backgroundRepeat: "no-repeat",
                    backgroundPosition: "center " + focusY + "%",
                    pointerEvents: "none",
                  }}
                />
              )}
              {bannerUrl && (
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,8,16,0.35) 0%, rgba(6,8,16,0) 30%, rgba(6,8,16,0.55) 100%)", pointerEvents: "none" }} />
              )}
              {repositioning && (
                <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: HUD.amberDim, pointerEvents: "none" }} />
              )}
              {editing && (
                <span
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ position: "absolute", right: 14, bottom: 12, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {repositioning && (
                    <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.8, color: HUD.warm, background: "rgba(6,8,16,0.75)", border: "1px solid " + HUD.amberDim, borderRadius: 3, padding: "5px 9px" }}>
                      DRAG TO REPOSITION · {focusY}%
                    </span>
                  )}
                  {bannerUrl && (
                    <button type="button" onClick={toggleRepositioning} style={repositioning ? navChip : editChip}>
                      {repositioning ? "Done" : "Reposition"}
                    </button>
                  )}
                  {!repositioning && (
                    <button type="button" onClick={pickBanner} style={editChip}>
                      {bannerUrl ? "Swap image" : "Set a banner image"}
                    </button>
                  )}
                  {bannerUrl && !repositioning && (
                    <button type="button" onClick={() => actions?.setBanner("")} style={editChip}>
                      Remove
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
          <div style={{ position: "relative", maxWidth: isPhone ? "100%" : isDesktop ? 1320 : 900, margin: "0 auto", padding: isPhone ? "24px 16px 56px" : "40px 24px 72px", display: isDesktop ? "flex" : "block", gap: isDesktop ? 40 : 0, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, maxWidth: isDesktop ? 860 : undefined }}>
            <header style={{ marginBottom: 28 }}>
              <div style={{
                position: "relative", padding: isPhone ? "22px 18px" : "32px 34px", borderRadius: 8, overflow: "hidden",
                border: "1px solid " + HUD.amberDim,
                background: "linear-gradient(155deg, rgba(30,22,16,0.55), rgba(9,12,20,0.85))",
                boxShadow: "0 0 40px rgba(255,158,84,0.06), inset 0 0 60px rgba(255,158,84,0.04)",
              }}>
                <span style={tickStyle("tl", HUD.amberDim)} />
                <span style={tickStyle("br", HUD.amberDim)} />
                <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none", backgroundImage: "linear-gradient(" + HUD.blueFaint + " 1px, transparent 1px), linear-gradient(90deg, " + HUD.blueFaint + " 1px, transparent 1px)", backgroundSize: "26px 26px", maskImage: "radial-gradient(ellipse at 30% 0%, black, transparent 75%)" }} />

                <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  {editing ? (
                    <input value={page.title} onChange={(e) => actions?.setText("title", e.target.value)}
                      placeholder={meta ? meta.name : NAME} aria-label="Wiki title"
                      style={{ margin: 0, fontSize: isPhone ? 30 : 46, letterSpacing: 0.5, fontWeight: 700, fontFamily: HEAD_FF, color: HUD.warm, textShadow: "0 0 24px rgba(255,158,84,0.35)", background: "transparent", border: "none", borderBottom: "1px dashed " + T.line, outline: "none", minWidth: 200, flex: 1 }} />
                  ) : (
                    <h1 style={{ margin: 0, fontSize: isPhone ? 30 : 46, letterSpacing: 0.5, fontWeight: 700, fontFamily: HEAD_FF, color: HUD.warm, textShadow: "0 0 24px rgba(255,158,84,0.35)", textTransform: "uppercase" }}>{title}</h1>
                  )}
                  {isPhone ? (
                    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.6, color: HUD.mutedDark, textTransform: "uppercase", padding: "6px 0" }}>
                      🖥️ Interactive star map: desktop only
                    </span>
                  ) : (
                    <button type="button" onClick={() => setClassicView(false)} style={navChip}>🪐 Back to Star Map</button>
                  )}
                </div>
                {editing ? (
                  <input value={page.subtitle} onChange={(e) => actions?.setText("subtitle", e.target.value)}
                    placeholder={(meta && meta.description) || "A line about this place…"} aria-label="Wiki subtitle"
                    style={{ position: "relative", margin: "10px 0 0", width: "100%", maxWidth: 560, opacity: 0.85, fontFamily: "inherit", fontSize: "inherit", color: T.ink, background: "transparent", border: "none", borderBottom: "1px dashed " + T.line, outline: "none" }} />
                ) : subtitle ? (
                  <p style={{ position: "relative", margin: "10px 0 0", opacity: 0.75, maxWidth: 560, color: T.ink, fontFamily: BODY_FF }}>{subtitle}</p>
                ) : null}

                <div style={{ position: "relative", display: "flex", gap: isPhone ? 22 : 34, marginTop: 24, flexWrap: "wrap" }}>
                  {[
                    { n: cards.length, label: cards.length === 1 ? "entry" : "entries" },
                    { n: cardCategories.length, label: cardCategories.length === 1 ? "category" : "categories" },
                    { n: extras.length, label: extras.length === 1 ? "lore item" : "lore items" },
                  ].map((s) => (
                    <div key={s.label}>
                      <div style={{ fontFamily: HEAD_FF, fontWeight: 700, fontSize: isPhone ? 22 : 28, color: HUD.amber, lineHeight: 1 }}>{s.n}</div>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: HUD.mutedDark, textTransform: "uppercase", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap", alignItems: "stretch" }}>
                  <div style={{ position: "relative", flex: "1 1 260px", maxWidth: isPhone ? "100%" : 380 }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontFamily: MONO, fontSize: 12, color: HUD.mutedDark, pointerEvents: "none" }}>⌕</span>
                    <input
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setEntriesShown(entriesStep) }}
                      placeholder={"Search " + title + "…"}
                      style={{ width: "100%", height: "100%", padding: "9px 12px 9px 30px", borderRadius: 3, border: "1px solid " + HUD.blueDim, background: "rgba(10,14,23,0.55)", color: HUD.inkDim, fontFamily: MONO, fontSize: 12.5, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  {timelineDoc && (
                    <button
                      type="button"
                      onClick={() => { SFX.open(); setOpenId(timelineDoc.id) }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = HUD.amber; e.currentTarget.style.boxShadow = "0 0 22px rgba(255,158,84,0.28), inset 0 0 20px rgba(255,158,84,0.06)" }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = HUD.amberDim; e.currentTarget.style.boxShadow = "0 0 0 rgba(0,0,0,0)" }}
                      style={{
                        flex: "1 1 200px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                        padding: "12px 22px", borderRadius: 4, border: "1px solid " + HUD.amberDim,
                        background: "linear-gradient(155deg, rgba(255,158,84,0.1), rgba(10,14,23,0.6))",
                        color: HUD.warm, cursor: "pointer", fontFamily: HEAD_FF, fontWeight: 700,
                        fontSize: isPhone ? 16 : 19, letterSpacing: 0.3, transition: "border-color 160ms ease, box-shadow 160ms ease",
                      }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: isPhone ? 14 : 16 }}>⏱</span>
                      Check Timeline
                    </button>
                  )}
                </div>
              </div>

              {!isDesktop && (
                <nav style={{ display: "flex", flexWrap: isPhone ? "nowrap" : "wrap", overflowX: isPhone ? "auto" : undefined, gap: 6, marginTop: 16, paddingBottom: isPhone ? 2 : 0 }}>
                  {order.filter((key) => sections[key] != null).map((key) => (
                    <button key={key} type="button" onClick={() => scrollToSection(key)} style={chip}>
                      {SECTION_NAMES[key] || key}
                    </button>
                  ))}
                </nav>
              )}
            </header>

            {order.map((key) => sections[key] ?? null)}
          </div>

          {isDesktop && (
            <aside style={{ width: 260, flexShrink: 0, position: "sticky", top: 24 }}>
              <div style={{ border: "1px solid " + HUD.blueFaint, borderTop: "2px solid " + HUD.amberDim, borderRadius: 6, background: "linear-gradient(155deg, rgba(22,28,44,0.9), rgba(9,12,20,0.94))", padding: 18 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, color: HUD.warmLabel, textTransform: "uppercase", marginBottom: 12, fontWeight: 700 }}>
                  Contents
                </div>
                <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {order.filter((key) => sections[key] != null).map((key) => (
                    <button key={key} type="button" onClick={() => scrollToSection(key)}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", padding: "6px 4px", cursor: "pointer", textAlign: "left", borderRadius: 3, color: HUD.inkFaint, fontFamily: BODY_FF, fontSize: 13.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,158,84,0.08)"; e.currentTarget.style.color = HUD.ink }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = HUD.inkFaint }}
                    >
                      <span style={{ color: HUD.mutedDark, fontFamily: MONO, fontSize: 11 }}>›</span>
                      {SECTION_NAMES[key] || key}
                    </button>
                  ))}
                </nav>
                <div style={{ borderTop: "1px solid " + HUD.blueFaint, marginTop: 12, paddingTop: 12, fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.6, color: HUD.mutedDark, textTransform: "uppercase" }}>
                  {cards.length} {cards.length === 1 ? "entry" : "entries"} · {extras.length} lore {extras.length === 1 ? "item" : "items"}
                </div>
              </div>
            </aside>
          )}
          </div>
        </div>
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
    bannerFocusY: field.value<number>(50),
    sectionOrder: field.list<string>(),
    featuredIds: field.list<string>(),
    solarBodies: field.list<SolarBody>(),
  })
  const page = useMemo<PageState>(
    () => ({
      title: data?.title ?? "",
      subtitle: data?.subtitle ?? "",
      bannerMediaId: data?.bannerMediaId ?? "",
      bannerFocusY: typeof data?.bannerFocusY === "number" ? data.bannerFocusY : 50,
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
        setBannerFocus: (focusY) => actions.set("bannerFocusY", Math.max(0, Math.min(100, Math.round(focusY)))),
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
        addBody: (body) => {
          const id = uid()
          actions.list("solarBodies").push({ ...body, id })
          return id
        },
        removeBody: (index) => actions.list("solarBodies").remove(index),
        updateBody: (index, patch) => {
          const current = page.solarBodies[index]
          if (!current) return
          actions.list("solarBodies").replace(index, { ...current, ...patch })
        },
        seedSolarSystem: () => {
          const existingByName = new Map(page.solarBodies.map((b) => [(b.name || "").trim().toLowerCase(), b.id]))
          const freshBodies = buildSeedBodies()
          const freshIdToName = new Map(freshBodies.map((b) => [b.id, (b.name || "").trim().toLowerCase()]))
          const seed = freshBodies
            .filter((b) => !existingByName.has((b.name || "").trim().toLowerCase()))
            .map((b) => {
              if (!b.parentId) return b
              const parentName = freshIdToName.get(b.parentId)
              const existingParentId = parentName ? existingByName.get(parentName) : undefined
              return existingParentId ? { ...b, parentId: existingParentId } : b
            })
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
      surfaceMapDocumentId: typeof x.surfaceMapDocumentId === "string" ? x.surfaceMapDocumentId : null,
      surfaceMapDocumentName: typeof x.surfaceMapDocumentName === "string" ? x.surfaceMapDocumentName : null,
    }))
}

// frozenPage — reads extra.page directly. The bake CANNOT put the wiki's own
// useCollabState data here (that lives in a Hocuspocus room the publish
// context has no access to), so on the published site this typically comes
// back null and the caller falls back to a seeded default solar system.
function frozenPage(snapshot: unknown): PageState {
  if (!snapshot || typeof snapshot !== "object") return EMPTY_PAGE
  const snap = snapshot as Record<string, unknown>
  const extra = snap.extra && typeof snap.extra === "object" ? (snap.extra as Record<string, unknown>) : null
  const raw = extra && "page" in extra ? extra.page : null
  if (!raw || typeof raw !== "object") return EMPTY_PAGE
  const p = raw as Partial<Record<keyof PageState, unknown>>
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
  return {
    title: typeof p.title === "string" ? p.title : "",
    subtitle: typeof p.subtitle === "string" ? p.subtitle : "",
    bannerMediaId: typeof p.bannerMediaId === "string" ? p.bannerMediaId : "",
    bannerFocusY: typeof p.bannerFocusY === "number" ? Math.max(0, Math.min(100, p.bannerFocusY)) : 50,
    sectionOrder: strings(p.sectionOrder),
    featuredIds: strings(p.featuredIds),
    solarBodies: parseSolarBodies(p.solarBodies),
  }
}

// The row shape ctx.documents() bakes into `index` is the same slim shape
// useWorldQuery("documents") serves live — see docs/reference/wiki.md
// ("Reading the world" table). WikiPage reads whichever one is available.
type WikiDocRow = {
  id: string
  name: string
  slug: string | null
  documentType: string
  entityTypeId: string | null
  avatarMediaId: string | null
  aliases: readonly string[]
  isViewable: boolean
}

// frozenIndex — reads the baked document catalog (`snapshot.index`) for the
// published site. This is NOT the same thing as `extra.page` (frozenPage):
// `index` is the plain doc catalog the bake always writes (see
// publish-hooks.ts), independent of whether the wiki's own useCollabState
// page state could be baked. Without this, WikiPage's `useWorldQuery` call —
// which is a LIVE, socket-backed read with no meaning on a published page —
// silently resolves to an empty array, and every part of the wiki keyed off
// `docs` (the entries grid, the timeline widget, the article viewer opened
// via `entryPath`) renders as if the world were empty. Content reached via a
// directly-known id (a solar body's linkedDocumentId/surfaceMapDocumentId,
// rendered straight through <HostEmbed>) never depended on `docs`, which is
// why those kept working while cards/timeline/custom-tool entries didn't.
function frozenIndex(snapshot: unknown): WikiDocRow[] {
  if (!snapshot || typeof snapshot !== "object") return []
  const snap = snapshot as Record<string, unknown>

  const fromArray = Array.isArray(snap.index) ? snap.index : null
  const fromRefs = snap.refs && typeof snap.refs === "object" && !Array.isArray(snap.refs)
    ? Object.entries(snap.refs as Record<string, unknown>) : null
  const fromDocuments = snap.documents && typeof snap.documents === "object" && !Array.isArray(snap.documents)
    ? Object.entries(snap.documents as Record<string, unknown>) : null

  // Last publish showed snapshot.documents present with 25 keys (matching
  // the bake's own refs/index counts) while snapshot.index yielded nothing
  // — so which field the platform actually serves at runtime is still
  // unconfirmed. Logging all three candidates + the raw top-level keys here
  // means the NEXT publish settles it from real data instead of another
  // guess.
  console.error(
    "[frozenIndex] candidate sources — index:", fromArray ? fromArray.length + " (array)" : "absent/not-array",
    "| refs:", fromRefs ? fromRefs.length + " (object)" : "absent/not-object",
    "| documents:", fromDocuments ? fromDocuments.length + " (object)" : "absent/not-object",
    "| top-level snapshot keys:", Object.keys(snap).join(", "),
  )

  const toRow = (id: string, src: Record<string, unknown>): WikiDocRow => {
    const meta = src.meta && typeof src.meta === "object" ? (src.meta as Record<string, unknown>) : {}
    const name = typeof src.name === "string" ? src.name
      : typeof meta.name === "string" ? meta.name
      : typeof src.title === "string" ? src.title
      : "Untitled"
    const slug = typeof src.slug === "string" ? src.slug : typeof meta.slug === "string" ? meta.slug : null
    const documentType = typeof src.documentType === "string" ? src.documentType : typeof src.type === "string" ? src.type : "entry"
    return {
      id,
      name,
      slug,
      documentType,
      entityTypeId: typeof src.entityTypeId === "string" ? src.entityTypeId : null,
      avatarMediaId: typeof src.avatarMediaId === "string" ? src.avatarMediaId : null,
      aliases: Array.isArray(src.aliases) ? src.aliases.filter((a): a is string => typeof a === "string") : [],
      isViewable: src.isViewable !== false,
    }
  }

  // Preference order: index (the purpose-built row shape) > refs (also a
  // clean row shape, just keyed by id) > documents (raw content objects —
  // noisier to read fields from, but observed present with a full id set
  // even when the other two weren't, so it's the most reliable fallback).
  if (fromArray && fromArray.length > 0) {
    const rows = fromArray
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => toRow(typeof d.id === "string" ? d.id : "", d))
      .filter((d) => d.id !== "")
    console.error("[frozenIndex] using snapshot.index —", rows.length, "rows")
    return rows
  }
  if (fromRefs && fromRefs.length > 0) {
    const rows = fromRefs
      .filter((entry): entry is [string, Record<string, unknown>] => !!entry[0] && !!entry[1] && typeof entry[1] === "object")
      .map(([id, d]) => toRow(id, d))
    console.error("[frozenIndex] using snapshot.refs —", rows.length, "rows")
    return rows
  }
  if (fromDocuments && fromDocuments.length > 0) {
    const rows = fromDocuments
      .filter((entry): entry is [string, Record<string, unknown>] => !!entry[0] && !!entry[1] && typeof entry[1] === "object")
      .map(([id, d]) => toRow(id, d))
    console.error("[frozenIndex] using snapshot.documents (content-derived) —", rows.length, "rows")
    return rows
  }
  console.error("[frozenIndex] no usable source found on the snapshot — entries grid will be empty")
  return []
}

// ScifiThemeBaked — the render half of the published site. The wiki's live
// state (map, banner, title, featured list) is not reachable from the bake,
// so this falls back to a seeded default solar system whenever the baked
// page comes back empty. The seed is generated ONCE per mount (useState lazy
// init) rather than on every render, so body ids stay stable within one
// visit — otherwise the 3D scene would rebuild continuously.
export function ScifiThemeBaked({ snapshot, settings, entryPath }: PublishedAppSurfaceProps) {
  const [page] = useState<PageState>(() => {
    const parsed = frozenPage(snapshot)
    if (parsed.solarBodies.length > 0) return parsed
    return { ...parsed, solarBodies: buildSeedBodies() }
  })
  const [docs] = useState<WikiDocRow[]>(() => frozenIndex(snapshot))

  // snapshot.documents is null on the published site — the platform delivers
  // the full document content blob via a separate fetch URL (docsPointer)
  // rather than inlining it in the snapshot prop. We fetch it once on mount
  // and pass it to WikiPage so FrozenCardBody can render card entries without
  // needing a live HostEmbed / collab socket.
  const [frozenDocContent, setFrozenDocContent] = useState<Record<string, Record<string, unknown>> | null>(() => {
    // Try inline first — may be available in future platform versions or in
    // dev/preview contexts where the blob isn't offloaded.
    const snap = (snapshot ?? {}) as Record<string, unknown>
    const raw = snap.documents
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>
      if (Object.keys(obj).length > 0) {
        console.error("[baked] documents inline — ", Object.keys(obj).length, "docs")
        return obj as Record<string, Record<string, unknown>>
      }
    }
    return null
  })

  useEffect(() => {
    if (frozenDocContent) return // already have inline content
    const snap = (snapshot ?? {}) as Record<string, unknown>
    const pointer = snap.docsPointer
    if (!pointer || typeof pointer !== "string") {
      console.error("[baked] no docsPointer — card bodies will not render on published site")
      return
    }
    console.error("[baked] fetching docsPointer:", pointer)
    fetch(pointer)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status)
        return r.json()
      })
      .then((data: unknown) => {
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const obj = data as Record<string, Record<string, unknown>>
          console.error("[baked] docsPointer fetched — ", Object.keys(obj).length, "docs")
          setFrozenDocContent(obj)
        } else {
          console.error("[baked] docsPointer fetch returned unexpected shape:", typeof data)
        }
      })
      .catch((e) => console.error("[baked] docsPointer fetch failed:", e))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-shot diagnostic
  try {
    const snap = (snapshot ?? {}) as Record<string, unknown>
    const extra = (snap.extra && typeof snap.extra === "object" ? snap.extra : null) as Record<string, unknown> | null
    console.error(
      "[baked] v14 — title:", JSON.stringify(page.title),
      "| solarBodies:", page.solarBodies.length,
      "| index rows:", docs.length,
      "| extra.page:", extra && "page" in extra ? (extra.page === null ? "null" : typeof extra.page) : "absent",
      "| docsPointer:", JSON.stringify((snap as Record<string, unknown>).docsPointer ?? null),
      "| documents inline:", snap.documents ? (typeof snap.documents === "object" && !Array.isArray(snap.documents) ? Object.keys(snap.documents as Record<string, unknown>).length + " keys" : typeof snap.documents) : "null/absent",
      "| entryPath:", JSON.stringify(entryPath),
    )
  } catch (e) {
    console.error("[baked] diagnostic failed", e)
  }

  return <WikiPage editing={false} values={frozenCustomization(settings)} page={page} actions={null} entryPath={entryPath} frozenDocs={docs} frozenDocContent={frozenDocContent} />
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