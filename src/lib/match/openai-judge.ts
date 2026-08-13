import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { config } from '@/lib/config'
import {
  JUDGE_PROMPT, VerdictBatchSchema, buildBatchInput, type JudgeClient,
} from '@/lib/match/judge'

export function createOpenAiJudgeClient(): JudgeClient {
  const client = new OpenAI({ apiKey: config.openaiApiKey() })

  return {
    async judge(pairs, model) {
      const res = await client.responses.parse({
        model,
        input: [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: buildBatchInput(pairs) },
        ],
        text: { format: zodTextFormat(VerdictBatchSchema, 'verdicts') },
      })
      if (!res.output_parsed) throw new Error('judge returned no parsed output')
      return {
        verdicts: res.output_parsed.v,
        tokensIn: res.usage?.input_tokens ?? 0,
        tokensOut: res.usage?.output_tokens ?? 0,
      }
    },
  }
}
