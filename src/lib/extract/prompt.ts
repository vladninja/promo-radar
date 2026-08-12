export function buildPrompt(): string {
  return `You are reading one page of a Polish supermarket promotional leaflet (gazetka).

Return every promotional tile on the page. A tile is one product offer: a price block plus the product name near it.

Field rules:
- raw_name: the product description exactly as printed, including size text.
- brand: the manufacturer brand if identifiable (e.g. "Mleczna Dolina", "Morliny", "Coca-Cola"), otherwise null.
- price: the large promotional price exactly as printed, e.g. "7,99". Null if the tile has no single price (for example "1+1 GRATIS").
- price_before: the value labelled "Cena przed obniżką".
- price_regular: the value labelled "Cena poza promocją" or "Cena bez karty".
- discount_percent: the integer from a "NN% TANIEJ" badge.
- promo_kind: "multibuy" when the tile says "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK"; "bogo" for "1+1 GRATIS" or similar; "percent" when the offer is expressed only as a percentage; otherwise "price".
- min_qty: the n from "PRZY ZAKUPIE n" or "KAŻDA Z n SZTUK", otherwise null.
- unit_price_raw: the small per-unit price as printed, e.g. "0,80 zł/100 g" or "1,50 zł/rolka".
- requires_loyalty: true when the tile carries a loyalty badge such as "Z KARTĄ", "Z KARTĄ LUB APKĄ", "Moja Biedronka", "Lidl Plus".
- purchase_limit: text of any limit, e.g. "Limit dzienny 3 szt. na kartę".
- date_badge: the tile's own validity text if present, e.g. "OFERTA OD 12.08 DO 14.08". Null if the tile shows no dates.
- bbox: the tile's bounding box as fractions of page width and height, each between 0 and 1.

Page-level fields:
- page_date_badge: a date range printed as a page header, e.g. "ŚRODA – PIĄTEK 12.08-14.08". Null if absent.
- issue_text: any issue marking such as "NR 33/2026". Null if absent.

Read prices exactly as printed, with the comma. Do not convert, round or compute anything. Do not invent tiles for decorative images or for the shop's own logo.`
}
