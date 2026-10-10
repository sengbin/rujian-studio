// ------------------------------------------------------------------------
// 名称：stage-starts.ts
// 说明：表单测试共用的阶段启动服务构造：用夹具里真实的阶段、节拍表、剧本、分镜服务和假文本模型组装。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：仅供测试使用，随 out/**/testing 一起被打包排除；不涉及作品默认参数的测试不传 profiles，保存默认参数时会报错提示。
// ------------------------------------------------------------------------

import { StageStartService } from '../../services/stage-start-service';
import { GenerationProfileService } from '../../services/generation-profile-service';
import { ServiceFixture } from '../../services/testing/service-fixture';
import { WorkTextModels } from '../text-model-field';

/** 没有传入作品默认参数服务时的占位：被调用说明测试漏传了它。 */
const UNUSED_PROFILES: Pick<GenerationProfileService, 'saveWorkDefaults'> = {
  saveWorkDefaults: () => {
    throw new Error('测试没有提供作品默认参数服务。');
  }
};

/**
 * 创建阶段启动服务。
 * @param fixture 服务层夹具。
 * @param textModels 假文本模型选择。
 * @param profiles 作品默认参数服务；分镜脚本表单的测试需要传入。
 */
export function createTestStageStarts(
  fixture: ServiceFixture,
  textModels: WorkTextModels,
  profiles: Pick<GenerationProfileService, 'saveWorkDefaults'> = UNUSED_PROFILES
): StageStartService {
  return new StageStartService({
    textModels,
    stages: fixture.stages,
    beatSheets: fixture.beatSheets,
    screenplays: fixture.screenplays,
    storyboards: fixture.storyboards,
    profiles
  });
}
