import { rm } from 'node:fs/promises'
import path from 'node:path'

const ffmpegWasmPath = path.resolve('dist', 'ffmpeg', 'ffmpeg-core.wasm')

await rm(ffmpegWasmPath, { force: true })
console.log(`Removed oversized Cloudflare asset: ${ffmpegWasmPath}`)