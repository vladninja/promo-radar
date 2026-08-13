import { describe, it, expect } from 'vitest'
import { matchName, stemWord } from '@/lib/normalize/stem'
import { canonicalKey, coreName } from '@/lib/normalize/canonical'

const keyFor = (raw: string) =>
  canonicalKey({ brand: null, name: raw, size: null })

describe('stemWord', () => {
  const cases: Array<[string, string]> = [
    ['ogórek', 'ogórk'],      // the fleeting e
    ['ogórki', 'ogórk'],
    ['gruntowy', 'gruntow'],
    ['gruntowe', 'gruntow'],
    ['nektarynki', 'nektarynk'],
    ['nektarynka', 'nektarynk'],
    ['arbuzy', 'arbuz'],
    ['arbuz', 'arbuz'],
    ['śliwki', 'śliwk'],
    ['śliwka', 'śliwk'],
    ['masło', 'masł'],
    ['masła', 'masł'],
    ['sok', 'sok'],           // too short to spare a letter
    ['ser', 'ser'],
    ['chleb', 'chleb'],
  ]
  it.each(cases)('%s → %s', (input, expected) => {
    expect(stemWord(input)).toBe(expected)
  })

  it('keeps genuinely different produce apart', () => {
    expect(matchName('ogórek gruntowy')).not.toBe(matchName('ogórek szklarniowy'))
    expect(matchName('papryka czerwona')).not.toBe(matchName('papryka żółta'))
  })
})

describe('canonicalKey', () => {
  it('gives one key to a cucumber two shops spell differently', () => {
    // Biedronka prints "Ogórek gruntowy na wagę", Kaufland "Ogórki gruntowe
    // luzem 1 kg". The trigram scored 0.52 — under the attach threshold — so
    // each shop had its own cucumber and neither knew about the other's price.
    expect(keyFor('Ogórek gruntowy na wagę'))
      .toBe(keyFor('Ogórki gruntowe luzem 1 kg'))
  })

  it('ignores how loose produce is presented', () => {
    expect(keyFor('Nektarynki, luzem 1 kg'))
      .toBe(keyFor('Nektarynki układane, luzem 1 kg'))
  })

  it('still separates two different things', () => {
    expect(keyFor('Ogórek gruntowy')).not.toBe(keyFor('Ogórek kiszony'))
    expect(keyFor('Jabłka Gala')).not.toBe(keyFor('Jabłka Ligol'))
  })
})

describe('coreName', () => {
  it('stays readable — the stem is for matching, not for showing', () => {
    expect(coreName('Ogórki gruntowe luzem 1 kg')).toBe('ogórki gruntowe')
  })
})
