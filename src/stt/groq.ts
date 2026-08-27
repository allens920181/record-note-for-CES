import type { TranscriptSegment } from '../db/schema'

export interface SttConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** ISO-639-1 code, or '' to let the model detect. */
  language: string
  /** Vocabulary hint — the glossary that keeps 加爾文 from becoming 加爾聞. */
  prompt: string
}

export class SttError extends Error {
  status: number
  retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.name = 'SttError'
    this.status = status
    this.retryable = retryable
  }
}

interface VerboseJson {
  text?: string
  segments?: Array<{ start: number; end: number; text: string }>
}

function explain(status: number, body: string): SttError {
  if (status === 401 || status === 403) {
    return new SttError('API key 無效或沒有權限，請到「設定」確認金鑰。', status, false)
  }
  if (status === 413) {
    return new SttError('這段音訊超過服務端的檔案大小上限，請把切片長度調短。', status, false)
  }
  if (status === 429) {
    return new SttError('已達速率或額度上限，稍後會自動重試。', status, true)
  }
  if (status >= 500) {
    return new SttError(`轉錄服務暫時無法回應（${status}），稍後會自動重試。`, status, true)
  }
  const trimmed = body.slice(0, 300)
  return new SttError(`轉錄失敗（${status}）：${trimmed || '沒有更多資訊'}`, status, false)
}

/** Sends one prepared chunk and returns its segments, timed from the chunk's own start. */
export async function transcribeChunk(
  blob: Blob,
  fileName: string,
  cfg: SttConfig,
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('model', cfg.model)
  form.append('response_format', 'verbose_json')
  if (cfg.language) form.append('language', cfg.language)
  if (cfg.prompt) form.append('prompt', cfg.prompt)

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    // A blocked CORS preflight lands here too, indistinguishable from offline.
    throw new SttError(
      `連不上轉錄服務：${err instanceof Error ? err.message : String(err)}。` +
        `若這是第一次使用，請先確認瀏覽器允許直接呼叫這個網域。`,
      0,
      true,
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const error = explain(res.status, body)
    const retryAfter = Number(res.headers.get('retry-after'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      ;(error as SttError & { retryAfterMs?: number }).retryAfterMs = retryAfter * 1000
    }
    throw error
  }

  const json = (await res.json()) as VerboseJson
  if (Array.isArray(json.segments) && json.segments.length > 0) {
    return json.segments.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: (s.text ?? '').trim(),
    }))
  }
  // Some providers omit segments; keep the text rather than losing the chunk.
  const text = (json.text ?? '').trim()
  return text ? [{ start: 0, end: 0, text }] : []
}

/** Cheap round-trip used by the settings page's "測試連線" button. */
export async function testConnection(cfg: Pick<SttConfig, 'baseUrl' | 'apiKey'>): Promise<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (!res.ok) throw explain(res.status, await res.text().catch(() => ''))
  const json = (await res.json()) as { data?: Array<{ id: string }> }
  const ids = (json.data ?? []).map((m) => m.id)
  const whisper = ids.filter((id) => /whisper|transcribe/i.test(id))
  return whisper.length > 0
    ? `連線成功，可用的轉錄模型：${whisper.join('、')}`
    : `連線成功，但這個帳號看不到轉錄模型（共 ${ids.length} 個模型）`
}
