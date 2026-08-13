/**
 * Design tokens in the shadcn idiom — neutral zinc palette, one radius scale,
 * muted foregrounds, card surfaces — but as plain CSS. Light only, by choice. The screens are
 * server-rendered and read-only, so none of the React or Radix machinery that
 * ships with those components would earn its place here.
 */
const CSS = `
:root {
  --bg: #fafafa;
  --card: #ffffff;
  --fg: #18181b;
  --muted-fg: #71717a;
  --border: #e4e4e7;
  --accent: #c8102e;
  --accent-soft: #fef2f3;
  --radius: 0.5rem;
  --ring: #a1a1aa;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: -0.005em;
}
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }

header.top {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 1.25rem;
  padding: 0.75rem 1.5rem; background: color-mix(in srgb, var(--card) 85%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
}
header.top .brand { font-weight: 650; letter-spacing: -0.02em; }
header.top .brand span { color: var(--accent); }
header.top nav { display: flex; gap: 1rem; color: var(--muted-fg); font-size: 13px; }

main { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
h1 { font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 .25rem; }
.sub { color: var(--muted-fg); font-size: 13px; margin: 0 0 1.25rem; }
.muted { color: var(--muted-fg); }

.card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
}
.card + .card { margin-top: 1rem; }

form.filters {
  display: flex; flex-wrap: wrap; gap: .5rem; align-items: center;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: .75rem; margin-bottom: 1rem;
}
input[type="search"], select {
  height: 2.25rem; padding: 0 .625rem; font: inherit; color: inherit;
  background: var(--card); border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px); min-width: 9rem;
}
input[type="search"] { flex: 1 1 14rem; }
input:focus-visible, select:focus-visible, button:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 1px;
}
label.check {
  display: inline-flex; align-items: center; gap: .4rem; height: 2.25rem;
  padding: 0 .625rem; border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px); font-size: 13px; cursor: pointer;
  background: var(--card);
}
button {
  height: 2.25rem; padding: 0 .875rem; font: inherit; font-weight: 550;
  color: var(--card); background: var(--fg); border: 0;
  border-radius: calc(var(--radius) - 2px); cursor: pointer;
}
button:hover { opacity: .9; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .04em; color: var(--muted-fg);
  padding: .625rem .75rem; border-bottom: 1px solid var(--border);
  background: var(--card);
}
tbody td { padding: .625rem .75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: color-mix(in srgb, var(--fg) 3%, transparent); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.price { font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; }
.name { font-weight: 500; }

.badge {
  display: inline-block; padding: .0625rem .4375rem; border-radius: 9999px;
  font-size: 11px; font-weight: 550; line-height: 1.45;
  border: 1px solid var(--border); color: var(--muted-fg); white-space: nowrap;
}
.badge.cat { background: color-mix(in srgb, var(--fg) 4%, transparent); }
.badge.card-only { background: #fef9c3; border-color: #fde68a; color: #854d0e; }
.badge.review { background: var(--accent-soft); border-color: #fecdd3; color: #9f1239; }
.badge.best { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
.badge.shop { text-transform: capitalize; }

.empty { padding: 3rem 1rem; text-align: center; color: var(--muted-fg); }

.viewer { position: relative; display: inline-block; max-width: 100%; }
.viewer img { max-width: 100%; height: auto; display: block; border-radius: var(--radius); }
.viewer .box {
  position: absolute; border: 2px solid var(--accent); border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.pager.pages { justify-content: center; margin-top: 1.25rem; }
.pager { display: flex; gap: .75rem; align-items: center; margin: 0 0 1rem; font-size: 13px; }


/* Promotion cards */
.grid {
  display: grid; gap: .75rem;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
}
.promo {
  display: flex; flex-direction: column; background: var(--card);
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
  transition: box-shadow .12s ease, transform .12s ease;
}
.promo:hover {
  text-decoration: none; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.07);
  transform: translateY(-1px);
}
.thumb {
  position: relative; aspect-ratio: 4 / 3; background: #f4f4f5;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.thumb img { width: 100%; height: 100%; object-fit: contain; }
.thumb.sm { aspect-ratio: 1 / 1; border-radius: calc(var(--radius) - 2px); }
.noimg { color: var(--muted-fg); font-size: 11px; }
.disc {
  position: absolute; top: .5rem; left: .5rem; background: var(--accent);
  color: #fff; font-size: 11px; font-weight: 650; padding: .125rem .375rem;
  border-radius: 9999px;
}
.body { padding: .625rem .75rem .75rem; display: flex; flex-direction: column; gap: .375rem; }
.pname {
  margin: 0; font-size: 13px; font-weight: 550; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.prices { margin: 0; display: flex; align-items: baseline; gap: .5rem; }
.prices .price { font-size: 15px; }
.prices .unit { font-size: 12px; color: var(--muted-fg); font-variant-numeric: tabular-nums; }
.tags { margin: 0; display: flex; gap: .25rem; flex-wrap: wrap; align-items: center; }
.meta { margin: 0; font-size: 11.5px; color: var(--muted-fg); }

/* The shop, worn on the thumbnail rather than spelled out in the tags. */
.mark {
  position: absolute; left: .5rem; bottom: .5rem; line-height: 0;
  border-radius: 9999px; background: var(--card); padding: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,.22);
}
.disc + .mark, .thumb .disc { z-index: 1; }

/* One chip per mechanic, coloured so the grid can be read at a glance. */
.badge.kind { font-weight: 550; }
.badge.kind.price { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.badge.kind.percent { background: #f5f3ff; border-color: #ddd6fe; color: #6d28d9; }
.badge.kind.multibuy { background: #ecfeff; border-color: #a5f3fc; color: #0e7490; }
.badge.kind.bogo { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
/* An offer over a whole shelf: not a product, so not one of the mechanics. */
.badge.shelf { background: #fff7ed; border-color: #fed7aa; color: #c2410c; font-weight: 550; }
.pricebox.group .big { font-size: 1.35rem; }
.group-note {
  margin: 0 0 1rem; padding: .75rem 1rem; font-size: 13px; color: var(--muted-fg);
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: var(--radius);
}

/* Icons stand in for the labels they replace; each carries its own <title>.
   They ride on the price line: in the chip row they wrapped alone onto a
   second line and read as an afterthought. */
.icons { display: inline-flex; gap: .3125rem; margin-left: auto; align-items: center; align-self: center; }
.icon { display: block; }
.icon.cross { color: #15803d; }
.icon.loyalty { color: #a16207; }
.icon.coupon { color: #b45309; }
.icon.review { color: #be123c; }

/* Promotion detail */
.crumbs { font-size: 12px; color: var(--muted-fg); margin: 0 0 .75rem; }
.detail {
  display: grid; gap: 1.25rem; grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.5rem;
}
.detail-img {
  background: #f4f4f5; border-radius: var(--radius); overflow: hidden;
  display: flex; align-items: center; justify-content: center; min-height: 200px;
}
.detail-img img { width: 100%; height: auto; display: block; }
.detail-body h1 { margin-bottom: .25rem; }
.pricebox {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: .75rem; margin: 0 0 1rem; display: flex; flex-direction: column; gap: .25rem;
}
.pricebox .big {
  font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; margin-right: .5rem;
}
.unit-big { margin: 0; color: var(--muted-fg); font-variant-numeric: tabular-nums; }
.verdict {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  margin: .5rem 0 0; padding: .5rem .75rem; font-size: 13px; font-weight: 600;
  border-radius: calc(var(--radius) - 2px); border: 1px solid transparent;
}
.verdict.good { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
.verdict.bad { color: #fff; background: var(--accent); border-color: #a20d25; }
a.verdict.bad:hover { text-decoration: none; background: #a20d25; }
.verdict .go { white-space: nowrap; opacity: .95; font-weight: 650; }
.facts {
  display: grid; grid-template-columns: auto 1fr; gap: .375rem 1rem;
  margin: 0; font-size: 13px;
}
.facts dt { color: var(--muted-fg); }
.facts dd { margin: 0; }
.warn {
  margin: 1rem 0 0; padding: .5rem .75rem; font-size: 13px;
  background: var(--accent-soft); border: 1px solid #fecdd3; border-radius: var(--radius);
  color: #9f1239;
}

/* Sideways browsing */
.strip-wrap { margin-bottom: 1.75rem; }
.strip-wrap h2 {
  display: flex; align-items: center; gap: .5rem;
  font-size: 1rem; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 .625rem;
}
.strip-wrap .count {
  font-size: 11px; font-weight: 650; color: var(--muted-fg);
  border: 1px solid var(--border); border-radius: 9999px; padding: 0 .4rem;
}
/* The cross-shop strip is the reason the app exists: give it a panel of its own
   so it cannot be mistaken for the "you might also like" row below it. */
.strip-wrap.primary {
  background: var(--card); border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius); padding: 1rem; margin-bottom: 1.5rem;
}
.strip-wrap.primary h2 { font-size: 1.1rem; }
.strip-wrap.primary .count {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.strip-wrap.primary .dot {
  width: .5rem; height: .5rem; border-radius: 9999px; background: var(--accent);
}
.strip-wrap.primary .mini { border-color: var(--border); background: var(--bg); }
.sub-inline { font-weight: 400; font-size: 12px; color: var(--muted-fg); margin-left: .5rem; }
.strip {
  display: grid; grid-auto-flow: column; grid-auto-columns: 168px; gap: .625rem;
  overflow-x: auto; padding-bottom: .5rem; scroll-snap-type: x proximity;
}
.strip::-webkit-scrollbar { height: 8px; }
.strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; }
.mini {
  scroll-snap-align: start; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: .5rem; display: flex;
  flex-direction: column; gap: .375rem;
}
.mini:hover { text-decoration: none; border-color: var(--ring); }
.mini .pname { font-size: 12px; }
.mini .prices .price { font-size: 13px; }

@media (max-width: 720px) {
  .detail { grid-template-columns: 1fr; }
}

/* Narrow screens: each row becomes its own card, labelled from the header. */
@media (max-width: 820px) {
  main { padding: 1rem; }
  table, thead, tbody, tr, td { display: block; width: 100%; }
  thead { display: none; }
  tbody tr {
    border-bottom: 1px solid var(--border); padding: .75rem;
  }
  tbody td {
    display: flex; justify-content: space-between; gap: 1rem;
    border: 0; padding: .1875rem 0; text-align: right;
  }
  tbody td::before {
    content: attr(data-label); color: var(--muted-fg); font-size: 12px;
    text-align: left; flex: 0 0 auto;
  }
  tbody td.name-cell { display: block; text-align: left; font-weight: 550; padding-bottom: .5rem; }
  tbody td.name-cell::before { content: none; }
}
`

export function Layout(props: { title: string; children: unknown }) {
  return (
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="top">
          <a class="brand" href="/">Promo<span>Radar</span></a>
          <nav>
            <a href="/">Promocje</a>
            <a href="/?cross=1">W kilku sklepach</a>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
