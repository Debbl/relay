import swc from '@rollup/plugin-swc'
import { defineConfig } from 'tsdown'
import Lingui from 'unplugin-lingui/rolldown'

export default defineConfig({
  sourcemap: true,
  dts: { sourcemap: true },
  plugins: [Lingui(), swc()],
})
