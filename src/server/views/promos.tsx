import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { PromoFilters, PromoRow } from '@/lib/queries/promos'

const SHOPS = [
  ['', 'Wszystkie sklepy'],
  ['biedronka', 'Biedronka'],
  ['lidl', 'Lidl'],
  ['kaufland', 'Kaufland'],
] as const

export function PromosView(props: { rows: PromoRow[]; filters: PromoFilters }) {
  const { rows, filters } = props
  return (
    <Layout title="Promocje — Promo Radar">
      <form class="filters" method="get" action="/">
        <input type="search" name="q" placeholder="Szukaj produktu" value={filters.q ?? ''} />
        <select name="shop">
          {SHOPS.map(([value, label]) => (
            <option value={value} selected={(filters.shop ?? '') === value}>{label}</option>
          ))}
        </select>
        <select name="sort">
          <option value="discount" selected={filters.sort !== 'unit'}>Największa zniżka</option>
          <option value="unit" selected={filters.sort === 'unit'}>Najniższa cena jednostkowa</option>
        </select>
        <label>
          <input type="checkbox" name="cross" value="1" checked={filters.crossShopOnly} />
          {' '}Tylko w kilku sklepach
        </label>
        <label>
          <input type="checkbox" name="review" value="1" checked={filters.needsReview} />
          {' '}Do sprawdzenia
        </label>
        <button type="submit">Filtruj</button>
      </form>

      <p class="muted">{rows.length} promocji</p>
      <table>
        <thead>
          <tr>
            <th>Produkt</th><th>Sklep</th><th>Cena</th><th>Za jednostkę</th>
            <th>Promocja</th><th>Termin</th><th>Sklepy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>
                {r.productId
                  ? <a href={`/products/${r.productId}`}>{r.rawName}</a>
                  : r.rawName}
                {r.needsReview ? <> <span class="badge review">do sprawdzenia</span></> : null}
              </td>
              <td>{r.shopSlug}</td>
              <td class="price">
                {formatZl(r.priceGrosze)}
                {r.requiresLoyalty ? <> <span class="badge card">z kartą</span></> : null}
              </td>
              <td>{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</td>
              <td>{formatPromo(r.promoKind, r.minQty, r.discountPercent)}</td>
              <td>{formatRange(r.validFrom, r.validTo)}</td>
              <td>{r.shopCount > 1 ? `${r.shopCount} sklepy` : '1'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  )
}
