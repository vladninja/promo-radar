const CSS = `
:root { --fg:#1a1a1a; --muted:#6b6b6b; --line:#e3e3e3; --accent:#c8102e; }
* { box-sizing:border-box; }
body { margin:0; color:var(--fg); background:#fff;
  font:15px/1.5 system-ui,-apple-system,sans-serif; }
a { color:inherit; }
header.top { display:flex; gap:1rem; align-items:baseline;
  padding:1rem 1.5rem; border-bottom:1px solid var(--line); }
header.top strong { color:var(--accent); }
main { padding:1.5rem; max-width:1150px; }
h1 { font-size:1.4rem; margin:0 0 .25rem; }
table { width:100%; border-collapse:collapse; }
th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); }
th { font-weight:600; color:var(--muted); font-size:13px; }
.muted { color:var(--muted); }
.price { font-weight:700; white-space:nowrap; }
.badge { display:inline-block; padding:.1rem .4rem; border-radius:3px;
  font-size:12px; background:#f2f2f2; }
.badge.card { background:#fff3cd; }
.badge.review { background:#ffe0e0; }
.badge.best { background:#d7f5dd; }
.badge.cat { background:#e8eefc; color:#31456b; white-space:nowrap; }
form.filters { display:flex; gap:.75rem; flex-wrap:wrap; align-items:center;
  margin-bottom:1.25rem; }
input,select,button { padding:.35rem .5rem; font:inherit; }
.viewer { position:relative; display:inline-block; max-width:100%; }
.viewer img { max-width:100%; height:auto; display:block; }
.viewer .box { position:absolute; border:2px solid var(--accent);
  background:rgba(200,16,46,.08); }
`

export function Layout(props: { title: string; children: unknown }) {
  return (
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="top">
          <strong>Promo Radar</strong>
          <a href="/">Promocje</a>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
