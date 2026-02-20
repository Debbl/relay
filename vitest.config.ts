import swc from '@rollup/plugin-swc'
import Lingui from 'unplugin-lingui/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [Lingui(), swc()],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
