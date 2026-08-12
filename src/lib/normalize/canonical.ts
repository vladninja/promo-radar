import type { Size } from '@/lib/normalize/size'
import { STOPWORDS } from '@/lib/normalize/stopwords'

const SIZE_TOKENS = /\b\d+(?:[,.]\d+)?\s*(kg|g|l|ml|szt\.?|rolki|rolka|opakowa[nń]|sztuk)\b/gi
const MULTIPACK_TOKENS = /\b\d+\s*[x×]\s*\d+(?:[,.]\d+)?\s*(kg|g|l|ml)\b/gi

export function coreName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(MULTIPACK_TOKENS, ' ').replace(SIZE_TOKENS, ' ')
  for (const w of STOPWORDS) s = s.split(w).join(' ')
  s = s.replace(/[.,;:!()\[\]"'“”]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function canonicalKey(input: {
  brand: string | null
  name: string
  size: Size | null
}): string {
  const brand = (input.brand ?? '').toLowerCase().trim()
  const size = input.size ? `${input.size.value}${input.size.unit}` : ''
  return `${brand}|${coreName(input.name)}|${size}`
}
