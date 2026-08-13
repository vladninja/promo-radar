-- Four categories carved out of "inne", which had grown to a tenth of all
-- promotions: August leaflets are full of back-to-school stationery, and pet
-- food otherwise classifies as meat on keywords alone.
--
-- Written by hand rather than generated: drizzle-kit rewrites an enum by
-- recreating the type, which is not something to do to a column while a scan is
-- inserting into it. ADD VALUE is safe and takes no heavy lock.
alter type category add value if not exists 'szkola-biuro';
alter type category add value if not exists 'odziez';
alter type category add value if not exists 'zwierzeta';
alter type category add value if not exists 'zabawki';
