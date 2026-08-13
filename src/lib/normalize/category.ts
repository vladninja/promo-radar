/**
 * What aisle a promotion belongs to.
 *
 * Promotions are the thing the app lists, and most of them are not products in
 * any strict sense — "Wszystkie piwa w butelkach" is a whole category on offer,
 * "Red Bull 2+2 gratis" is a mechanic on a brand. Categories give those a useful
 * handle for filtering without pretending they are products.
 */
export const CATEGORIES = [
  'owoce-warzywa',
  'mieso-wedliny',
  'ryby',
  'nabial',
  'pieczywo',
  'napoje',
  'alkohol',
  'slodycze-przekaski',
  'mrozonki',
  'spozywcze',
  'chemia-higiena',
  'dom-ogrod',
  'szkola-biuro',
  'odziez',
  'zwierzeta',
  'zabawki',
  'inne',
] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  'owoce-warzywa': 'Owoce i warzywa',
  'mieso-wedliny': 'Mięso i wędliny',
  ryby: 'Ryby i owoce morza',
  nabial: 'Nabiał',
  pieczywo: 'Pieczywo',
  napoje: 'Napoje',
  alkohol: 'Alkohol',
  'slodycze-przekaski': 'Słodycze i przekąski',
  mrozonki: 'Mrożonki',
  spozywcze: 'Artykuły spożywcze',
  'chemia-higiena': 'Chemia i higiena',
  'dom-ogrod': 'Dom i ogród',
  'szkola-biuro': 'Szkoła i biuro',
  odziez: 'Odzież',
  zwierzeta: 'Zwierzęta',
  zabawki: 'Zabawki',
  inne: 'Inne',
}

/**
 * Keyword fallback, used when a reading carries no category of its own. Order
 * matters: the first rule that matches wins, so narrower aisles come first —
 * beer is alcohol before it is a drink, and ice cream is frozen before it is
 * dairy.
 */
const RULES: Array<[Category, RegExp]> = [
  ['alkohol', /\b(piw[oa]|piwa|lager|cydr|wino|wódka|whisky|rum|gin|nalewk|likier|prosecco|szampan|corona|heineken|żubr|harnaś|tyskie|lech|somersby|desperados|żatecký|zatecky)\b/i],
  ['mrozonki', /\b(mrożon\w*|lody|lód|paluszki rybne|pizza mrożona|frytki)\b/i],
  ['ryby', /\b(ryb\w*|łoso[sś]\w*|pstrąg\w*|krewetk\w*|śled[zź]\w*|tuńczyk\w*|dorsz\w*|mintaj\w*|owoce morza)\b/i],
  ['mieso-wedliny', /\b(mięso|mięsn\w*|kiełbas\w*|kabanos\w*|szynk\w*|karkówk\w*|schab\w*|boczek|parówk\w*|kurczak\w*|indyk\w*|wołowin\w*|wieprzow\w*|mielone|pierś)\b/i],
  ['nabial', /\b(mleko|masł\w*|ser\b|ser[ays]\w*|serek|jogurt\w*|śmietan\w*|twaróg|twarog\w*|kefir|maślank\w*|jaj[ak]\w*|gouda|mozzarella)\b/i],
  ['pieczywo', /\b(chleb\w*|bułk\w*|bagietk\w*|rogal\w*|pieczywo|grahamk\w*|tost\w*)\b/i],
  ['owoce-warzywa', /\b(owoc\w*|warzyw\w*|jabłk\w*|winogron\w*|nektarynk\w*|śliwk\w*|arbuz\w*|borówk\w*|grejpfrut\w*|cebul\w*|sałat\w*|awokado|pomidor\w*|ogórk\w*|ziemniak\w*|kapust\w*|papryk\w*|kurki|pieczark\w*|banan\w*)\b/i],
  ['napoje', /\b(napój|napoj\w*|woda|wody|sok\b|soki|cola|pepsi|fanta|sprite|kinley|tonic|energetyczn\w*|red bull|kaw[aeęy]\b|kawy|herbat\w*)\b/i],
  ['slodycze-przekaski', /\b(czekolad\w*|batonik\w*|cukierk\w*|ciastk\w*|wafl\w*|chips\w*|paluszki\b|orzeszk\w*|słodycz\w*|milka|delicje|prince)\b/i],
  ['chemia-higiena', /\b(papier toaletowy|ręcznik\w* (papierow|kuchenn)\w*|proszek|płyn do|mydł\w*|szampon\w*|pasta do zębów|chust\w*|pieluch\w*|detergent\w*|floralys)\b/i],
  ['dom-ogrod', /\b(mebl\w*|fotel\w*|leżak\w*|huśtawk\w*|grill\b|donic\w*|kwiat\w*|wrzos\w*|lawend\w*|fikus\w*|rower\w*|trampolin\w*|domek dla dzieci|garnk\w*|krzesł\w*|robot koszący)\b/i],
  // Pet food reads as meat or dairy on keywords alone, so it must be claimed first.
  ['zwierzeta', /\b(karm[ay]|karmę|przysmak dla|żwirek|dla ps[aó]w?|dla kot[aów]+|activ pet|dla zwierz\w*)\b/i],
  // August leaflets are half stationery; this was most of what landed in "inne".
  ['szkola-biuro', /\b(zeszyt\w*|długopis\w*|ołówk?[iu]?\w*|kredk\w*|piórnik\w*|zakreślacz\w*|korektor\w*|flamastr?\w*|marker\w*|temperówk\w*|gumka\b|nożyczk\w*|plecak\w*|linijk\w*|segregator\w*|teczk\w*|brystol\w*|blok (rysunkow|techniczn)\w*|karteczki|klej\b|kleje\b|farby plakatowe|piśmienni\w*|szkoln\w*)\b/i],
  ['odziez', /\b(bluz[aey]\w*|koszulk\w*|spodni\w*|buty|obuwi\w*|skarpet\w*|bielizn\w*|kurtk\w*|sukienk\w*|piżam\w*|dres\w*|legginsy|klapki|czapk\w*|esmara|livergy|pepperts)\b/i],
  ['zabawki', /\b(zabawk\w*|klock\w*|lalk\w*|puzzle|gra planszowa|pluszak\w*|maskotk\w*)\b/i],
  ['spozywcze', /\b(ketchup\w*|majonez\w*|musztard\w*|sos\w*|makaron\w*|ryż|mąk[aęi]|cukier|olej|ocet|przypraw\w*|konserw\w*|hummus\w*|oliwk\w*|antipasti|guacamole|kiszon\w*|vital fresh|d[zż]em\w*|miód|kasz[aey]|płatk[iu]|herbatnik\w*)\b/i],
]

/**
 * Categories a food shopper actually wants. Everything else in a leaflet —
 * garden furniture, washing powder, back-to-school stationery, pet food — is a
 * third of the promotions in August and drowns the groceries.
 *
 * 'inne' counts as non-food deliberately: it is where the classifier gives up,
 * and in practice holds stationery, clothing and pet food rather than groceries.
 * A food item landing there is hidden by this filter, which is the incentive to
 * keep the rules below honest.
 */
export const FOOD_CATEGORIES: readonly Category[] = [
  'owoce-warzywa', 'mieso-wedliny', 'ryby', 'nabial', 'pieczywo',
  'napoje', 'alkohol', 'slodycze-przekaski', 'mrozonki', 'spozywcze',
]

export function isFoodCategory(c: Category): boolean {
  return FOOD_CATEGORIES.includes(c)
}

export function classifyCategory(name: string): Category {
  for (const [category, pattern] of RULES) {
    if (pattern.test(name)) return category
  }
  return 'inne'
}
