-- What the model decided about a pair of products.
--
-- Keyed on the two canonical keys, not on product ids: `rescore` deletes and
-- rebuilds the products table, and a cache keyed on ids would be thrown away
-- every time the matching rules changed — which is exactly when it is most
-- expensive to have thrown away. Keyed on the names, re-applying the whole
-- archive's verdicts after a rescore costs nothing and asks the model nothing.
create table if not exists match_verdicts (
  pair_key text primary key,
  a_name text not null,
  b_name text not null,
  same boolean not null,
  reason text,
  model text not null,
  decided_at timestamptz not null default now()
);
