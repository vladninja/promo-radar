-- Products carry two names now: the readable one, shown on the product page,
-- and the stemmed one the matcher compares. They were the same column, so the
-- trigram ran on inflected Polish and "Ogórek gruntowy" scored 0.52 against
-- "Ogórki gruntowe" — under the attach threshold, and the same cucumber became
-- two products.
--
-- Backfilled from display_name so nothing is null in the meantime; `rescore`
-- rebuilds the table properly and is what actually re-keys the archive.
alter table products add column if not exists match_name text;
update products set match_name = display_name where match_name is null;
alter table products alter column match_name set not null;

create index if not exists products_match_name_trgm
  on products using gin (match_name gin_trgm_ops);
