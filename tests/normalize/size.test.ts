import { describe, it, expect } from 'vitest'
import { extractSize } from '@/lib/normalize/size'

describe('extractSize', () => {
  const cases: Array<[string, ReturnType<typeof extractSize>]> = [
    ['Masło Ekstra Mleczna Dolina, 200 g', { value: 200, unit: 'g' }],
    ['Napój gazowany, 2 l', { value: 2000, unit: 'ml' }],
    ['Ręczniki kuchenne Queen Milla, 2 rolki', { value: 2, unit: 'pcs' }],
    ['Karma dla psa, 1,5 kg', { value: 1500, unit: 'g' }],
    ['Sok pomarańczowy, 900 ml', { value: 900, unit: 'ml' }],
    ['Jogurt naturalny, 4 x 125 g', { value: 500, unit: 'g' }],
    ['Winogrono jasne na wagę', null],
    ['Karkówka grillowa pakowana próżniowo', null],
  ]
  it.each(cases)('extracts from %s', (input, expected) => {
    expect(extractSize(input)).toEqual(expected)
  })
})
