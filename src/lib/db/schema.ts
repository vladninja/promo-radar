import {
  boolean, index, integer, jsonb, pgEnum, pgTable, real, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

export const leafletStatus = pgEnum('leaflet_status', ['pending', 'done', 'partial', 'failed'])
export const extractStatus = pgEnum('extract_status', ['pending', 'done', 'failed'])
export const promoKind = pgEnum('promo_kind', ['price', 'percent', 'multibuy', 'bogo'])
export const dateSource = pgEnum('date_source', ['offer', 'page', 'leaflet'])
export const sizeUnit = pgEnum('size_unit', ['g', 'ml', 'pcs'])
export const unitBasis = pgEnum('unit_basis', ['kg', 'l', 'pcs'])
export const matchMethod = pgEnum('match_method', ['exact', 'trigram', 'new'])
export const category = pgEnum('category', [
  'owoce-warzywa', 'mieso-wedliny', 'ryby', 'nabial', 'pieczywo', 'napoje',
  'alkohol', 'slodycze-przekaski', 'mrozonki', 'spozywcze', 'chemia-higiena',
  'dom-ogrod', 'inne',
])

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const leaflets = pgTable('leaflets', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id),
  externalId: text('external_id').notNull(),
  sourceSlug: text('source_slug').notNull(),
  pdfUrl: text('pdf_url').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  fileHash: text('file_hash').notNull(),
  pageCount: integer('page_count').notNull(),
  status: leafletStatus('status').notNull().default('pending'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('leaflets_shop_external').on(t.shopId, t.externalId)])

export const leafletPages = pgTable('leaflet_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  leafletId: uuid('leaflet_id').notNull().references(() => leaflets.id),
  pageNo: integer('page_no').notNull(),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  status: extractStatus('status').notNull().default('pending'),
  rawJson: jsonb('raw_json'),
  error: text('error'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  splitRetry: boolean('split_retry').notNull().default(false),
}, (t) => [
  unique('pages_leaflet_page').on(t.leafletId, t.pageNo),
  index('pages_hash_idx').on(t.imageHash),
])

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalKey: text('canonical_key').notNull().unique(),
  displayName: text('display_name').notNull(),
  brand: text('brand'),
  sizeValue: integer('size_value'),
  sizeUnit: sizeUnit('size_unit'),
})

export const offers = pgTable('offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  leafletId: uuid('leaflet_id').notNull().references(() => leaflets.id),
  pageNo: integer('page_no').notNull(),
  rawName: text('raw_name').notNull(),
  brand: text('brand'),
  name: text('name').notNull(),
  sizeValue: integer('size_value'),
  sizeUnit: sizeUnit('size_unit'),
  priceGrosze: integer('price_grosze'),
  priceBefore: integer('price_before'),
  priceRegular: integer('price_regular'),
  discountPercent: integer('discount_percent'),
  promoKind: promoKind('promo_kind').notNull(),
  minQty: integer('min_qty'),
  unitPriceGrosze: integer('unit_price_grosze'),
  unitBasis: unitBasis('unit_basis'),
  unitPriceRaw: text('unit_price_raw'),
  requiresLoyalty: boolean('requires_loyalty').notNull().default(false),
  purchaseLimit: text('purchase_limit'),
  category: category('category').notNull().default('inne'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  dateSource: dateSource('date_source').notNull(),
  canonicalKey: text('canonical_key'),
  productId: uuid('product_id').references(() => products.id),
  matchMethod: matchMethod('match_method'),
  matchScore: real('match_score'),
  needsReview: boolean('needs_review').notNull().default(false),
  bbox: jsonb('bbox'),
}, (t) => [
  index('offers_product_idx').on(t.productId),
  index('offers_valid_idx').on(t.validFrom, t.validTo),
  index('offers_category_idx').on(t.category),
])

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  script: text('script').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  stats: jsonb('stats'),
  error: text('error'),
})
