function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

export const config = {
  databaseUrl: () => required('DATABASE_URL'),
  openaiApiKey: () => required('OPENAI_API_KEY'),
  visionModel: process.env.VISION_MODEL ?? 'gpt-5.6-luna',
  visionModelEscalation: process.env.VISION_MODEL_ESCALATION ?? 'gpt-5.6-terra',
  maxPagesPerRun: Number(process.env.MAX_PAGES_PER_RUN ?? 400),
  storageDir: process.env.STORAGE_DIR ?? './storage',
  sourceBaseUrl: 'https://www.gazetkipromocyjne.net',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
  shopAllowlist: ['biedronka', 'lidl', 'kaufland'] as const,
  concurrency: 4,
  staleHours: 36,
  /** USD per 1M tokens, from OpenAI docs 2026-08-12. */
  pricing: {
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  } as Record<string, { input: number; output: number }>,
}
