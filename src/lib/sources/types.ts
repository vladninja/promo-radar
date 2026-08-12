export interface DiscoveredLeaflet {
  shopSlug: string
  externalId: string
  pdfUrl: string
  publishedAt: Date
  coverUrl: string | null
}

export interface LeafletSource {
  slug: string
  discover(
    shopSlugs: readonly string[],
    since: Date | null,
  ): Promise<DiscoveredLeaflet[]>
  fetchAsset(
    leaflet: DiscoveredLeaflet,
    destDir: string,
  ): Promise<{ path: string; sha256: string }>
}
