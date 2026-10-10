// ------------------------------------------------------------------------
// 名称：builtin-providers.ts
// 说明：内置模型适配器的登记：创建注册表并登记应用自带的服务商适配器。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：新增服务商或模型类型时，只在这里增加一行登记，不改动服务层和界面。
// ------------------------------------------------------------------------

import { ProviderRegistry } from '../../domain/ports/provider-registry';
import { ProviderAccountAdapter } from '../../domain/ports/provider-account-adapter';
import { MinimaxAudioProvider } from './minimax/minimax-audio-provider';
import { MinimaxImageProvider } from './minimax/minimax-image-provider';
import { MinimaxTextProvider } from './minimax/minimax-text-provider';
import { MinimaxVideoProvider } from './minimax/minimax-video-provider';
import { QianwenAudioProvider } from './qianwen/qianwen-audio-provider';
import { QianwenImageProvider } from './qianwen/qianwen-image-provider';
import { QianwenTextProvider } from './qianwen/qianwen-text-provider';
import { QianwenVideoProvider } from './qianwen/qianwen-video-provider';
import { VolcengineAudioProvider } from './volcengine/volcengine-audio-provider';
import { VolcengineImageProvider } from './volcengine/volcengine-image-provider';
import { VolcengineTextProvider } from './volcengine/volcengine-text-provider';
import { VolcengineVideoProvider } from './volcengine/volcengine-video-provider';
import { VolcengineAccountAdapter } from './volcengine/volcengine-account-adapter';
import { VOLCENGINE_PROVIDER_CODE, VOLCENGINE_SPEECH_PROVIDER_CODE } from './volcengine/volcengine-catalog';

/** 创建登记了全部内置适配器的注册表。 */
export function createBuiltinProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(new QianwenVideoProvider())
    .register(new QianwenImageProvider())
    .register(new QianwenAudioProvider())
    .register(new QianwenTextProvider())
    .register(new VolcengineVideoProvider())
    .register(new VolcengineImageProvider())
    .register(new VolcengineAudioProvider())
    .register(new VolcengineTextProvider())
    .register(new MinimaxVideoProvider())
    .register(new MinimaxImageProvider())
    .register(new MinimaxAudioProvider())
    .register(new MinimaxTextProvider());
}

/** 创建内置的账户适配器：没有适配器的服务商（千问AI平台、MiniMax）没有公开的余额与用量接口。 */
export function createBuiltinAccountAdapters(): ProviderAccountAdapter[] {
  return [
    new VolcengineAccountAdapter(VOLCENGINE_PROVIDER_CODE, {
      productPattern: /ark|方舟/i,
      note: '需要火山账户的 AccessKey/SecretKey（费用中心不认方舟的访问密钥）；用量为当月账单，约有一天延迟。'
    }),
    new VolcengineAccountAdapter(VOLCENGINE_SPEECH_PROVIDER_CODE, {
      productPattern: /speech|语音|tts/i,
      credentialOwnerCode: VOLCENGINE_PROVIDER_CODE,
      note: '与火山引擎共用同一火山账户，余额相同；用量为当月账单，约有一天延迟。'
    })
  ];
}