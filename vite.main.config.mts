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
