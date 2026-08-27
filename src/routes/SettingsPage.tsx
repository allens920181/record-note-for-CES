import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../db'
import type { AppSettings } from '../db'
import { DEFAULT_SETTINGS } from '../db/schema'
import {
  forgetRoot,
  pickLocalFolder,
  regrantPermission,
  rootName,
  rootStatus,
  supportsLocalFolder,
  useBrowserStorage,
} from '../storage/fsRoot'
import type { RootStatus } from '../storage/fsRoot'
import { testConnection } from '../stt/groq'
import { Breadcrumbs, TopBar } from '../components/Layout'

type Msg = { kind: 'ok' | 'err' | 'warn'; text: string } | null

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [status, setStatus] = useState<RootStatus>('none')
  const [folder, setFolder] = useState<string | null>(null)
  const [storageMsg, setStorageMsg] = useState<Msg>(null)
  const [sttMsg, setSttMsg] = useState<Msg>(null)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)

  async function refreshStorage() {
    setStatus(await rootStatus())
    setFolder(await rootName())
  }

  useEffect(() => {
    void getSettings().then(setSettings)
    void refreshStorage()
  }, [])

  function patch(next: Partial<AppSettings>) {
    setSettings((s) => (s ? { ...s, ...next } : s))
    setSaved(false)
  }

  async function persist() {
    if (!settings) return
    await saveSettings(settings)
    setSaved(true)
  }

  async function guard(run: () => Promise<void>, setMsg: (m: Msg) => void) {
    try {
      await run()
      setMsg(null)
    } catch (err) {
      // The picker throws AbortError when the user closes it — not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!settings) return <div className="page">載入中…</div>

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '設定' }]} />
      </TopBar>

      <main className="page">
        <div className="page-head">
          <div className="grow">
            <h1>設定</h1>
            <p>金鑰與檔案都只留在這台電腦上，不會傳給任何第三方伺服器。</p>
          </div>
        </div>

        {/* ── storage ─────────────────────────────────────────────── */}
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>儲存位置</h2>
          <p className="small muted" style={{ marginTop: '.35rem' }}>
            音訊會存進你指定的資料夾，資料庫只留索引與文字。一學期約需 4.5 GB，
            所以本機資料夾是必要的——瀏覽器內建空間的配額通常撐不住。
          </p>

          <div style={{ margin: '.9rem 0' }}>
            {status === 'ready' && (
              <div className="notice ok">
                目前存到：<strong>{folder}</strong>
              </div>
            )}
            {status === 'needs-permission' && (
              <div className="notice warn">
                先前選的資料夾（<strong>{folder}</strong>）需要重新授權。
                瀏覽器規定這一步必須由你按一下才能進行。
              </div>
            )}
            {status === 'none' && <div className="notice warn">還沒選擇儲存位置，轉錄無法開始。</div>}
            {status === 'unsupported' && (
              <div className="notice err">這個瀏覽器不支援已選的儲存方式。</div>
            )}
          </div>

          <div className="row" style={{ gap: '.6rem' }}>
            {supportsLocalFolder() ? (
              <button
                className="btn primary"
                style={{ flex: '0 0 auto' }}
                onClick={() => guard(async () => {
                  await pickLocalFolder()
                  await refreshStorage()
                }, setStorageMsg)}
              >
                {status === 'none' ? '選擇本機資料夾' : '換一個資料夾'}
              </button>
            ) : (
              <div className="notice warn" style={{ flex: '1 1 100%' }}>
                這個瀏覽器沒有本機資料夾 API（只有 Chrome 與 Edge 有）。
                你仍可用瀏覽器內建空間，但容量有限。
              </div>
            )}
            {status === 'needs-permission' && (
              <button
                className="btn"
                style={{ flex: '0 0 auto' }}
                onClick={() => guard(async () => {
                  const ok = await regrantPermission()
                  await refreshStorage()
                  if (!ok) throw new Error('沒有取得授權，請再試一次或重新選擇資料夾。')
                }, setStorageMsg)}
              >
                重新授權
              </button>
            )}
            <button
              className="btn"
              style={{ flex: '0 0 auto' }}
              onClick={() => guard(async () => {
                await useBrowserStorage()
                await refreshStorage()
              }, setStorageMsg)}
            >
              改用瀏覽器內建空間
            </button>
            {status !== 'none' && (
              <button
                className="btn ghost"
                style={{ flex: '0 0 auto' }}
                onClick={() => guard(async () => {
                  await forgetRoot()
                  await refreshStorage()
                }, setStorageMsg)}
              >
                清除設定
              </button>
            )}
          </div>
          {storageMsg && (
            <div className={`notice ${storageMsg.kind}`} style={{ marginTop: '.8rem' }}>
              {storageMsg.text}
            </div>
          )}
        </section>

        {/* ── transcription ───────────────────────────────────────── */}
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>語音轉錄</h2>
          <p className="small muted" style={{ marginTop: '.35rem' }}>
            預設走 Groq 的 Whisper。它用的是 OpenAI 相容端點，所以換成 OpenAI 只要改網址與金鑰。
            Groq 免費層每日 8 小時音訊，多數情況下不會產生費用。
          </p>

          <div className="row" style={{ marginTop: '.9rem' }}>
            <div className="field" style={{ flex: '2 1 18rem' }}>
              <label htmlFor="s-url">API 端點</label>
              <input
                id="s-url"
                type="text"
                value={settings.sttBaseUrl}
                onChange={(e) => patch({ sttBaseUrl: e.target.value })}
              />
              <div className="hint">
                Groq：<code>https://api.groq.com/openai/v1</code>／
                OpenAI：<code>https://api.openai.com/v1</code>
              </div>
            </div>
            <div className="field" style={{ flex: '1 1 12rem' }}>
              <label htmlFor="s-model">模型</label>
              <input
                id="s-model"
                type="text"
                value={settings.sttModel}
                onChange={(e) => patch({ sttModel: e.target.value })}
              />
              <div className="hint">
                建議 <code>whisper-large-v3</code>。turbo 便宜但中文與外語術語會退化。
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="s-key">API key</label>
            <input
              id="s-key"
              type="password"
              autoComplete="off"
              placeholder="gsk_…"
              value={settings.sttApiKey}
              onChange={(e) => patch({ sttApiKey: e.target.value })}
            />
            <div className="hint">存在這台電腦的瀏覽器資料庫裡，不會離開你的機器。</div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="s-lang">授課語言</label>
              <select
                id="s-lang"
                value={settings.language}
                onChange={(e) => patch({ language: e.target.value })}
              >
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="">自動偵測</option>
              </select>
              <div className="hint">指定語言比自動偵測穩，中英夾雜時尤其明顯。</div>
            </div>
            <div className="field">
              <label htmlFor="s-rate">音訊位元率</label>
              <select
                id="s-rate"
                value={settings.audioBitrateKbps}
                onChange={(e) => patch({ audioBitrateKbps: Number(e.target.value) })}
              >
                <option value={24}>24 kbps（最省空間）</option>
                <option value={32}>32 kbps（建議）</option>
                <option value={48}>48 kbps</option>
                <option value={64}>64 kbps（音質最好）</option>
              </select>
              <div className="hint">32 kbps 單聲道對語音已經足夠，一小時約 14 MB。</div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="s-gloss">全域專有名詞</label>
            <textarea
              id="s-gloss"
              rows={3}
              placeholder="巴特、士來馬赫、預定論、釋經學、logos、chesed"
              value={settings.globalGlossary.join('、')}
              onChange={(e) =>
                patch({
                  globalGlossary: e.target.value
                    .split(/[、,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <div className="hint">
              用頓號或換行分隔。這串會隨每次轉錄一起送出，讓模型知道該怎麼寫這些字。
            </div>
          </div>

          <div className="row" style={{ gap: '.6rem' }}>
            <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={persist}>
              {saved ? '已儲存' : '儲存設定'}
            </button>
            <button
              className="btn"
              style={{ flex: '0 0 auto' }}
              disabled={testing || !settings.sttApiKey}
              onClick={async () => {
                setTesting(true)
                setSttMsg(null)
                try {
                  await saveSettings(settings)
                  setSaved(true)
                  setSttMsg({
                    kind: 'ok',
                    text: await testConnection({
                      baseUrl: settings.sttBaseUrl,
                      apiKey: settings.sttApiKey,
                    }),
                  })
                } catch (err) {
                  setSttMsg({
                    kind: 'err',
                    text: err instanceof Error ? err.message : String(err),
                  })
                } finally {
                  setTesting(false)
                }
              }}
            >
              {testing ? '測試中…' : '測試連線'}
            </button>
            <button
              className="btn ghost"
              style={{ flex: '0 0 auto' }}
              onClick={() =>
                patch({
                  sttBaseUrl: DEFAULT_SETTINGS.sttBaseUrl,
                  sttModel: DEFAULT_SETTINGS.sttModel,
                })
              }
            >
              還原預設端點
            </button>
          </div>
          {sttMsg && (
            <div className={`notice ${sttMsg.kind}`} style={{ marginTop: '.8rem' }}>
              {sttMsg.text}
            </div>
          )}
        </section>
      </main>
    </>
  )
}
