import {
  WIKI_TEMPLATE_DEFAULT_ID,
  WIKI_HEADING_FONT_PARAM,
  WIKI_BODY_FONT_PARAM,
  type AppCustomizationValues,
} from "@vvd/sdk"

export type ThemeSpec = {
  name: string
  bg: string
  ink: string
  card: string
  line: string
  accent: string
  serif: boolean
  /** NERV/MAGI HUD orange — Evangelion terminal accent */
  hud: string
  /** Muted label / status text */
  muted: string
  /** Deep panel backdrop */
  panel: string
}

/** The scifi-theme default — NERV-terminal dark sci-fi (Evangelion HUD palette). */
export const TEMPLATE_DEFAULT: ThemeSpec = {
  name: "NERV Terminal",
  bg: "#0a0e17",
  ink: "#dce3f0",
  card: "#121826",
  line: "rgba(124,140,255,0.22)",
  accent: "#7c8cff",
  hud: "#ff8c42",
  muted: "#7186a8",
  panel: "rgba(6,8,16,0.94)",
  serif: false,
}

export const MONO = "'Space Mono', 'Courier New', ui-monospace, monospace"

export function bodyFont(t: ThemeSpec): string {
  return t.serif ? "Georgia, 'Times New Roman', serif" : "'Space Grotesk', ui-sans-serif, system-ui, sans-serif"
}

export function ensureWikiFont(name: string, source?: string) {
  if (source !== "google" || typeof document === "undefined") return
  const id = "wiki-font-" + name.replace(/ /g, "-").toLowerCase()
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = "https://fonts.googleapis.com/css2?family=" + name.replace(/ /g, "+") + ":wght@400;500;600;700&display=swap"
  document.head.appendChild(link)
}

export function chosenFont(param: typeof WIKI_HEADING_FONT_PARAM, choiceId: string): string | null {
  if (choiceId === "default") return null
  const option = param.options.find((o) => o.id === choiceId)
  if (!option) return null
  ensureWikiFont(option.name, option.source)
  return option.family
}

/** Preload the Evangelion HUD font stack so labels render correctly on first paint. */
export function preloadSciFiFonts() {
  ensureWikiFont("Space Grotesk", "google")
  ensureWikiFont("Space Mono", "google")
}

export function themeFromPreset(p: { id: string; name: string; values: Record<string, string> }): ThemeSpec {
  if (p.id === WIKI_TEMPLATE_DEFAULT_ID || p.id === "nerv-terminal") return TEMPLATE_DEFAULT
  const v = p.values
  const accent = v.primary || "#7c8cff"
  return {
    name: p.name,
    bg: v.background || "#0a0e17",
    ink: v.foreground || "#dce3f0",
    card: v.secondary || v.background || "#121826",
    line: v.line || "rgba(127,127,127,0.3)",
    accent,
    hud: v.hud || (p.id === "ember" ? "#fb923c" : "#ff8c42"),
    muted: v.muted || "#7186a8",
    panel: v.panel || "rgba(6,8,16,0.94)",
    serif: v.font === "serif",
  }
}

export function worldTheme(snap: { mode: string; tokens: Record<string, string> }): ThemeSpec {
  const tk = snap.tokens
  const light = snap.mode === "light"
  return {
    name: "Your World",
    bg: tk["--background"] || (light ? "#f6f5f1" : "#101014"),
    ink: tk["--foreground"] || tk["--text-color"] || (light ? "#1c1b18" : "#e8e8ec"),
    card: tk["--muted"] || (light ? "#ffffff" : "#181820"),
    line: tk["--border"] || (light ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)"),
    accent: tk["--primary"] || (light ? "#3d3a34" : "#9aa4b2"),
    hud: tk["--accent"] || "#ff8c42",
    muted: tk["--muted-foreground"] || (light ? "#6b6a64" : "#7186a8"),
    panel: light ? "rgba(255,255,255,0.94)" : "rgba(6,8,16,0.94)",
    serif: false,
  }
}

/** Shared HUD chrome styles — star map + classic wiki use the same tokens. */
export function hudStyles(T: ThemeSpec) {
  const statChip = {
    padding: "4px 10px",
    borderRadius: 3,
    border: "1px solid " + T.line,
    color: T.muted,
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
    whiteSpace: "nowrap" as const,
  }
  const monoBtn = {
    padding: "5px 11px",
    borderRadius: 3,
    border: "1px solid " + T.line,
    background: T.card + "80",
    color: T.ink,
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
  }
  const chip = {
    padding: "5px 12px",
    borderRadius: 3,
    border: "1px solid " + T.line,
    background: "transparent",
    color: T.ink,
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  }
  const editChip = { ...chip, borderStyle: "dashed" as const, opacity: 0.85 }
  const sectionLabel = {
    margin: 0,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 1.4,
    color: T.muted,
    fontFamily: MONO,
  }
  const input = {
    padding: "8px 12px",
    borderRadius: 3,
    border: "1px solid " + T.line,
    background: T.card,
    color: T.ink,
    fontFamily: MONO,
    fontSize: 12,
    outline: "none",
    letterSpacing: 0.3,
  }
  const card = {
    borderRadius: 4,
    border: "1px solid " + T.line,
    background: T.card,
    color: T.ink,
  }
  const headerBar = {
    borderBottom: "1px solid " + T.line,
    background: "linear-gradient(rgba(6,8,16,0.85), rgba(6,8,16,0.2))",
  }
  const mapBg = "radial-gradient(ellipse at 50% 46%, " + shadeHex(T.bg, 8) + " 0%, " + T.bg + " 55%, #04050a 100%)"
  return { statChip, monoBtn, chip, editChip, sectionLabel, input, card, headerBar, mapBg }
}

function shadeHex(hex: string, amt: number) {
  const n = parseInt(hex.replace("#", ""), 16)
  if (Number.isNaN(n)) return hex
  let r = (n >> 16) + amt
  let g = ((n >> 8) & 0xff) + amt
  let b = (n & 0xff) + amt
  r = Math.min(255, Math.max(0, r))
  g = Math.min(255, Math.max(0, g))
  b = Math.min(255, Math.max(0, b))
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
