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
// The shape returned below is the standard world-site projection the platform
// understands: index / refs / routes / mediaUrls / entityTypes / documents.
// Serving reconstructs it and re-serves it to your renderBaked (src/app.tsx)
// through the BAKED host, so useWorldQuery, useWorldMeta and HostEmbed all
// resolve on the published page with no sockets and no auth.
export async function bake(ctx: PublishBakeContext): Promise<PublishedAppContent> {
  const [world, docs, entityTypes, mediaUrls, appState] = await Promise.all([
    ctx.world(),
    // Every shippable row — already filtered by the platform's visibility gates.
    ctx.documents(),
    ctx.entityTypes(),
    ctx.mediaUrls(),
    // The instance's live shared app state (your page's title/banner/featured),
    // when the publishing surface supplies it. Optional + additive: a host that
    // does not hand it over simply publishes the page's defaults.
    ctx.appState ? ctx.appState() : Promise.resolve(undefined),
  ])

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

  // Fetch every document's content in parallel BATCHES — awaiting them one by
  // one turns a 200-card world into a minutes-long publish, and firing all of
  // them at once floods the host.
  const BATCH = 24
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH)
    const contents = await Promise.all(
      slice.map((d) => ctx.documentContent(d.id).catch(() => null)),
    )
    slice.forEach((d, j) => {
      if (contents[j] != null) documents[d.id] = contents[j]
    })
  }

  return {
    index: docs,
    refs,
    routes,
    mediaUrls,
    entityTypes,
    documents,
    // The app's OWN namespace: your page's frozen state, read back by
    // frozenPage() in src/app.tsx.
    extra: { worldName: world.name, page: appState ?? null },
  }
}
