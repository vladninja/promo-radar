import { gazetkiSource } from '@/lib/sources/gazetkipromocyjne'
import type { LeafletSource } from '@/lib/sources/types'

export const sources: Record<string, LeafletSource> = {
  [gazetkiSource.slug]: gazetkiSource,
}
