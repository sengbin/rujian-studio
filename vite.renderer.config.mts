// ------------------------------------------------------------------------
// 名称：vite.renderer.config.mts
// 说明：外壳界面（渲染进程）的 Vite 构建配置：开发模式下给内容安全策略追加热更新所需的放行项。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：正式包使用 index.html 里严格的策略；开发服务器需要 ws 连接和内联样式（Vite 把样式注入为 style 标签）。
// ------------------------------------------------------------------------

import { defineConfig } from 'vite';

/** 开发模式追加的放行项：热更新的 WebSocket 连接。 */
const DEV_CONNECT_SOURCE = 'ws://localhost:*';

/** 开发模式追加的放行项：Vite 注入的内联样式。 */
const DEV_STYLE_SOURCE = "'unsafe-inline'";

export default defineConfig({
  plugins: [
    {
      name: 'rujian-dev-csp',
      apply: 'serve',
      transformIndexHtml(html: string): string {
        return html
          .replace("style-src 'self'", `style-src 'self' ${DEV_STYLE_SOURCE}`)
          .replace(
            "connect-src 'self'",
            `connect-src 'self' ${DEV_CONNECT_SOURCE}`,
          );
      },
    },
  ],
});
