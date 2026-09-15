import type {
  DocumentRef,
  PublishBakeContext,
  PublishedAppContent,
} from "@vvd/sdk"

// scifi-theme's own publish BAKE — the app-defined half of publishing.
//
// The PLATFORM owns identity, version allocation, audience, chunked
// persistence and serving. The APP owns this projection: read the live world
// through a reads-only context and return ONE immutable edition. It runs
// wherever the publisher runs it (a sandboxed browser context today), never
// against a database of its own — the ctx is the only door, and it has no
// write path.
//
// ─────────────────────────────────────────────────────────────────────────
// UPDATE — re-reading ctx.appState() per the official docs.
//
// A previous session concluded ctx.appState() was unusable for baking the
// wiki's own state (title/subtitle/banner/featured/solarBodies), because in
// their test it came back shaped like the platform's home-page grid layout
// ({config, pageSelections}) instead. BUT: docs.beta.vvd.world/workshop/
// reference/wiki now documents ctx.appState() as "the instance's live page
// state, as the publishing surface handed it over", and its own reference
// bake implementation does exactly:
//
//     extra: { worldName: world.name, page: appState ?? null }
//
// That is precisely our situation — this app is a `category: "site"` wiki
// app with `publish: "custom"`, exactly what that doc section describes.
// So we now call ctx.appState() (defensively — it's optional on the ctx
// type) and bake its result into extra.page. `frozenPage()` on the render
// side already reads extra.page, so no change is needed there.
//
// If a future bake run logs `[bake] appState() — ok` but the SHAPE still
// looks like {config, pageSelections} rather than {title, subtitle,
// bannerMediaId, sectionOrder, featuredIds, solarBodies, ...}, that means
// the previous finding was real for this platform version, not stale docs —
// in that case extra.page should go back to null and ScifiThemeBaked's
// existing seeded-fallback keeps the published site working either way.
// The diagnostic below logs the top-level keys specifically so this is easy
// to tell apart at a glance without re-deriving it from scratch.
//
// CONSOLE NOTE — learned the hard way:
//   This module executes inside a sandboxed Worker bridged to the main page
//   through `bake-broker.ts`. The broker relays ONLY `console.error` calls
//   and thrown errors back to the DevTools console you're watching — any
//   `console.log` or `console.warn` output stays in the sandbox's own
//   console, invisible to you. All diagnostics below therefore use
//   `console.error`, deliberately.
// ─────────────────────────────────────────────────────────────────────────
const BUILD_MARKER = "v14 — docsPointer fetch: ScifiThemeBaked fetches snapshot.documents from docsPointer URL on mount so FrozenCardBody can render card entries without HostEmbed"

// Document types that legitimately have no content — documentContent()
// returning null for these is not an error.
const CONTENTLESS_DOC_TYPES = new Set(["folder", "section", "group", "collection"])

