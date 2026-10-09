// ------------------------------------------------------------------------
// 名称：json-text-generation-settings.ts
// 说明：文本生成设置的桌面实现：读写数据目录下的 JSON 设置文件，含全局默认文本模型、小说分段方式与每段字数上限。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：每次读取都取文件最新值，修改后下一次生成立即生效；键名沿用 VS Code 版的设置键（text.defaultModel、novel.splitMode、novel.maxSegmentChars）。
// ------------------------------------------------------------------------

import { NovelSplitSettings } from '../../domain/rules/novel-splitter';
import { TextGenerationSettingsStore } from '../../domain/ports/text-generation-settings-store';
import {
  TextGenerationSettings,
  TextGenerationSettingsPatch,
  normalizeTextGenerationSettings
} from '../../domain/rules/text-generation-settings';
import { readJsonObject, writeJsonObject } from '../storage/json-file';

/** 设置文件中的键。 */
const KEYS = {
  defaultModel: 'text.defaultModel',
  splitMode: 'novel.splitMode',
  maxSegmentChars: 'novel.maxSegmentChars'
} as const;

/** 把文本生成设置保存在 JSON 文件中的存储。 */
export class JsonTextGenerationSettings implements TextGenerationSettingsStore {
  /** @param filePath 设置文件的绝对路径。 */
  constructor(private readonly filePath: string) {}

  /** 读取并规范化当前设置；文件不存在或内容损坏时使用默认值。 */
  read(): TextGenerationSettings {
    const content = this.readFile();
    return normalizeTextGenerationSettings({
      defaultModel: content[KEYS.defaultModel],
      splitMode: content[KEYS.splitMode],
      maxSegmentChars: content[KEYS.maxSegmentChars]
    });
  }

  /** 把修改写入设置文件，只写出现的项。 */
  async write(patch: TextGenerationSettingsPatch): Promise<void> {
    const content = this.readFile();
    if (patch.defaultModel !== undefined) {
      content[KEYS.defaultModel] = patch.defaultModel;
    }
    if (patch.splitMode !== undefined) {
      content[KEYS.splitMode] = patch.splitMode;
    }
    if (patch.maxSegmentChars !== undefined) {
      content[KEYS.maxSegmentChars] = patch.maxSegmentChars;
    }
    this.writeFile(content);
  }

  getSplitSettings(): NovelSplitSettings {
    return this.read().novelSplit;
  }

  private readFile(): Record<string, unknown> {
    return readJsonObject(this.filePath);
  }

  private writeFile(content: Record<string, unknown>): void {
    writeJsonObject(this.filePath, content);
  }
}
