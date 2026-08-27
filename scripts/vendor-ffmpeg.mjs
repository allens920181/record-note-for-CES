// Copies the single-threaded ffmpeg core out of node_modules and into public/,
// so the app serves it from its own origin instead of a CDN.
//
// Single-threaded on purpose: the multi-threaded core needs SharedArrayBuffer,
// which needs COOP/COEP headers, which GitHub Pages cannot set.
//
// The ESM build on purpose too: @ffmpeg/ffmpeg starts its worker with
// { type: 'module' }, where importScripts always throws. The worker falls back
// to `await import(coreURL)` and reads `.default` — which only the ESM build has.
// Handing it the UMD build fails at load with ERROR_IMPORT_FAILURE.
import { mkdir, copyFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/@ffmpeg/core/dist/esm')
const to = join(root, 'public/ffmpeg')

await mkdir(to, { recursive: true })
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  try {
    await access(join(from, f))
  } catch {
    console.error(`[vendor-ffmpeg] missing ${join(from, f)} — run npm install first`)
    process.exit(1)
  }
  await copyFile(join(from, f), join(to, f))
}
console.log('[vendor-ffmpeg] ffmpeg core copied to public/ffmpeg')
