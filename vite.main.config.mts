// ------------------------------------------------------------------------
// 名称：vite.main.config.mts
// 说明：主进程的 Vite 构建配置。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：node:sqlite 是 Node 内置模块，不打入主进程包。
// ------------------------------------------------------------------------

import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node:sqlite 是 Node 内置模块，不能被打进主进程包。
      external: ['node:sqlite'],
    },
  },
});
