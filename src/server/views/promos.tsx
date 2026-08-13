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
        <div class="card">
          <p class="empty">Brak promocji dla tych filtrów.</p>
        </div>
      ) : (
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Promocja</th>
                <th>Kategoria</th>
                <th>Sklep</th>
                <th class="num">Cena</th>
                <th class="num">Za jednostkę</th>
                <th>Rodzaj</th>
                <th>Termin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  <td class="name-cell">
                    {r.productId
                      ? <a class="name" href={`/products/${r.productId}`}>{r.rawName}</a>
                      : <span class="name">{r.rawName}</span>}
                    {r.shopCount > 1
                      ? <> <span class="badge best">w {r.shopCount} sklepach</span></>
                      : null}
                    {r.needsReview
                      ? <> <span class="badge review">do sprawdzenia</span></>
                      : null}
                  </td>
                  <td data-label="Kategoria">
                    <a class="badge cat" href={`/?category=${r.category}`}>
                      {CATEGORY_LABELS[r.category]}
                    </a>
                  </td>
                  <td data-label="Sklep">
                    <a class="badge shop" href={`/?shop=${r.shopSlug}`}>{r.shopSlug}</a>
                  </td>
                  <td class="num price" data-label="Cena">
                    {formatZl(r.priceGrosze)}
                    {r.requiresLoyalty
                      ? <> <span class="badge card-only">z kartą</span></>
                      : null}
                  </td>
                  <td class="num" data-label="Za jednostkę">
                    {formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}
                  </td>
                  <td data-label="Rodzaj">
                    {formatPromo(r.promoKind, r.minQty, r.discountPercent)}
                  </td>
                  <td data-label="Termin" class="muted">
                    {formatRange(r.validFrom, r.validTo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
