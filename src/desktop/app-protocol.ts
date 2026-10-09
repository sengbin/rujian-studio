// ------------------------------------------------------------------------
// 名称：app-protocol.ts
// 说明：注册并处理自定义协议 rujian-app://：为页面 iframe 提供页面 HTML 和静态资源。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：registerAppProtocolScheme 必须在 app ready 之前调用；地址解析与路径边界校验见 app-request.ts。
// ------------------------------------------------------------------------

import { net, protocol } from 'electron';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ShellBridge } from '../app/shell/shell-bridge';
import { APP_PROTOCOL } from '../app/shell/shell-channels';
import { resolveAppRequest } from '../app/shell/app-request';

/** 声明自定义协议为标准、安全协议，使页面可以用它加载脚本、样式与发起 fetch；必须在 app ready 之前调用。 */
export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/**
 * 处理自定义协议请求；在 app ready 之后调用。
 * @param bridge 外壳桥，提供已登记页面的 HTML。
 * @param resourceRoot 应用资源根目录的绝对路径。
 */
export function handleAppProtocol(bridge: ShellBridge, resourceRoot: string): void {
  protocol.handle(APP_PROTOCOL, (request) => {
    const result = resolveAppRequest(request.url, resourceRoot, (frameId) => bridge.getFrameHtml(frameId));
    if (result.kind === 'html') {
      return new Response(result.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (result.kind === 'file' && isFile(result.filePath)) {
      return net.fetch(pathToFileURL(result.filePath).toString());
    }
    return new Response('未找到', { status: 404 });
  });
}

/** 判断路径是否为存在的文件。 */
function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
