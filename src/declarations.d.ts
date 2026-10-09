/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// ------------------------------------------------------------------------
// 名称：declarations.d.ts
// 说明：全局类型声明：Vite 构建注入的全局变量、CSS 模块导入，以及预加载脚本挂在 window 上的外壳接口。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：三斜线指令必须留在文件最前。
// ------------------------------------------------------------------------

declare module '*.css';

/** 预加载脚本暴露给外壳界面的接口。 */
interface Window {
  rujianShell: import('./app/shell/shell-channels').RujianShellApi;
}
