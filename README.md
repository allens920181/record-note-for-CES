# record-note-for-CES

給神學院學生的課堂錄音筆記軟體。

**錄音 → 逐字稿 → 雙欄筆記 → 整學期知識庫**
資料存在自己的電腦，轉錄用自己的 API key，不經過第三方伺服器。
摘要與整理由你自己做——軟體只負責讓你找得到、跳得回去、寫得順。

## 現況：Phase 1 可用

規格見 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)。

**已完成**

- 學期 → 課程 → 週次三層結構，可新增與刪除
- 選一個本機資料夾存音檔（Chrome / Edge），沒有的話退回瀏覽器內建空間
- 上傳音檔 → 壓成 opus → 切片 → 逐段轉錄 → 拼回完整逐字稿
- 雙欄工作區：左逐字稿、右 Markdown 筆記
- **時間戳跳轉**：點逐字稿任一句、或點筆記裡的 `[[hh:mm:ss]]`，音檔跳到那一秒
- `Alt+T` 把目前播放時間插進筆記
- 逐字稿可就地修正錯字，筆記自動存檔
- 專有名詞表隨轉錄一起送出，改善神學術語的辨識

**還沒做**（Phase 2 起）

課表自動開檔、App 內直接錄音、PDF 與閱讀材料、作業規劃、跨週全文搜尋。

## 開始使用

```bash
npm install     # 會自動把 ffmpeg core 複製到 public/
npm run dev
```

首次開啟請到「設定」完成兩件事：

1. **選擇本機資料夾** — 音檔存這裡。一學期約需 4.5 GB，瀏覽器內建空間的配額通常不夠。
2. **填入轉錄 API key** — 預設走 Groq 的 `whisper-large-v3`。
   到 [console.groq.com](https://console.groq.com) 申請即可，免費層每日 8 小時音訊。

按「測試連線」確認金鑰可用，再回到週次頁面上傳錄音。

## 需要知道的事

- **瀏覽器**：本機資料夾用的是 File System Access API，只有 Chrome 與 Edge 支援。
- **首次轉錄會下載約 32 MB** 的 ffmpeg 音訊處理引擎，之後就不用再下載。
- **轉錄期間請保持分頁開著**。關掉的話任務會中斷，需要重新上傳。
- **切片邊界**：音訊每 10 分鐘切一段，跨越切點的字偶爾會被截斷。
  三小時的課大約十幾個切點，影響有限。
- **速率**：Groq 免費層每分鐘 20 次請求、每小時 2 小時音訊，
  所以一堂三小時的課約需 1.5 小時跑完。程式會自動排隊與重試。

## 技術選型

Vite + React + TypeScript · Dexie（IndexedDB）· File System Access API ·
ffmpeg.wasm（單執行緒，不需 COOP/COEP）· CodeMirror 6 · HashRouter

靜態站，可直接部署到 GitHub Pages。

## 腳本

| 指令 | 作用 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 型別檢查 + 打包到 `dist/` |
| `npm run typecheck` | 只做型別檢查 |
| `npm run vendor:ffmpeg` | 重新複製 ffmpeg core 到 `public/` |
