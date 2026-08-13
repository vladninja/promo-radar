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
.pager { display: flex; gap: .75rem; align-items: center; margin: 0 0 1rem; font-size: 13px; }

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
            <a href="/?sort=unit">Najtaniej za jednostkę</a>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
