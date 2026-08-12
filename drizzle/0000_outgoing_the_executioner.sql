CREATE TYPE "public"."date_source" AS ENUM('offer', 'page', 'leaflet');--> statement-breakpoint
CREATE TYPE "public"."extract_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."leaflet_status" AS ENUM('pending', 'done', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('exact', 'trigram', 'new');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('price', 'percent', 'multibuy', 'bogo');--> statement-breakpoint
CREATE TYPE "public"."size_unit" AS ENUM('g', 'ml', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."unit_basis" AS ENUM('kg', 'l', 'pcs');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "leaflet_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leaflet_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"image_path" text NOT NULL,
	"image_hash" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"status" "extract_status" DEFAULT 'pending' NOT NULL,
	"raw_json" jsonb,
	"error" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"split_retry" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pages_leaflet_page" UNIQUE("leaflet_id","page_no")
);
--> statement-breakpoint
CREATE TABLE "leaflets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_slug" text NOT NULL,
	"pdf_url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"file_hash" text NOT NULL,
	"page_count" integer NOT NULL,
	"status" "leaflet_status" DEFAULT 'pending' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaflets_shop_external" UNIQUE("shop_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leaflet_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"raw_name" text NOT NULL,
	"brand" text,
	"name" text NOT NULL,
	"size_value" integer,
	"size_unit" "size_unit",
	"price_grosze" integer,
	"price_before" integer,
	"price_regular" integer,
	"discount_percent" integer,
	"promo_kind" "promo_kind" NOT NULL,
	"min_qty" integer,
	"unit_price_grosze" integer,
	"unit_basis" "unit_basis",
	"unit_price_raw" text,
	"requires_loyalty" boolean DEFAULT false NOT NULL,
	"purchase_limit" text,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"date_source" date_source NOT NULL,
	"canonical_key" text,
	"product_id" uuid,
	"match_method" "match_method",
	"match_score" real,
	"needs_review" boolean DEFAULT false NOT NULL,
	"bbox" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_key" text NOT NULL,
	"display_name" text NOT NULL,
	"brand" text,
	"size_value" integer,
	"size_unit" "size_unit",
	CONSTRAINT "products_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source_slug" text PRIMARY KEY NOT NULL,
	"last_seen_date" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaflet_pages" ADD CONSTRAINT "leaflet_pages_leaflet_id_leaflets_id_fk" FOREIGN KEY ("leaflet_id") REFERENCES "public"."leaflets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaflets" ADD CONSTRAINT "leaflets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_leaflet_id_leaflets_id_fk" FOREIGN KEY ("leaflet_id") REFERENCES "public"."leaflets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_hash_idx" ON "leaflet_pages" USING btree ("image_hash");--> statement-breakpoint
CREATE INDEX "offers_product_idx" ON "offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offers_valid_idx" ON "offers" USING btree ("valid_from","valid_to");