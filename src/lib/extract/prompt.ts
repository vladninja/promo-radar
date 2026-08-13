export function buildPrompt(): string {
  return `You are reading one page of a Polish supermarket promotional leaflet (gazetka).

Return every promotional tile on the page. A tile is one product offer: a price block plus the product name near it.

Keys are deliberately short. Emit exactly these per tile:
- n: the product description exactly as printed, including size text.
- br: the manufacturer brand if identifiable (e.g. "Mleczna Dolina", "Morliny", "Coca-Cola"), otherwise null.
- p: the large promotional price, copying ONLY the digits that are actually printed.
    Many Polish leaflet prices are whole zloty with no grosze at all: "299", "179", "2899".
    For those, return exactly "299", "179", "2899".
    NEVER add a comma, ",00", ",90" or any other grosze part that is not printed.
    Include a comma only when a comma, a decimal point, or a raised/superscript
    grosze part is genuinely visible, e.g. "7,99" or "79,90".
    Null if the tile has no single price (for example "1+1 GRATIS").
- pu: the unit printed immediately against the main price, exactly as shown: "/kg", "/l", "/szt.", "/100 g", "/rolka". Null when the price has no unit beside it. This is the exact figure; the smaller per-100 g line elsewhere on the tile is a rounded restatement of it.
- pb: the crossed-out previous price, or the value labelled "Cena przed obniżką". Same digit rules as p.
    This one is printed small and struck through with a diagonal line, which hides digits.
    If you cannot read every digit with confidence, return null. A missing previous price
    is harmless; a wrong one is not, and it cannot be detected later — a misread
    "5999" as "5899" still looks consistent with a "-50%" badge.
- pr: the value labelled "Cena poza promocją" or "Cena bez karty". Same digit rules as p.
- d: the integer from a "NN% TANIEJ" badge, otherwise null.
- k: "multibuy" when the tile says "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK"; "bogo" for "1+1 GRATIS" or similar; "percent" when the offer is expressed only as a percentage; otherwise "price".
- q: the n from "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK", otherwise null.
- u: a per-unit price only when a NUMBER and a unit are printed together, e.g. "0,80 zł/100 g" or "1,50 zł/rolka". A bare unit label printed beside the main price, such as "zł/szt." or "zł/zest.", is not a unit price — return null for those.
- l: true when the tile carries a loyalty badge such as "Z KARTĄ", "Z KARTĄ LUB APKĄ", "Moja Biedronka", "Lidl Plus".
- lim: the numeric part of any purchase limit, e.g. "3 szt./dzień" for "Limit dzienny 3 szt. na kartę Moja Biedronka". Keep it under 20 characters. Null when there is no limit.
- dt: ONLY the dates from the tile's validity text, in the form "12.08-14.08".
    If only a start is printed — "OD ŚRODY 12.08" — return "od 12.08"; it means
    from that day until the leaflet ends, and dropping it back-dates the offer.
    If the tile says the offer runs on one day only — "Tylko w piątek, 14.08" —
    return "tylko 14.08". Keep the word, it is what marks a single-day price. Write nothing else — no "OFERTA", no "Oferta ważna", no year, no "do wyczerpania zapasów". Copy both dates exactly; never repeat the start date as the end date. Null if the tile shows no dates.
- c: the aisle. Pick the narrowest that fits. Food for animals is "zwierzeta",
  never "spozywcze" — it sits in the grocery aisle but is not something a person
  eats. School and office supplies are "szkola-biuro", clothing "odziez", toys
  "zabawki", cleaning and toiletries "chemia-higiena", furniture and garden
  "dom-ogrod". Beer, wine and spirits are "alkohol", not "napoje". Ice cream and
  frozen goods are "mrozonki", not "nabial".
- b: the tile's bounding box as exactly four numbers [x, y, w, h], each a fraction of page width or height between 0 and 1.

Page-level keys:
- pd: a date range printed as a page header, in the same "12.08-14.08" form. Null if absent.
- iss: any issue marking such as "NR 33/2026". Null if absent.
- ad: true when the page advertises no priced products at all — a cover, a
  competition, a loyalty-collectible spread, a basket comparison. Say so plainly
  rather than inventing a tile; an empty page is a normal thing for a leaflet.
- t: the array of tiles.

Do not invent tiles for decorative images or for the shop's own logo.

A tile printing two prices for one product — a loyalty price beside a price
without the card ("z kartą 1,49" and "bez karty 1,99", "cena bez karty Lidl
Plus") — is ONE promotion, not two. Put the loyalty price in p, the other in pr,
and set l true. Never emit a second tile for the same product.

Only ever report prices belonging to THIS shop. Leaflets print competitor
comparisons: a Lidl page may show its own 8,99 beside Biedronka's 12,99 for the
same product, sometimes under another shop's logo. Emit one tile, with this
shop's price. Never emit the competitor's price, and never emit tiles for
basket-total comparisons ("koszyk 15 produktów", 113,05 vs 135,91) — those are
not products.

Advertising pages carry no offers. If a page has no priced product tiles at all,
return an empty tiles array rather than inventing one.`
}
