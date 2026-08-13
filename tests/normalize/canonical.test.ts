import { describe, it, expect } from 'vitest'
import { coreName, canonicalKey } from '@/lib/normalize/canonical'

describe('coreName', () => {
  it('strips marketing tokens and punctuation, keeps diacritics', () => {
    expect(coreName('Masło Ekstra Mleczna Dolina, 200 g, Mega Paka'))
      .toBe('masło ekstra mleczna dolina')
  })
  it('strips loose-goods wording', () => {
    expect(coreName('Winogrono jasne na wagę')).toBe('winogrono jasne')
  })
  it('aligns loose produce across shops that word it differently', () => {
    // Biedronka writes "na wagę", Kaufland writes "luzem 1 kg"; both are the
    // same grapes sold by weight and must reduce to the same core name.
    expect(coreName('Winogrono jasne na wagę')).toBe('winogrono jasne')
    expect(coreName('Winogrona jasne luzem 1 kg')).toBe('winogrona jasne')
  })

  it('collapses whitespace', () => {
    expect(coreName('Napój   gazowany,  2 l')).toBe('napój gazowany')
  })
})

describe('canonicalKey', () => {
  it('combines brand, core name and size', () => {
    expect(canonicalKey({
      brand: 'Mleczna Dolina',
      name: 'Masło Ekstra Mleczna Dolina, 200 g',
      size: { value: 200, unit: 'g' },
    })).toBe('mleczna dolina|masł ekstr mleczn dolin|200g')
  })
  it('omits the size segment when there is none', () => {
    expect(canonicalKey({
      brand: null,
      name: 'Winogrono jasne na wagę',
      size: null,
    })).toBe('|winogron jasn|')
  })
  it('is stable across letter case and trailing punctuation', () => {
    const a = canonicalKey({ brand: 'MORLINY', name: 'Kiełbasa Śląska.', size: null })
    const b = canonicalKey({ brand: 'Morliny', name: 'kiełbasa śląska', size: null })
    expect(a).toBe(b)
  })
})
