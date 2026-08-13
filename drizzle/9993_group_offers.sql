-- Some tiles do not advertise a product. "WSZYSTKIE PRODUKTY FINISH — drugi 70%
-- taniej" is an offer over a whole shelf, and the things it covers are printed
-- elsewhere in the same leaflet. Treated as a product it is a card with no
-- price, no unit price and nothing to compare against another shop; treated as
-- what it is, it is a heading for the offers underneath it.
alter table offers add column if not exists is_group boolean not null default false;

-- Backfill from the wording that names one: "wszystkie ...". The model marks the
-- rest from the page itself on the next scan, which catches the ones the words
-- alone miss — "Antyperspiranty w spray'u Dove, 200 ml" is a shelf too.
update offers set is_group = true where raw_name ~* '^\s*wszystk';

create index if not exists offers_is_group_idx on offers (is_group);
