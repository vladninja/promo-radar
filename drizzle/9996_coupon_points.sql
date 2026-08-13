-- Some prices are not paid in money. Kaufland prints a coin badge, "AKTYWUJ
-- KUPON W APLIKACJI" and a points cost such as "-1000" beside a price; Lidl does
-- the same with Lidl Plus coupons. Such a price is unavailable to a shopper who
-- has no points, so it cannot be compared against a shelf price.
--
-- Inferring this from the price alone does not work: a coupon price can be 5,99
-- as easily as 0,01, and a low price is only a symptom. Record the marker.
--
-- ADD COLUMN of a nullable column takes no table rewrite, so this is safe while
-- a scan is inserting.
alter table offers add column if not exists requires_coupon boolean not null default false;
alter table offers add column if not exists coupon_points integer;
