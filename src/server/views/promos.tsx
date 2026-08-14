import { Layout } from '@/server/views/layout'
import { formatPromo, formatUnitPrice, formatZl, promoKindLabel } from '@/lib/format'
import { CrossShopIcon, LoyaltyIcon, ReviewIcon, ShopLogo } from '@/server/views/icons'
import type { PromoFilters, PromoPage } from '@/lib/queries/promos'
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/normalize/category'

const SHOPS = [
  ['', 'Wszystkie sklepy'],
  ['biedronka', 'Biedronka'],
  ['lidl', 'Lidl'],
  ['kaufland', 'Kaufland'],
] as const

const SHOP_NAMES: Record<string, string> = Object.fromEntries(
  SHOPS.filter(([slug]) => slug).map(([slug, label]) => [slug, label]),
)

export function PromosView(props: {
  result: PromoPage
  filters: PromoFilters
  query: Record<string, string>
}) {
  const { filters } = props
  const { rows, groups, total, groupTotal, page, pages } = props.result
  const shops = new Set(rows.map((r) => r.shopSlug)).size
  const crossShop = rows.filter((r) => r.shopCount > 1).length
  const linkTo = (n: number) => {
    const q = new URLSearchParams(props.query)
    q.set('page', String(n))
    return `/?${q}`
  }

  return (
    <Layout title="Promocje — Promo Radar">
      <h1>Promocje</h1>
      <p class="sub">
        {total} promocji w {shops} sklepach
        {groupTotal > 0 ? ` · ${groupTotal} ofert na całą półkę` : ''}
        {crossShop > 0 ? ` · ${crossShop} na tej stronie jest w kilku sklepach` : ''}
        {pages > 1 ? ` · strona ${page} z ${pages}` : ''}
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
          <input type="checkbox" name="food" value="1" checked={filters.foodOnly} />
          Tylko jedzenie
        </label>
        <label class="check">
          <input type="checkbox" name="cross" value="1" checked={filters.crossShopOnly} />
          W kilku sklepach
        </label>
        <label class="check">
          <input type="checkbox" name="shelf" value="1" checked={filters.groupsOnly} />
          Cała półka
        </label>
        <label class="check">
          <input type="checkbox" name="review" value="1" checked={filters.needsReview} />
          Do sprawdzenia
        </label>
        <button type="submit">Filtruj</button>
      </form>

      {groups.length > 0 ? (
        <section class="shelves">
          <h2>
            Oferty na całą półkę
            <span class="count">{groupTotal}</span>
            <span class="sub-inline">rabat na cały asortyment, nie na jeden produkt</span>
          </h2>
          <div class="shelf-grid">
            {groups.map((g) => (
              <a class="shelf-box" href={`/promos/${g.offerId}`}>
                <div class="shelf-img">
                  <img src={`/api/crop/${g.offerId}`} alt="" loading="lazy" />
                </div>
                <div class="shelf-body">
                  <p class="pname">{g.rawName}</p>
                  <p class="shelf-deal">
                    {formatPromo(g.promoKind, g.minQty, g.discountPercent)}
                  </p>
                </div>
                <span class="mark">
                  <ShopLogo slug={g.shopSlug} name={SHOP_NAMES[g.shopSlug]} />
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        groups.length > 0 ? null : (
          <div class="card"><p class="empty">Brak promocji dla tych filtrów.</p></div>
        )
      ) : (
        <div class="grid">
          {rows.map((r) => (
            <a class="promo" href={`/promos/${r.offerId}`}>
              <div class="thumb">
                <img src={`/api/crop/${r.offerId}`} alt="" loading="lazy" />
                {/* A multibuy's percentage describes one item of a bundle, so
                    printing "-100%" on the card promises something the offer
                    does not. The chip below names the mechanic and the detail
                    page states its terms. */}
                {r.discountPercent !== null && r.promoKind !== 'multibuy'
                  ? <span class="disc">-{r.discountPercent}%</span>
                  : null}
                <span class="mark"><ShopLogo slug={r.shopSlug} name={SHOP_NAMES[r.shopSlug]} /></span>
              </div>
              <div class="body">
                <p class="pname">{r.rawName}</p>
                <p class="prices">
                  <span class="price">{formatZl(r.priceGrosze)}</span>
                  {r.unitPriceGrosze !== null
                    ? <span class="unit">{formatUnitPrice(r.unitPriceGrosze, r.unitBasis)}</span>
                    : null}
                  <span class="icons">
                    {r.shopCount > 1
                      ? <CrossShopIcon title={`Ta sama rzecz w ${r.shopCount} sklepach`} />
                      : null}
                    {r.requiresLoyalty ? <LoyaltyIcon title="Cena z kartą sklepu" /> : null}
                    {r.needsReview ? <ReviewIcon title="Odczyt do sprawdzenia" /> : null}
                  </span>
                </p>
                <p class="tags">
                  {r.isGroup
                    ? <span class="badge shelf">Cała półka</span>
                    : <span class={`badge kind ${r.promoKind}`}>{promoKindLabel(r.promoKind)}</span>}
                  <span class="badge cat">{CATEGORY_LABELS[r.category]}</span>
                </p>
              </div>
            </a>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav class="pager pages">
          {page > 1 ? <a href={linkTo(page - 1)}>← poprzednia</a> : null}
          <span class="muted">strona {page} z {pages}</span>
          {page < pages ? <a href={linkTo(page + 1)}>następna →</a> : null}
        </nav>
      ) : null}
    </Layout>
  )
}
