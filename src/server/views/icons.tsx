/**
 * Inline SVG marks. Everything the page needs travels with the HTML: no icon
 * font, no sprite request, no client JS — the same reason the rest of the UI is
 * server-rendered.
 *
 * Each icon carries a <title>, which is what a screen reader announces and what
 * a mouse hover shows, so dropping the printed labels from the cards costs no
 * meaning.
 */

interface IconProps { title: string }

/**
 * Two shopping bags: the same thing on sale in more than one shop.
 *
 * An earlier draft used overlapping price tags, which at 18px collapsed into
 * something that read as a fast-forward arrow.
 */
export function CrossShopIcon({ title }: IconProps) {
  return (
    <svg class="icon cross" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" role="img">
      <title>{title}</title>
      <path d="M3.25 9h7.5v11h-7.5z" />
      <path d="M5.5 9V7.25a1.5 1.5 0 0 1 3 0V9" />
      <path d="M13.25 9h7.5v11h-7.5z" />
      <path d="M15.5 9V7.25a1.5 1.5 0 0 1 3 0V9" />
    </svg>
  )
}

/** A loyalty card. */
export function LoyaltyIcon({ title }: IconProps) {
  return (
    <svg class="icon loyalty" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" role="img">
      <title>{title}</title>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6 14.5h4" />
    </svg>
  )
}

/** A coin: this price is paid in points, not only money. */
export function CouponIcon({ title }: IconProps) {
  return (
    <svg class="icon coupon" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" role="img">
      <title>{title}</title>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2A3.4 3.4 0 0 0 12 8.2c-1.9 0-3.4 1.7-3.4 3.8s1.5 3.8 3.4 3.8c1 0 1.9-.4 2.5-1" />
    </svg>
  )
}

/** A reading this shaky is worth a second look. */
export function ReviewIcon({ title }: IconProps) {
  return (
    <svg class="icon review" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" role="img">
      <title>{title}</title>
      <path d="M12 3.5 21 19H3l9-15.5Z" />
      <path d="M12 10v4M12 16.5v.5" />
    </svg>
  )
}

/**
 * A shop's mark: its colour and its initial, not its logo. Reproducing the real
 * trademarks would mean shipping their artwork, and colour plus letter is enough
 * to tell three shops apart at thumbnail size.
 */
const SHOP_MARKS: Record<string, { bg: string; fg: string; letter: string }> = {
  biedronka: { bg: '#e30613', fg: '#ffffff', letter: 'B' },
  lidl: { bg: '#0050aa', fg: '#fff100', letter: 'L' },
  kaufland: { bg: '#e10915', fg: '#ffffff', letter: 'K' },
}

export function ShopLogo({ slug, name }: { slug: string; name?: string }) {
  const mark = SHOP_MARKS[slug] ?? {
    bg: '#52525b', fg: '#ffffff', letter: (slug[0] ?? '?').toUpperCase(),
  }
  const label = name ?? slug
  return (
    <svg class="logo" viewBox="0 0 32 32" width="28" height="28" role="img">
      <title>{label}</title>
      <circle cx="16" cy="16" r="16" fill={mark.bg} />
      <text x="16" y="16" fill={mark.fg} font-size="17" font-weight="700"
        text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif">{mark.letter}</text>
    </svg>
  )
}
