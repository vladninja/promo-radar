import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { PromoFilters, PromoRow } from '@/lib/queries/promos'
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/normalize/category'

const SHOPS = [
  ['', 'Wszystkie sklepy'],
  ['biedronka', 'Biedronka'],
  ['lidl', 'Lidl'],
  ['kaufland', 'Kaufland'],
] as const

export function PromosView(props: { rows: PromoRow[]; filters: PromoFilters }) {
  const { rows, filters } = props
  const shops = new Set(rows.map((r) => r.shopSlug)).size
  const crossShop = rows.filter((r) => r.shopCount > 1).length

  return (
    <Layout title="Promocje — Promo Radar">
      <h1>Promocje</h1>
      <p class="sub">
        {rows.length} promocji w {shops} sklepach
        {crossShop > 0 ? ` · ${crossShop} dostępnych w kilku sklepach` : ''}
      </p>

      <form class="filters" method="get" action="/">
        <input type="search" name="q" placeholder="Szukaj…" value={filters.q ?? ''} />
        <select name="shop">
          {SHOPS.map(([value, label]) => (
            <option value={value} selected={(filters.shop ?? '') === value}>{label}</option>
          ))}
        </select>
        <select name="category">
          <option value="">Wszystkie kategorie</option>
          {CATEGORIES.map((c) => (
            <option value={c} selected={filters.category === c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <select name="sort">
          <option value="discount" selected={filters.sort !== 'unit'}>Największa zniżka</option>
          <option value="unit" selected={filters.sort === 'unit'}>Cena za jednostkę</option>
        </select>
        <label class="check">
          <input type="checkbox" name="cross" value="1" checked={filters.crossShopOnly} />
          W kilku sklepach
        </label>
        <label class="check">
          <input type="checkbox" name="review" value="1" checked={filters.needsReview} />
          Do sprawdzenia
        </label>
        <button type="submit">Filtruj</button>
      </form>

      {rows.length === 0 ? (
        <div class="card"><p class="empty">Brak promocji dla tych filtrów.</p></div>
      ) : (
        <div class="grid">
          {rows.map((r) => (
            <a class="promo" href={`/promos/${r.offerId}`}>
              <div class="thumb">
                <img src={`/api/crop/${r.offerId}`} alt="" loading="lazy" />
                {r.discountPercent !== null
                  ? <span class="disc">-{r.discountPercent}%</span>
                  : null}
              </div>
              <div class="body">
                <p class="pname">{r.rawName}</p>
                <p class="prices">
                  <span class="price">{formatZl(r.priceGrosze)}</span>
                  {r.unitPriceGrosze !== null
                    ? <span class="unit">{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</span>
                    : null}
                </p>
                <p class="tags">
                  <span class="badge shop">{r.shopSlug}</span>
                  <span class="badge cat">{CATEGORY_LABELS[r.category]}</span>
                  {r.requiresLoyalty ? <span class="badge card-only">z kartą</span> : null}
                  {r.shopCount > 1
                    ? <span class="badge best">w {r.shopCount} sklepach</span>
                    : null}
                  {r.needsReview ? <span class="badge review">do sprawdzenia</span> : null}
                </p>
                <p class="meta">
                  {formatPromo(r.promoKind, r.minQty, r.discountPercent)}
                  {' · '}
                  {formatRange(r.validFrom, r.validTo)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </Layout>
  )
}
