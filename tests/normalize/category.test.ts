import { describe, it, expect } from 'vitest'
import { classifyCategory } from '@/lib/normalize/category'

describe('classifyCategory', () => {
  const cases: Array<[string, string]> = [
    ['Winogrono jasne na wagę', 'owoce-warzywa'],
    ['Cebula żółta luzem 1 kg', 'owoce-warzywa'],
    ['Karkówka grillowa pakowana próżniowo Czas na Grill', 'mieso-wedliny'],
    ['Wszystkie paczkowane kabanosy', 'mieso-wedliny'],
    ['Świeży pstrąg tęczowy patroszony, Marinero', 'ryby'],
    ['Masło Ekstra Mleczna Dolina, 200 g', 'nabial'],
    ['MLEKPOL Ser Królewski z Kolna 100 g', 'nabial'],
    ['Bułka grahamka 70 g sztuka', 'pieczywo'],
    ['Napój gazowany Coca-Cola, 2 l', 'napoje'],
    ['Napój energetyczny Red Bull, 250 ml', 'napoje'],
    ['Wszystkie kawy', 'napoje'],
    ['Piwo Żubr Jasne Pełne, 500 ml', 'alkohol'],
    ['Wszystkie piwa w butelkach zwrotnych i bezzwrotnych', 'alkohol'],
    ['Wszystkie czekolady marki Milka, 85-100 g', 'slodycze-przekaski'],
    ['K-CLASSIC Lody Maxx na patyku, 8 x 100 ml', 'mrozonki'],
    ['Ketchup łagodny Pudliszki, 990 g', 'spozywcze'],
    ['Papier toaletowy 3-warstwowy Floralys', 'chemia-higiena'],
    ['Leżak ogrodowy Vigo', 'dom-ogrod'],
    ['Zestaw mebli Lorca grafit, stół i 6 krzeseł', 'dom-ogrod'],
  ]
  it.each(cases)('puts %s in %s', (name, expected) => {
    expect(classifyCategory(name)).toBe(expected)
  })

  it('claims the aisles that used to fall into inne', () => {
    // August leaflets are full of these; they were most of the "inne" bucket.
    expect(classifyCategory('Zeszyt A4/60')).toBe('szkola-biuro')
    expect(classifyCategory('Kredki ołówkowe, 12 szt.')).toBe('szkola-biuro')
    expect(classifyCategory('długopisy Cristal Fun Colours, 8 szt.')).toBe('szkola-biuro')
    expect(classifyCategory('Karma dla psa Activ Pet, 2 kg')).toBe('zwierzeta')
    expect(classifyCategory('Bluza dresowa męska')).toBe('odziez')
  })

  it('keeps pet food out of the meat aisle', () => {
    // "Karma dla psa ... z kaczką" matches meat keywords; pets must win.
    expect(classifyCategory('Karma dla psa, 2 kg: z kaczką, z jagnięciną'))
      .toBe('zwierzeta')
  })

  it('prefers the narrower aisle: beer is alcohol, not a drink', () => {
    expect(classifyCategory('Piwo Harnaś, 500 ml')).toBe('alkohol')
  })

  it('prefers frozen over dairy for ice cream', () => {
    expect(classifyCategory('Lody śmietankowe 500 ml')).toBe('mrozonki')
  })

  it('falls back to inne when nothing matches', () => {
    expect(classifyCategory('Zestaw do kiszenia pęczek')).toBe('inne')
  })
})
