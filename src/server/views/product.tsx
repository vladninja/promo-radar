import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { ProductDetail } from '@/lib/queries/product'

export function ProductView(props: { product: ProductDetail }) {
  const p = props.product
  const size = p.sizeValue ? `${p.sizeValue} ${p.sizeUnit}` : 'na wagę / bez rozmiaru'
  return (
    <Layout title={`${p.displayName} — Promo Radar`}>
      <h1>{p.displayName}</h1>
      <p class="muted">
        {p.brand ?? 'bez marki'} · {size} · {p.offers.length} ofert
      </p>
      <table>
        <thead>
          <tr>
            <th>Sklep</th><th>Cena</th><th>Za jednostkę</th><th>Przed obniżką</th>
            <th>Poza promocją</th><th>Promocja</th><th>Termin</th><th>Limit</th><th>Źródło</th>
          </tr>
        </thead>
        <tbody>
          {p.offers.map((o) => (
            <tr>
              <td>{o.shopSlug}</td>
              <td class="price">
                {formatZl(o.priceGrosze)}
                {o.requiresLoyalty ? <> <span class="badge card">z kartą</span></> : null}
              </td>
              <td>
                {formatUnitPrice(o.unitPriceGrosze, o.unitBasis)}
                {o.isCheapest ? <> <span class="badge best">najtaniej</span></> : null}
              </td>
              <td class="muted">{formatZl(o.priceBefore)}</td>
              <td class="muted">{formatZl(o.priceRegular)}</td>
              <td>{formatPromo(o.promoKind, o.minQty, o.discountPercent)}</td>
              <td>{formatRange(o.validFrom, o.validTo)}</td>
              <td class="muted">{o.purchaseLimit ?? '—'}</td>
              <td><a href={`/leaflets/${o.leafletId}?page=${o.pageNo}`}>s. {o.pageNo}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  )
}
