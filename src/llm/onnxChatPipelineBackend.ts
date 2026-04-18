import type { Message } from '@huggingface/transformers'
import type { ModelId } from './models'
import type { GenerateOptions, ModelBackend, ProgressInfo } from './types'

type ChatMessage = { role: string; content: unknown }

type TextGenPipeline = {
  tokenizer: unknown
  (messages: Message[], kwargs?: Record<string, unknown>): Promise<unknown>
  dispose(): Promise<void>
}

function extractAssistantFromPipelineResult(result: unknown): string {
  if (!Array.isArray(result) || result.length === 0) return ''
  const first = result[0] as { generated_text?: unknown }
  if (!first || typeof first !== 'object' || !('generated_text' in first)) return ''
  const gen = first.generated_text
  if (typeof gen === 'string') return gen
  if (!Array.isArray(gen)) return ''
  const last = gen[gen.length - 1] as ChatMessage
  if (last?.role === 'assistant' && typeof last.content === 'string') return last.content
  return ''
}

/** Shared `pipeline('text-generation', …)` path for ONNX instruct models (Phi, Llama, etc.). */
export class OnnxChatPipelineBackend implements ModelBackend {
  readonly modelId: ModelId
  private readonly repoId: string
  private readonly dtype: 'q4f16' | 'q4'
  private readonly displayName: string
  private pipe: TextGenPipeline | null = null

  constructor(modelId: ModelId, repoId: string, dtype: 'q4f16' | 'q4', displayName: string) {
    this.modelId = modelId
    this.repoId = repoId
    this.dtype = dtype
    this.displayName = displayName
  }

  async load(onProgress?: (info: ProgressInfo) => void): Promise<void> {
    if (this.pipe) return
    const { pipeline } = await import('@huggingface/transformers')
    this.pipe = (await pipeline('text-generation', this.repoId, {
      device: 'webgpu',
      dtype: this.dtype,
      progress_callback: onProgress,
    })) as TextGenPipeline
  }

  async dispose(): Promise<void> {
    const p = this.pipe
    this.pipe = null
    if (p) await p.dispose()
  }

  async generate(messages: Message[], options: GenerateOptions = {}): Promise<string> {
    if (!this.pipe) {
      throw new Error(`${this.displayName} model not loaded.`)
    }
    const max_new_tokens = options.maxNewTokens ?? 768

    if (options.onStreamChunk) {
      const { TextStreamer } = await import('@huggingface/transformers')
      let accumulated = ''
      const streamer = new TextStreamer(this.pipe.tokenizer as never, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk: string) => {
          accumulated += chunk
          options.onStreamChunk!(chunk)
        },
      })
      await this.pipe(messages, { max_new_tokens, do_sample: false, repetition_penalty: 1.1, streamer })
      return accumulated
    }

    const raw = await this.pipe(messages, { max_new_tokens, do_sample: false, repetition_penalty: 1.1 })
    return extractAssistantFromPipelineResult(raw)
  }
}