export async function bake(ctx: PublishBakeContext): Promise<PublishedAppContent> {
  console.error("[bake] running — build marker: " + BUILD_MARKER)

  const safe = async <T,>(p: (() => Promise<T>) | undefined, fallback: T, label: string): Promise<T> => {
    if (!p) {
      console.error("[bake] " + label + "() — not provided by host, using fallback")
      return fallback
    }
    try {
      const v = await p()
      console.error("[bake] " + label + "() — ok")
      return v
    } catch (e) {
      console.error("[bake] " + label + "() failed — using fallback", e)
      return fallback
    }
  }

  const [world, docs, entityTypes, rawMediaUrls, appState] = await Promise.all([
    safe(() => ctx.world(), { name: "" } as any, "world"),
    safe(() => ctx.documents(), [] as any[], "documents"),
    safe(() => ctx.entityTypes(), [] as any[], "entityTypes"),
    safe(() => ctx.mediaUrls(), {} as Record<string, string>, "mediaUrls"),
    safe(() => (ctx.appState ? ctx.appState() : Promise.resolve(null)), null as any, "appState"),
  ])

  // Sanity-check the SHAPE, not just that the call succeeded — this is the
  // thing that will tell us at a glance whether appState() is really the
  // wiki's page state on this platform version or still the unrelated
  // home-grid store the previous session found.
  const looksLikePageState = !!appState && typeof appState === "object" &&
    ("title" in appState || "solarBodies" in appState || "bannerMediaId" in appState || "sectionOrder" in appState)
  console.error(
    "[bake] appState() shape — keys:", appState && typeof appState === "object" ? Object.keys(appState).join(", ") : String(appState),
    "| looks like wiki page state:", looksLikePageState,
  )

  if (looksLikePageState) {
    console.error(
      "[bake] NOTE — appState() looks like real wiki page state; using it for extra.page. " +
      "If the published site's title/banner/map still don't match the live editor, appState() " +
      "may be returning a stale or partial snapshot — check the shape logged above.",
    )
  } else {
    console.error(
      "[bake] NOTE — appState() did NOT look like wiki page state (see shape logged above); " +
      "falling back to extra.page: null, same as before. " +
      "The published site will fall back to world metadata + a client-side seeded solar system.",
    )
  }
  console.error("[bake] world.name:", JSON.stringify(world?.name))
  console.error(
    "[bake] counts — documents:", docs.length,
    "entityTypes:", Array.isArray(entityTypes) ? entityTypes.length : "(not an array)",
  )

  // ── mediaUrls normalization + drop-bad ────────────────────────────────
  // The publish validator rejects the ENTIRE publish if even one mediaUrls
  // value isn't http(s) or data: — with no indication of which id was at
  // fault. Drop them here so one bad world media row can't take the whole
  // world's publish down.
  const isPublishable = (u: unknown): u is string =>
    typeof u === "string" && (/^https?:\/\//.test(u) || /^data:/.test(u))

  const rawEntries = Object.entries(rawMediaUrls || {})
  const badRaw = rawEntries.filter(([, u]) => !isPublishable(u))
  console.error("[bake] RAW mediaUrls — " + rawEntries.length + " entries, " + badRaw.length + " non-publishable")
  badRaw.forEach(([id, u]) => {
    console.error("  BAD  " + id + "  =>  " + JSON.stringify(String(u).slice(0, 200)))
  })

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const mediaUrls: Record<string, string> = {}
  const dropped: { id: string; url: string }[] = []

  for (const [id, url] of rawEntries) {
    if (!url) continue
    let abs: string = typeof url === "string" ? url : String(url)
    if (!isPublishable(abs) && origin) {
      try { abs = new URL(abs, origin).href } catch { /* leave as-is */ }
    }
    if (isPublishable(abs)) mediaUrls[id] = abs
    else dropped.push({ id, url: abs.slice(0, 200) })
  }

  if (dropped.length > 0) {
    console.error("[bake] DROPPED " + dropped.length + " non-publishable mediaUrls entry(ies):")
    dropped.forEach((d) => console.error("  dropped  " + d.id + "  =>  " + JSON.stringify(d.url)))
  }
  console.error("[bake] final mediaUrls — " + Object.keys(mediaUrls).length + " entries after drop")

  // ── refs / routes ─────────────────────────────────────────────────────
  const refs: Record<string, DocumentRef> = {}
  const routes: Record<string, string> = {}
  const documents: Record<string, unknown> = {}

  for (const d of docs) {
    refs[d.id] = {
      id: d.id,
      name: d.name,
      slug: d.slug ?? d.id,
      type: d.documentType,
      avatarMediaId: d.avatarMediaId ?? null,
      entityTypeId: d.entityTypeId ?? null,
    }
    routes[d.id] = "/" + encodeURIComponent(d.slug ?? d.id)
  }

  // ── document content, folder-aware ────────────────────────────────────
  const BATCH = 24
  const emptyExpected: { id: string; type: string }[] = []
  const emptyUnexpected: { id: string; slug: string; type: string; rowKeys: string[] }[] = []

  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH)
    const contents = await Promise.all(
      slice.map((d) =>
        ctx.documentContent(d.id).catch((e) => {
          console.error("[bake] documentContent threw for", d.id, e)
          return null
        }),
      ),
    )
    slice.forEach((d, j) => {
      const c = contents[j]
      if (c != null) {
        documents[d.id] = c
      } else if (CONTENTLESS_DOC_TYPES.has(String(d.documentType))) {
        emptyExpected.push({ id: d.id, type: String(d.documentType) })
      } else {
        emptyUnexpected.push({
          id: d.id,
          slug: d.slug ?? d.id,
          type: d.documentType ?? "?",
          rowKeys: Object.keys(d),
        })
      }
    })
  }

  console.error(
    "[bake] documents with content:", Object.keys(documents).length,
    "| expected-empty (folder/section/etc):", emptyExpected.length,
    "| UNEXPECTEDLY empty:", emptyUnexpected.length,
  )

  if (emptyUnexpected.length > 0) {
    console.error("[bake] *** " + emptyUnexpected.length + " document(s) with a content-bearing type baked empty: ***")
    const byType: Record<string, number> = {}
    emptyUnexpected.forEach((f) => { byType[f.type] = (byType[f.type] || 0) + 1 })
    console.error("[bake] unexpected-empty by type:", JSON.stringify(byType))
    emptyUnexpected.forEach((f) => {
      console.error(
        "  empty  id=" + f.id + "  slug=" + f.slug + "  type=" + f.type + "  rowKeys=" + f.rowKeys.join(","),
      )
    })
  }

  const firstDocId = Object.keys(documents)[0]
  if (firstDocId) {
    const first = documents[firstDocId] as any
    console.error(
      "[bake] sample baked doc", firstDocId, "— top-level keys:",
      first && typeof first === "object" ? Object.keys(first).join(", ") : "(" + typeof first + ")",
    )
  }

  // ── Bug 2 fix: read solarBodies from the scifi-theme document directly ────
  // ctx.appState() returns the platform's home-grid layout store
  // ({config, pageSelections}) instead of this wiki's useCollabState — a
  // confirmed platform-side bug (see shape-check log above). But
  // ctx.documentContent() IS confirmed reliable (19/25 docs baked
  // successfully). The wiki's own useCollabState lives in the world document
  // whose documentType === "scifi-theme" — that is the document this tool
  // opens (see ToolRegistry in app.tsx). We read it here as the fallback
  // source of solarBodies (and the rest of the page state) for extra.page.
  //
  // IMPORTANT: we do NOT yet know the exact shape ctx.documentContent()
  // returns for a field.list<SolarBody>()-based codec — the Yjs CRDT layer
  // may serialize lists differently from a plain JS array. The diagnostic
  // below logs the exact shape so a future session can verify without
  // re-deriving it from scratch. frozenPage() in app.tsx handles the
  // parsing safely with a parseSolarBodies() validator that rejects bad rows.
  let wikiDocContent: Record<string, unknown> | null = null
  const wikiDoc = docs.find((d) => (d as any).documentType === "scifi-theme")
  if (wikiDoc) {
    try {
      const rawContent = await ctx.documentContent(wikiDoc.id)
      if (rawContent && typeof rawContent === "object") {
        wikiDocContent = rawContent as Record<string, unknown>
        const wikiKeys = Object.keys(wikiDocContent).join(", ")
        const solarBodiesVal = wikiDocContent.solarBodies
        console.error(
          "[bake] scifi-theme doc content — id:", wikiDoc.id,
          "| top-level keys:", wikiKeys,
          "| solarBodies type:", Array.isArray(solarBodiesVal) ? "array[" + (solarBodiesVal as unknown[]).length + "]" : typeof solarBodiesVal,
        )
      } else {
        console.error("[bake] scifi-theme doc content — returned", typeof rawContent, "(null or non-object, cannot extract solarBodies)")
      }
    } catch (e) {
      console.error("[bake] scifi-theme doc content — documentContent() threw:", e)
    }
  } else {
    console.error(
      "[bake] scifi-theme doc content — no document with documentType='scifi-theme' found in",
      docs.length, "docs. documentTypes found:",
      [...new Set((docs as any[]).map((d) => d.documentType))].join(", "),
    )
  }

  // Build the extra.page from wikiDocContent (when it looks right) or
  // ctx.appState() (when that looks right). wikiDocContent is tried first
  // because ctx.appState() is confirmed broken on this platform version.
  // Both shape-checks are logged above; on future platform updates, if
  // ctx.appState() starts returning the real wiki state, this logic will
  // naturally prefer it once looksLikePageState is true.
  const pageForExtra = looksLikePageState
    ? appState
    : (wikiDocContent && (
        "title" in wikiDocContent ||
        "solarBodies" in wikiDocContent ||
        "bannerMediaId" in wikiDocContent
      ) ? wikiDocContent : null)

  if (pageForExtra && pageForExtra !== appState) {
    const bodiesVal = (pageForExtra as Record<string, unknown>).solarBodies
    console.error(
      "[bake] using wikiDocContent for extra.page — solarBodies:",
      Array.isArray(bodiesVal) ? bodiesVal.length + " items" : typeof bodiesVal,
    )
  }

  console.error(
    "[bake] returning payload — index:", docs.length,
    "refs:", Object.keys(refs).length,
    "documents:", Object.keys(documents).length,
    "mediaUrls:", Object.keys(mediaUrls).length,
  )

  return {
    index: docs,
    refs,
    routes,
    mediaUrls,
    entityTypes,
    documents,
    // extra.page carries the wiki's own useCollabState snapshot for the
    // published site renderer (frozenPage() in app.tsx reads it). If both
    // ctx.appState() and ctx.documentContent() fail, this is null and
    // ScifiThemeBaked's seeded-solar-system fallback keeps the published
    // site working either way.
    extra: { worldName: world?.name, page: pageForExtra ?? null },
  }
}