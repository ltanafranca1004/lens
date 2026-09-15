import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
    },
  },
})
