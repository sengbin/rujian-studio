// ------------------------------------------------------------------------
// 名称：backup-pages.ts
// 说明：数据备份页的入口：打开或聚焦数据备份页。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：请求处理在 backup-handlers.ts；页面操作后自行重新读取概览，不需要订阅数据变化。
// ------------------------------------------------------------------------

import { MessageRouter } from '../messaging/message-router';
import { BACKUP_PAGE_RESOURCES } from '../panels/page-resources';
import { PanelTabs } from '../panels/panel-tabs';
import { BackupService } from '../services/backup-service';
import { registerBackupHandlers } from './backup-handlers';

/** 数据备份页的标签键，同一键只打开一个标签。 */
const BACKUP_PANEL_KEY = 'data-backup';
/** 数据备份页的标题。 */
const BACKUP_TITLE = '数据备份';
/** 数据备份页的描述，显示在标题后面。 */
const BACKUP_DESCRIPTION = '把数据库备份到文件，或从备份文件恢复；备份时资产的图片、音频会复制到备份文件旁的 .files 文件夹，两者需放在一起；不含已下载的结果视频文件。';

/** 数据备份页的入口。 */
export class BackupPages {
  constructor(
    private readonly service: BackupService,
    private readonly panels: PanelTabs
  ) {}

  /** 打开数据备份页；已打开时聚焦。 */
  show(): void {
    if (this.panels.reveal(BACKUP_PANEL_KEY)) {
      return;
    }
    const router = new MessageRouter();
    registerBackupHandlers(router, this.service);
    this.panels.open({
      key: BACKUP_PANEL_KEY,
      title: BACKUP_TITLE,
      description: BACKUP_DESCRIPTION,
      styles: BACKUP_PAGE_RESOURCES.styles,
      scripts: BACKUP_PAGE_RESOURCES.scripts,
      router
    });
  }
}
