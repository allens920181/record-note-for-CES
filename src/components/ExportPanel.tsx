import { useState } from 'react'
import { pickExportFolder } from '../storage/fsRoot'
import { exportTermMarkdown } from '../export/markdown'
import { backupBlob, backupFileName, buildBackup, downloadBlob, restoreBackup } from '../export/backup'
import { TermPicker, useTermChoice } from './TermPicker'
import { useConfirm } from './ConfirmProvider'
import { Link } from 'react-router-dom'

type Msg = { kind: 'ok' | 'err'; text: string } | null

export function ExportPanel() {
  const ask = useConfirm()
  const { termId, setTermId, terms } = useTermChoice()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const activeTermId = termId ?? ''

  async function guard(label: string, run: () => Promise<string>) {
    setBusy(label)
    setMsg(null)
    try {
      setMsg({ kind: 'ok', text: await run() })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>匯出與備份</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        <strong>Markdown</strong> 會把一個學期寫成資料夾樹——指向你的 Obsidian vault，筆記就直接在那裡了。
        <br />
        <strong>備份</strong>是一個 JSON 檔，含結構、逐字稿與筆記。
        音檔本來就在你選的資料夾裡，那就是它自己的備份，不重複打包。
      </p>

      {terms && terms.length === 0 && (
        <div className="notice warn" style={{ marginBottom: '.9rem' }}>
          還沒有學期可以匯出。<Link to="/">先建立一個學期</Link>，裡面有課程與筆記之後再回來。
        </div>
      )}

      <div className="row" style={{ gap: '.6rem', alignItems: 'flex-end' }}>
        <TermPicker
          termId={activeTermId}
          terms={terms}
          onChange={setTermId}
          id="ex-term"
          label="要匯出的學期"
          hideWhenSingle={false}
        />
        <button
          className="btn primary"
          style={{ flex: '0 0 auto' }}
          disabled={!activeTermId || busy !== null}
          onClick={() =>
            guard('markdown', async () => {
              const root = await pickExportFolder()
              if (!root) throw new DOMException('已取消', 'AbortError')
              const { files } = await exportTermMarkdown(root, activeTermId, () => {})
              return `已寫入 ${files} 個 Markdown 檔。`
            })
          }
        >
          {busy === 'markdown' ? '匯出中…' : '匯出 Markdown 到資料夾'}
        </button>
      </div>

      <div className="row" style={{ gap: '.6rem', marginTop: '1rem' }}>
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          disabled={busy !== null}
          onClick={() =>
            guard('backup', async () => {
              const backup = await buildBackup()
              downloadBlob(backupBlob(backup), backupFileName())
              const rows = Object.values(backup.tables).reduce((s, t) => s + t.length, 0)
              return `已下載備份，共 ${rows} 筆資料。`
            })
          }
        >
          {busy === 'backup' ? '準備中…' : '下載備份檔'}
        </button>

        <label className="btn" style={{ flex: '0 0 auto' }}>
          {busy === 'restore' ? '還原中…' : '從備份還原'}
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void (async () => {
                const go = await ask({
                  title: '從備份還原？',
                  danger: true,
                  confirmLabel: '清空並還原',
                  body: (
                    <>
                      目前這台電腦上的所有內容會被<strong>清空</strong>，換成備份檔裡的：
                      <ul>
                        <li>學期、課程、週次、課表與作業時間</li>
                        <li>逐字稿、筆記、本週進度</li>
                        <li>作業、閱讀材料、專有名詞表（含全域詞彙）</li>
                      </ul>
                      音檔與 PDF 不在備份裡，會留在你選的資料夾。
                    </>
                  ),
                })
                if (!go) return
                await guard('restore', async () => {
                  const { restored, globalGlossary } = await restoreBackup(file)
                  const rows = Object.values(restored).reduce((s, n) => s + n, 0)
                  return `已還原 ${rows} 筆資料${globalGlossary > 0 ? `，以及 ${globalGlossary} 個全域詞彙` : ''}。`
                })
              })()
            }}
          />
        </label>
      </div>

      {msg && (
        <div className={`notice ${msg.kind}`} style={{ marginTop: '.9rem' }}>
          {msg.text}
        </div>
      )}
    </section>
  )
}
