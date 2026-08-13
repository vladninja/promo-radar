import { Layout } from '@/server/views/layout'
import { formatZl } from '@/lib/format'
import type { LeafletPageView } from '@/lib/queries/leaflet'

export function LeafletView(props: { view: LeafletPageView }) {
  const v = props.view
  const prev = v.pageNo > 1 ? v.pageNo - 1 : null
  const next = v.pageNo < v.pageCount ? v.pageNo + 1 : null

  return (
    <Layout title={`${v.shopSlug} s.${v.pageNo} — Promo Radar`}>
      <h1>
        <a class="badge shop" href={`/?shop=${v.shopSlug}`}>{v.shopSlug}</a>
        {' '}strona {v.pageNo} z {v.pageCount}
      </h1>
      <p class="sub">
        {v.boxes.length} {v.boxes.length === 1 ? 'oferta' : 'ofert'} na tej stronie —
        ramki pokazują, co zostało odczytane.
      </p>

      <p class="pager">
        {prev ? <a href={`/leaflets/${v.leafletId}?page=${prev}`}>← poprzednia</a> : null}
        {next ? <a href={`/leaflets/${v.leafletId}?page=${next}`}>następna →</a> : null}
      </p>

      <div class="viewer">
        <img src={v.imageUrl} alt={`strona ${v.pageNo}`} />
        {v.boxes.map((b) => (
          <span
            class="box"
            title={`${b.rawName} — ${formatZl(b.priceGrosze)}`}
            style={`left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`}
          />
        ))}
      </div>
    </Layout>
  )
}
