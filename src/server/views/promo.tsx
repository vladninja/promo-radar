import { Layout } from '@/server/views/layout'
import { formatPromo, formatRange, formatUnitPrice, formatZl } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/normalize/category'
import type { PromoDetail, RelatedPromo } from '@/lib/queries/promo'

function Strip(props: {
  title: string
  note?: string
  items: RelatedPromo[]
  primary?: boolean
}) {
  if (props.items.length === 0) return null
  return (
    <section class={props.primary ? 'strip-wrap primary' : 'strip-wrap'}>
      <h2>
        {props.primary ? <span class="dot" /> : null}
        {props.title}
        <span class="count">{props.items.length}</span>
        {props.note ? <span class="sub-inline">{props.note}</span> : null}
      </h2>
      <div class="strip">
        {props.items.map((r) => (
          <a class="mini" href={`/promos/${r.offerId}`}>
            <div class="thumb sm">
              {r.hasImage
                ? <img src={`/api/crop/${r.offerId}`} alt="" loading="lazy" />
                : <span class="noimg">brak zdjęcia</span>}
            </div>
            <p class="pname">{r.rawName}</p>
            <p class="prices">
              <span class="price">{formatZl(r.priceGrosze)}</span>
              {r.unitPriceGrosze !== null
                ? <span class="unit">{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</span>
                : null}
            </p>
            <p class="tags">
              <span class="badge shop">{r.shopSlug}</span>
              {r.requiresLoyalty ? <span class="badge card-only">z kartą</span> : null}
            </p>
          </a>
        ))}
      </div>
    </section>
  )
}

export function PromoView(props: {
  promo: PromoDetail
  elsewhere: RelatedPromo[]
  similar: RelatedPromo[]
}) {
  const p = props.promo
  const size = p.sizeValue ? `${p.sizeValue} ${p.sizeUnit}` : null
  const cheapestElsewhere = props.elsewhere
    .filter((o) => o.unitPriceGrosze !== null && o.unitBasis === p.unitBasis)
    .sort((a, b) => (a.unitPriceGrosze ?? 0) - (b.unitPriceGrosze ?? 0))[0]
  const beatsAll =
    p.unitPriceGrosze !== null && cheapestElsewhere?.unitPriceGrosze !== undefined
      ? p.unitPriceGrosze <= (cheapestElsewhere.unitPriceGrosze ?? Infinity)
      : null

  return (
    <Layout title={`${p.rawName} — Promo Radar`}>
      <p class="crumbs">
        <a href="/">Promocje</a>
        {' / '}
        <a href={`/?category=${p.category}`}>{CATEGORY_LABELS[p.category]}</a>
      </p>

      <div class="detail">
        <div class="detail-img">
          {p.bbox
            ? <img src={`/api/crop/${p.offerId}`} alt={p.rawName} />
            : <span class="noimg">brak zdjęcia</span>}
        </div>

        <div class="detail-body">
          <h1>{p.rawName}</h1>
          <p class="sub">
            {[p.brand, size, CATEGORY_LABELS[p.category]].filter(Boolean).join(' · ')}
          </p>

          <div class="pricebox">
            <div>
              <span class="big">{formatZl(p.priceGrosze)}</span>
              {p.requiresLoyalty ? <span class="badge card-only">z kartą</span> : null}
              {p.discountPercent !== null
                ? <span class="badge best">-{p.discountPercent}%</span>
                : null}
            </div>
            {p.unitPriceGrosze !== null ? (
              <p class="unit-big">{formatUnitPrice(p.unitPriceGrosze, p.unitBasis)}</p>
            ) : null}
            {beatsAll === true ? (
              <p class="verdict good">✓ Najtańsza z porównywanych ofert</p>
            ) : beatsAll === false && cheapestElsewhere ? (
              <a class="verdict bad" href={`/promos/${cheapestElsewhere.offerId}`}>
                <span>
                  Taniej w <strong>{cheapestElsewhere.shopSlug}</strong>:{' '}
                  <strong>
                    {formatUnitPrice(cheapestElsewhere.unitPriceGrosze, cheapestElsewhere.unitBasis)}
                  </strong>
                </span>
                <span class="go">Zobacz →</span>
              </a>
            ) : null}
          </div>

          <dl class="facts">
            <dt>Sklep</dt>
            <dd><a class="badge shop" href={`/?shop=${p.shopSlug}`}>{p.shopSlug}</a></dd>
            <dt>Rodzaj</dt>
            <dd>{formatPromo(p.promoKind, p.minQty, p.discountPercent)}</dd>
            <dt>Termin</dt>
            <dd>{formatRange(p.validFrom, p.validTo)}</dd>
            {p.priceBefore !== null ? <><dt>Przed obniżką</dt><dd>{formatZl(p.priceBefore)}</dd></> : null}
            {p.priceRegular !== null ? <><dt>Poza promocją</dt><dd>{formatZl(p.priceRegular)}</dd></> : null}
            {p.purchaseLimit ? <><dt>Limit</dt><dd>{p.purchaseLimit}</dd></> : null}
            <dt>Źródło</dt>
            <dd>
              <a href={`/leaflets/${p.leafletId}?page=${p.pageNo}`}>
                gazetka, s. {p.pageNo}
              </a>
            </dd>
          </dl>

          {p.needsReview ? (
            <p class="warn">Ta oferta wymaga sprawdzenia — dane mogą być niepełne.</p>
          ) : null}
        </div>
      </div>

      <Strip
        title="Ta sama rzecz w innych sklepach"
        note="porównanie cen za jednostkę"
        items={props.elsewhere}
        primary
      />
      <Strip title={`Podobne: ${CATEGORY_LABELS[p.category]}`} items={props.similar} />
    </Layout>
  )
}
