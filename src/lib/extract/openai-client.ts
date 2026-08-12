import { readFile } from 'node:fs/promises'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { config } from '@/lib/config'
import { buildPrompt } from '@/lib/extract/prompt'
import { PageResultSchema } from '@/lib/extract/schema'
import type { VisionClient } from '@/lib/extract/vision'

export function createOpenAiVisionClient(): VisionClient {
  const client = new OpenAI({ apiKey: config.openaiApiKey() })
  const prompt = buildPrompt()

  return {
    async parsePage(imagePath, model) {
      const b64 = (await readFile(imagePath)).toString('base64')
      const res = await client.responses.parse({
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
          ],
        }],
        text: { format: zodTextFormat(PageResultSchema, 'page') },
      })
      if (!res.output_parsed) throw new Error('vision returned no parsed output')
      return {
        result: res.output_parsed,
        tokensIn: res.usage?.input_tokens ?? 0,
        tokensOut: res.usage?.output_tokens ?? 0,
      }
    },
  }
}
