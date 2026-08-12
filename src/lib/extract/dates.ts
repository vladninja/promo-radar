export interface DateRange { from: Date; to: Date }
export type DateSource = 'offer' | 'page' | 'leaflet'

const ISSUE = /\bNR\s*\d+\s*\/\s*(20\d{2})/i
const TWO_DATES = /(\d{1,2})[.,](\d{1,2})\D{1,12}?(\d{1,2})[.,](\d{1,2})/

export function parseIssueYear(text: string): number | null {
  const m = text.match(ISSUE)
  return m ? Number(m[1]) : null
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

export function parseDateBadge(text: string, anchorYear: number): DateRange | null {
  const m = text.match(TWO_DATES)
  if (!m) return null
  const [d1, m1, d2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const from = utcDate(anchorYear, m1, d1)
  let to = utcDate(anchorYear, m2, d2)
  if (to < from) to = utcDate(anchorYear + 1, m2, d2)
  return { from, to }
}

export function resolveDates(
  offer: DateRange | null,
  page: DateRange | null,
  leaflet: DateRange,
): { range: DateRange; source: DateSource } {
  if (offer) return { range: offer, source: 'offer' }
  if (page) return { range: page, source: 'page' }
  return { range: leaflet, source: 'leaflet' }
}

export function fallbackLeafletRange(publishedAt: Date): DateRange {
  return {
    from: publishedAt,
    to: new Date(publishedAt.getTime() + 7 * 24 * 3600 * 1000),
  }
}
