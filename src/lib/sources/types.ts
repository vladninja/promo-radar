export interface DiscoveredLeaflet {
  shopSlug: string
  externalId: string
  pdfUrl: string
  publishedAt: Date
  coverUrl: string | null
  /** From the shop listing page when available, so expired leaflets can be
   *  skipped before anything is downloaded or parsed. */
  validFrom: Date | null
  validTo: Date | null
  pageCount: number | null
}

export interface LeafletSource {
  slug: string
  /** Every leaflet the shops currently list, with its validity dates. No
   *  cursor: the listing pages are short and already scoped to what is on
   *  or near offer. */
  discover(shopSlugs: readonly string[]): Promise<DiscoveredLeaflet[]>
  fetchAsset(
    leaflet: DiscoveredLeaflet,
    destDir: string,
  ): Promise<{ path: string; sha256: string }>
}
