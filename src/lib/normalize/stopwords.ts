/**
 * Marketing text observed in Polish leaflets that carries no product identity.
 * Extend this list as new phrasing shows up; `rescore.ts` can then re-key
 * historical offers without any API calls.
 */
export const STOPWORDS = [
  'mega paka',
  'supercena',
  'super cena',
  'nowość',
  'na wagę',
  'luzem',
  'sztuka',
  'opakowanie',
  'gratis',
  'promocja',
  'taniej',
  'duża paczka',
  'mieszaj dowolnie',
  'pakowane próżniowo',
  'pakowana próżniowo',
  // How loose produce is presented, which says nothing about what it is:
  // Kaufland's "Nektarynki układane" is Lidl's "Nektarynki".
  'układane',
  'układana',
  'kalibrowane',
  'na tackach',
  'w skrzynce',
]
