import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Self-host the ONNX Runtime Web wasm (the TTS worker sets env.wasmPaths = '/ort/') instead of
    // fetching it from the jsDelivr CDN. Copied from node_modules at build/dev time so the .wasm and
    // its .mjs glue stay version-matched to the pinned onnxruntime-web. Both files are required.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.{wasm,mjs}',
          dest: 'ort',
          // stripBase:true → files land flat at /ort/<file>, not /ort/node_modules/onnxruntime-web/...
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // The ML packages ship wasm/ONNX assets and `new URL(...wasm)` references that esbuild's dev
  // pre-bundling shouldn't touch; they load lazily (natural-voice opt-in) so excluding them is free.
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'kokoro-js', 'onnxruntime-web'],
  },
  // The TTS worker (tts.worker.ts) imports kokoro-js as an ES module; the default 'iife' worker
  // format can't do ESM imports. esnext lets top-level constructs through the build.
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
    },
  },
})
