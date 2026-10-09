/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

/** 预加载脚本暴露给外壳界面的接口。 */
interface Window {
  rujianShell: import('./app/shell/shell-channels').RujianShellApi;
}
