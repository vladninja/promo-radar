import { describe, it, expect } from 'vitest'
import {
  parseIssueYear, parseDateBadge, resolveDates, fallbackLeafletRange,
} from '@/lib/extract/dates'

describe('parseIssueYear', () => {
  it('reads the year from the issue number', () => {
    expect(parseIssueYear('NR 33/2026 P')).toBe(2026)
  })
  it('returns null when absent', () => {
    expect(parseIssueYear('Produkty dostępne do wyczerpania zapasów.')).toBeNull()
  })
})

describe('parseDateBadge', () => {
  it('parses an offer badge', () => {
    const r = parseDateBadge('OFERTA OD 12.08 DO 14.08', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-08-14')
  })
  it('parses a page header with weekday names', () => {
    const r = parseDateBadge('ŚRODA – PIĄTEK 12.08-14.08', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-08-14')
  })
  it('rolls the end date into the next year across New Year', () => {
    const r = parseDateBadge('OFERTA OD 28.12 DO 03.01', 2026)!
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-12-28')
    expect(r.to.toISOString().slice(0, 10)).toBe('2027-01-03')
  })
  it('returns null when there are no dates', () => {
    expect(parseDateBadge('1+1 GRATIS', 2026)).toBeNull()
  })
})

describe('resolveDates', () => {
  const leaflet = {
    from: new Date('2026-08-12T00:00:00Z'),
    to: new Date('2026-08-19T00:00:00Z'),
  }
  const page = {
    from: new Date('2026-08-12T00:00:00Z'),
    to: new Date('2026-08-14T00:00:00Z'),
  }
  const offer = {
    from: new Date('2026-08-13T00:00:00Z'),
    to: new Date('2026-08-14T00:00:00Z'),
  }

  it('prefers the offer badge', () => {
    const r = resolveDates(offer, page, leaflet)
    expect(r.source).toBe('offer')
    expect(r.range.from).toEqual(offer.from)
  })
  it('falls back to the page header', () => {
    expect(resolveDates(null, page, leaflet).source).toBe('page')
  })
  it('falls back to the leaflet range', () => {
    expect(resolveDates(null, null, leaflet).source).toBe('leaflet')
  })
})

describe('fallbackLeafletRange', () => {
  it('spans a week from publication', () => {
    const r = fallbackLeafletRange(new Date('2026-08-12T10:17:04Z'))
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 24 * 3600 * 1000)
  })
})
