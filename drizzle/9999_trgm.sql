create extension if not exists pg_trgm;
create index if not exists products_name_trgm
  on products using gin (display_name gin_trgm_ops);
