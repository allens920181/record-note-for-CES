/**
 * 繁體, whatever the model felt like writing.
 *
 * Whisper writes Chinese in 简体. Not as a setting — `language: 'zh'` says which
 * language, never which script — but as a habit picked up from training data
 * that is overwhelmingly mainland. A lecture given in Taipei comes back reading
 * 这个学期我们要读加尔文的《基督教要义》: every word heard correctly, and none of
 * it in the script the reader writes their own notes in.
 *
 * Two things push back on that, and both are needed.
 *
 * The request's `prompt` ends with a sentence written in 繁體 — see ./prompt.ts,
 * which owns that side of it. Whisper reads the field as the text immediately
 * preceding the audio and continues in its style, and that is the only lever
 * the API offers over the script.
 *
 * Then everything that comes back is converted anyway, because a hint is not a
 * guarantee: the model drifts, and each chunk is a fresh request that can drift
 * differently from the one before it. A transcript that is 繁體 for forty
 * minutes and 简体 after the break is worse than one that is wrong throughout,
 * because the wrong one at least searches consistently.
 *
 * The conversion is OpenCC's s2tw — phrase-aware, which is the part that
 * matters: 头发 is 頭髮 and 发展 is 發展, and no table of single characters can
 * tell those two 发 apart.
 */

/** CJK ideographs, extension A, and the compatibility block. */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** Whether converting this text could change anything at all. */
export function hasHan(text: string): boolean {
  return HAN.test(text)
}

type Convert = (text: string) => string

/**
 * About a megabyte of dictionaries, so it is fetched the first time something
 * needs converting rather than shipped in the bundle every page load waits on.
 * A failed fetch is deliberately not remembered — the reader may simply have
 * been offline for the moment it was asked for.
 */
let loading: Promise<Convert> | null = null

function converter(): Promise<Convert> {
  if (!loading) {
    loading = import('opencc-js/cn2t')
      .then((OpenCC) => OpenCC.Converter({ from: 'cn', to: 'tw' }))
      .catch((err) => {
        loading = null
        throw err
      })
  }
  return loading
}

/**
 * Rewrites each string in 繁體, leaving the ones with no Han characters exactly
 * as they were — an English lecture never pays for the dictionary.
 *
 * Safe to run over text that is already 繁體: the 简体 half of the mapping finds
 * nothing to match. What it does still do is settle on Taiwan's preferred
 * variants — 裏面 becomes 裡面, 台灣 becomes 臺灣 — which is a normalisation
 * rather than a rewrite, and one every other line has already had.
 */
export async function toTraditional(texts: string[]): Promise<string[]> {
  if (!texts.some(hasHan)) return texts
  const convert = await converter()
  return texts.map((t) => (hasHan(t) ? convert(t) : t))
}
