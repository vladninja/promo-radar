import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import type { ProductDetail } from '@/lib/queries/product'

export function ProductView(props: { product: ProductDetail }) {
  const p = props.product
  const size = p.sizeValue ? `${p.sizeValue} ${p.sizeUnit}` : 'na wagę / bez rozmiaru'
  const shops = new Set(p.offers.map((o) => o.shopSlug)).size

  return (
    <Layout title={`${p.displayName} — Promo Radar`}>
      <h1>{p.displayName}</h1>
      <p class="sub">
        {p.brand ?? 'bez marki'} · {size} · {p.offers.length} promocji
        {shops > 1 ? ` w ${shops} sklepach` : ''}
      </p>

      {p.offers.length === 0 ? (
        <div class="card"><p class="empty">Brak aktualnych promocji.</p></div>
      ) : (
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Sklep</th>
                <th class="num">Cena</th>
                <th class="num">Za jednostkę</th>
                <th class="num">Przed obniżką</th>
                <th class="num">Poza promocją</th>
                <th>Rodzaj</th>
                <th>Termin</th>
                <th>Limit</th>
                <th>Źródło</th>
              </tr>
            </thead>
            <tbody>
              {p.offers.map((o) => (
                <tr>
                  <td class="name-cell">
                    <a class="badge shop" href={`/?shop=${o.shopSlug}`}>{o.shopSlug}</a>
                  </td>
                  <td class="num price" data-label="Cena">
                    {formatZl(o.priceGrosze)}
                    {o.requiresLoyalty
                      ? <> <span class="badge card-only">z kartą</span></>
                      : null}
                  </td>
                  <td class="num" data-label="Za jednostkę">
                    {formatUnitPrice(o.unitPriceGrosze, o.unitBasis)}
                    {o.isCheapest ? <> <span class="badge best">najtaniej</span></> : null}
                  </td>
                  <td class="num muted" data-label="Przed obniżką">{formatZl(o.priceBefore)}</td>
                  <td class="num muted" data-label="Poza promocją">{formatZl(o.priceRegular)}</td>
                  <td data-label="Rodzaj">
                    {formatPromo(o.promoKind, o.minQty, o.discountPercent)}
                  </td>
                  <td data-label="Termin" class="muted">
                    {formatRange(o.validFrom, o.validTo)}
                  </td>
                  <td data-label="Limit" class="muted">{o.purchaseLimit ?? '—'}</td>
                  <td data-label="Źródło">
                    {o.pageNos.map((n, i) => (
                      <>
                        {i > 0 ? ', ' : ''}
                        <a href={`/leaflets/${o.leafletId}?page=${n}`}>s. {n}</a>
                      </>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p class="sub" style="margin-top:1rem">
        Ceny „z kartą” wymagają karty lojalnościowej sklepu. „Najtaniej” liczone
        jest według ceny za jednostkę, tylko wśród ofert w tej samej mierze.
      </p>
    </Layout>
  )
}
