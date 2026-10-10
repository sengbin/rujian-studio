// ------------------------------------------------------------------------
// 名称：app-request.ts
// 说明：自定义协议请求的解析：把 rujian-app:// 地址解析为页面 HTML、允许访问的静态文件或“未找到”。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：不依赖 Electron，便于测试；静态文件只放行 PAGE_ROOT_PATHS 内的路径，拒绝 `..`、绝对路径与目录外路径。
// ------------------------------------------------------------------------

import { PAGE_ROOT_PATHS } from '../app/panels/page-resources';
import { APP_PROTOCOL } from '../app/shell/shell-channels';
import { resolveInsideRoot } from '../infra/storage/relative-path';

/** 地址的主机部分：页面 HTML。 */
const PAGE_HOST = 'page';

/** 地址的主机部分：静态资源。 */
const RESOURCE_HOST = 'res';

/** 解析结果。 */
export type AppRequestResult =
  | { readonly kind: 'html'; readonly html: string }
  | { readonly kind: 'file'; readonly filePath: string }
  | { readonly kind: 'notFound' };

/**
 * 解析一个自定义协议请求。
 * @param rawUrl 请求地址，形如 `rujian-app://page/<页面标识>` 或 `rujian-app://res/<相对资源根目录的路径>`。
 * @param resourceRoot 应用资源根目录的绝对路径。
 * @param getFrameHtml 按页面标识读取已登记页面的 HTML。
 */
export function resolveAppRequest(rawUrl: string, resourceRoot: string, getFrameHtml: (frameId: string) => string | undefined): AppRequestResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'notFound' };
  }
  if (url.protocol !== `${APP_PROTOCOL}:`) {
    return { kind: 'notFound' };
  }

  const segments = decodeSegments(url.pathname);
  if (segments === undefined || segments.length === 0) {
    return { kind: 'notFound' };
  }

  if (url.hostname === PAGE_HOST) {
    // 页面标识是单个路径段（标识内的特殊字符已被编码）。
    const html = segments.length === 1 ? getFrameHtml(segments[0]) : undefined;
    return html === undefined ? { kind: 'notFound' } : { kind: 'html', html };
  }

  if (url.hostname === RESOURCE_HOST) {
    const relativePath = segments.join('/');
    if (!PAGE_ROOT_PATHS.some((root) => relativePath.startsWith(`${root}/`))) {
      return { kind: 'notFound' };
    }
    try {
      return { kind: 'file', filePath: resolveInsideRoot(resourceRoot, relativePath) };
    } catch {
      return { kind: 'notFound' };
    }
  }
  return { kind: 'notFound' };
}

/** 把路径按 `/` 切段并逐段解码；含 `..`、`.`、空段或空字节等不安全内容时返回 undefined。 */
function decodeSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split('/').slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) {
      return undefined;
    }
    segments.push(segment);
  }
  return segments;
}
