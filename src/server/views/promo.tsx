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
  members: RelatedPromo[]
}) {
  const p = props.promo
  const size = p.sizeValue ? `${p.sizeValue} ${p.sizeUnit}` : null
  // Compare per unit when both sides state one, otherwise on the shelf price.
  // These are offers on the same product, so the sizes already agree — refusing
  // to compare for want of a unit price hides exactly what the page is for.
  // A price behind a points coupon is not one every shopper can pay, so it does
  // not get to win a comparison.
  const comparable = !p.requiresCoupon
  const byUnit =
    p.unitPriceGrosze !== null &&
    props.elsewhere.some((o) => o.unitPriceGrosze !== null && o.unitBasis === p.unitBasis)
  const mine = byUnit ? p.unitPriceGrosze : p.priceGrosze
  const rivals = props.elsewhere
    .map((o) => ({ o, value: byUnit ? o.unitPriceGrosze : o.priceGrosze }))
    .filter((r) => r.value !== null && (!byUnit || r.o.unitBasis === p.unitBasis))
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
  const cheapest = rivals[0]
  const cheapestElsewhere = cheapest?.o
  const beatsAll =
    comparable && mine !== null && cheapest !== undefined
      ? mine <= (cheapest.value ?? Infinity)
      : null
  const rivalLabel = cheapest
    ? byUnit
      ? formatUnitPrice(cheapest.value, cheapestElsewhere!.unitBasis)
      : formatZl(cheapest.value)
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

          <div class={p.isGroup ? 'pricebox group' : 'pricebox'}>
            <div>
              <span class="big">
                {p.isGroup && p.priceGrosze === null
                  ? formatPromo(p.promoKind, p.minQty, p.discountPercent)
                  : formatZl(p.priceGrosze)}
              </span>
              {p.requiresLoyalty ? <span class="badge card-only">z kartą</span> : null}
              {p.requiresCoupon ? (
                <span class="badge card-only">
                  kupon w aplikacji{p.couponPoints ? ` · ${p.couponPoints} pkt` : ''}
                </span>
              ) : null}
              {p.isGroup ? <span class="badge shelf">cała półka</span> : null}
              {p.discountPercent !== null && !p.isGroup
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
                  <strong>{rivalLabel}</strong>
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
              {p.pageNos.map((n, i) => (
                <>
                  {i > 0 ? ', ' : ''}
                  <a href={`/leaflets/${p.leafletId}?page=${n}`}>s. {n}</a>
                </>
              ))}
              {p.pageNos.length > 1 ? <span class="muted"> — ta sama oferta</span> : null}
            </dd>
          </dl>

          {p.needsReview ? (
            <p class="warn">Ta oferta wymaga sprawdzenia — dane mogą być niepełne.</p>
          ) : null}
        </div>
      </div>

      {p.isGroup ? (
        <p class="group-note">
          Oferta obejmuje wiele produktów, a gazetka nie wymienia ich przy niej.
          Poniżej produkty z tej samej gazetki, które prawdopodobnie są nią objęte.
        </p>
      ) : null}
      <Strip
        title={p.brand
          ? `Produkty marki ${p.brand} w tej gazetce`
          : `${CATEGORY_LABELS[p.category]} w tej gazetce`}
        note="prawdopodobnie objęte tą ofertą"
        items={props.members}
        primary
      />

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
