// ------------------------------------------------------------------------
// 名称：text-generation-settings-store.ts
// 说明：文本生成设置存取的端口接口：设置页通过它读写设置。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：领域层不依赖 VS Code；扩展中由 VS Code 用户设置实现，测试中用内存实现。
// ------------------------------------------------------------------------

import { TextGenerationSettings, TextGenerationSettingsPatch } from '../rules/text-generation-settings';

/** 文本生成设置的存取。 */
export interface TextGenerationSettingsStore {
  /** 读取当前设置（已规范化）。 */
  read(): TextGenerationSettings;
  /** 写入修改的项，写入完成后下一次读取即为新值。 */
  write(patch: TextGenerationSettingsPatch): Promise<void>;
}
