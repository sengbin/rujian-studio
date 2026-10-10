// ------------------------------------------------------------------------
// 名称：asset-form.test.ts
// 说明：资产表单的自动化测试：字段随类型变化、生成方式与出图参数、所属分类、提交创建与修改、直接出图与 AI 生成提示词（含自动出图）、编辑时带出已有文件与重名检查、从实体新建。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：使用内存数据库与真实的服务。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from '../../infra/database/database-connection';
import { SqliteAssetCategoryRepository } from '../../infra/database/sqlite-asset-category-repository';
import { SqliteAssetRepository } from '../../infra/database/sqlite-asset-repository';
import { SqliteBindingRepository } from '../../infra/database/sqlite-binding-repository';
import { SqliteProjectRepository } from '../../infra/database/sqlite-project-repository';
import { SqliteUnitOfWork } from '../../infra/database/sqlite-unit-of-work';
import { AssetCategoryService } from '../services/asset-category-service';
import { AssetCreationService, AssetRunSubmitter } from '../services/asset-creation-service';
import { GenerationModelOption } from '../services/asset-generation-service';
import { AssetPromptService } from '../services/asset-prompt-service';
import { AssetService, DUPLICATE_ASSET_NAME_MESSAGE } from '../services/asset-service';
import { BindingService } from '../services/binding-service';
import { ProjectService } from '../services/project-service';
import { FILE_PROMPTS, ScriptedText } from '../stages/testing/scripted-text';
import { ASSET_FORM_NAMES, AssetRunSource, createAssetFormCatalog } from './asset-form';
import { readRunRequest } from './asset-generation-fields';
import { FormDefinition } from './form-definition';
import { TextModelStates } from './text-model-field';
import { DEFAULT_TEXT_MODEL_OPTION, createFakeTextModels } from './testing/fake-text-models';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { FAKE_ASSET_IMAGE_CAPABILITY, FAKE_AUDIO_CAPABILITY } from '../../domain/ports/testing/fake-model-providers';
import { VISUAL_STYLE_OPTIONS } from '../../domain/models/option-sets';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);

/** 生成方式的界面文字（图像类）。 */
const MODE_DIRECT = '直接出图';
const MODE_PROMPT = 'AI 生成提示词';
const MODE_PROMPT_AND_RUN = 'AI 生成提示词并出图';

const IMAGE_MODEL: GenerationModelOption = { id: 7, label: '假服务商 · 假图像模型', capability: FAKE_ASSET_IMAGE_CAPABILITY };
const AUDIO_MODEL: GenerationModelOption = { id: 8, label: '假服务商 · 假音频模型', capability: FAKE_AUDIO_CAPABILITY };

/** 没有启用任何文本模型时的选择状态。 */
const NO_TEXT_MODELS: TextModelStates = {
  getWorkState: async () => ({ choices: [], defaultLabel: null, selectedKey: null, unavailableHint: null })
};

/** 出图（音频）能力的替身：可用模型可调，记录提交的生成请求，可让提交失败。 */
function createRunStub() {
  const state = { image: [IMAGE_MODEL] as GenerationModelOption[], audio: [AUDIO_MODEL] as GenerationModelOption[], failure: null as Error | null };
  const submitted: Array<Record<string, unknown>> = [];
  const source: AssetRunSource = {
    listModelOptions: async (kind) => (kind === 'audio' ? state.audio : state.image)
  };
  const submitter: AssetRunSubmitter = {
    submit: async (rawInput) => {
      if (state.failure !== null) {
        throw state.failure;
      }
      submitted.push(rawInput as Record<string, unknown>);
      return {};
    }
  };
  return { state, submitted, source, submitter };
}

function createFixture(projectNames: readonly string[] = ['项目甲', '项目乙'], responder?: () => unknown, options: { noTextModels?: boolean } = {}) {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  const projects = new ProjectService(new SqliteProjectRepository(database));
  const assetRepository = new SqliteAssetRepository(database, new MemoryAssetFileStore());
  const assets = new AssetService(assetRepository);
  const categories = new AssetCategoryService(new SqliteAssetCategoryRepository(database));
  const created = projectNames.map((name) => projects.createProject({ name }));
  const text = new ScriptedText(responder ?? (() => ({ prompt: '生成的提示词' })));
  const notifications: number[] = [];
  const prompts = new AssetPromptService({
    texts: text,
    prompts: FILE_PROMPTS,
    assets: assetRepository,
    notify: () => notifications.push(1)
  });
  const bindings = new BindingService(new SqliteBindingRepository(database), assetRepository);
  const { textModels } = createFakeTextModels();
  const run = createRunStub();
  const catalog = createAssetFormCatalog({
    projects,
    assets,
    categories,
    prompts,
    textModels: options.noTextModels === true ? NO_TEXT_MODELS : textModels,
    generation: run.source,
    creations: new AssetCreationService({ assets, bindings, prompts, generation: run.submitter, transaction: new SqliteUnitOfWork(database) }),
    entities: bindings
  });
  const open = async (name: string, params: unknown): Promise<FormDefinition> => {
    const factory = catalog.get(name);
    assert.ok(factory);
    return factory(params);
  };
  return { database, projects, assets, categories, prompts, bindings, text, notifications, created, open, run };
}

/** 提交并等待完成，供 assert.rejects 使用。 */
async function submit(form: FormDefinition, values: Record<string, string>, submitKey?: string): Promise<void> {
  await form.submit(values, submitKey);
}

/** 等后台提示词任务结束（状态不再是生成中）。 */
async function waitForPrompt(assets: AssetService, id: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (assets.getAsset(id).promptStatus !== 'running') {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('提示词生成没有结束。');
}

/** 等条件成立（后台任务的后续动作完成）。 */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('等待的条件没有成立。');
}

test('新建表单：生成来源的字段随类型变化且没有文件字段，音频默认选中“音色参考”，设定字段之后是生成方式与出图参数', async () => {
  const { database, open } = createFixture();
  try {
    const keysOf = async (kind: string) => (await open(ASSET_FORM_NAMES.create, { kind })).schema.fields.map((field) => field.key);
    assert.deepEqual(await keysOf('character'), [
      'name', 'category', 'composition', 'style', 'background', 'referenceAspectRatio',
      'characterType', 'appearance', 'clothing', 'expressionPose', 'voiceDescription', 'extra',
      'generateMode', 'runModel', 'runCount', 'runResolution', 'textModel'
    ]);
    assert.deepEqual(await keysOf('prop'), [
      'name', 'category', 'composition', 'style', 'background', 'referenceAspectRatio', 'appearance', 'state', 'extra',
      'generateMode', 'runModel', 'runCount', 'runResolution', 'textModel'
    ]);
    assert.deepEqual(await keysOf('audio'), ['name', 'category', 'audioKind', 'description', 'language', 'extra', 'generateMode', 'runModel', 'runVoice', 'textModel']);

    const image = await open(ASSET_FORM_NAMES.create, { kind: 'scene' });
    assert.equal(image.schema.title, '新建场景');
    assert.ok(image.schema.fields.find((field) => field.key === 'composition')?.options?.includes('平视广角全景'));
    assert.equal(image.schema.submitActions?.length, 2);

    const audio = await open(ASSET_FORM_NAMES.create, { kind: 'audio' });
    assert.deepEqual(audio.schema.fields.find((field) => field.key === 'audioKind')?.options, ['音色参考', '背景音乐', '音效']);
    assert.equal(audio.initialValues.audioKind, '音色参考');
    assert.equal(audio.schema.fields.find((field) => field.key === 'name')?.checkUnique, true);
  } finally {
    database.close();
  }
});

test('新建上传表单：图片只有名称、分类与必填的参考图，音频另有类型、描述、语言；没有提示词按钮；来源参数无效时打不开', async () => {
  const { database, assets, open } = createFixture();
  try {
    const keysOf = async (kind: string) => (await open(ASSET_FORM_NAMES.create, { kind, fileSource: 'upload' })).schema.fields.map((field) => field.key);
    assert.deepEqual(await keysOf('character'), ['name', 'category', 'files']);
    assert.deepEqual(await keysOf('audio'), ['name', 'category', 'audioKind', 'description', 'language', 'files']);

    const image = await open(ASSET_FORM_NAMES.create, { kind: 'scene', fileSource: 'upload' });
    assert.deepEqual([image.schema.title, image.schema.submitLabel, image.schema.submitActions], ['上传场景图片', '创建', undefined]);
    const imageFiles = image.schema.fields.find((field) => field.key === 'files');
    assert.deepEqual([imageFiles?.multiple, imageFiles?.preview, imageFiles?.derive, imageFiles?.required], [true, 'image', 'image', true]);

    const audio = await open(ASSET_FORM_NAMES.create, { kind: 'audio', fileSource: 'upload' });
    const audioFiles = audio.schema.fields.find((field) => field.key === 'files');
    assert.deepEqual([audio.schema.title, audioFiles?.multiple, audioFiles?.derive, audioFiles?.required], ['上传音频', false, 'audio', true]);
    assert.equal(audio.initialValues.audioKind, '音色参考');

    await assert.rejects(() => open(ASSET_FORM_NAMES.create, { kind: 'scene', fileSource: 'bogus' }), ValidationError);
    const file = { name: 'a.png', mimeType: 'image/png', size: PNG.length, data: PNG.toString('base64'), width: 10, height: 10 };
    await assert.rejects(submit(image, { name: '灯塔' }), ValidationError);
    await submit(image, { name: '灯塔', files: JSON.stringify([file]) });
    const [item] = assets.listAssets('scene');
    assert.deepEqual([item.name, item.fileSource, item.fileCount, item.promptStatus], ['灯塔', 'upload', 1, 'none']);
  } finally {
    database.close();
  }
});

test('新建表单：类型无效时打不开；重名在失去焦点时检查，不同类型同名不算重名；没有项目也能打开', async () => {
  const { database, assets, open } = createFixture([]);
  try {
    await assert.rejects(() => open(ASSET_FORM_NAMES.create, { kind: 'bogus' }), ValidationError);
    await assert.rejects(() => open(ASSET_FORM_NAMES.create, undefined), ValidationError);

    assets.createAsset('prop', { name: '钥匙' });
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'prop' });
    assert.equal(form.checkField?.('name', '钥匙'), DUPLICATE_ASSET_NAME_MESSAGE);
    assert.equal(form.checkField?.('name', '怀表'), undefined);
    assert.equal((await open(ASSET_FORM_NAMES.create, { kind: 'scene' })).checkField?.('name', '钥匙'), undefined);
  } finally {
    database.close();
  }
});

test('提交新建：创建资产；重名给出冲突错误', async () => {
  const { database, assets, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'prop' });
    await submit(form, { name: '钥匙', appearance: '黄铜' });
    const [item] = assets.listAssets('prop');
    assert.deepEqual([item.name, item.attributes], ['钥匙', { appearance: '黄铜' }]);

    await assert.rejects(submit(form, { name: '钥匙' }), ConflictError);
  } finally {
    database.close();
  }
});

test('编辑表单：生成来源带出已有内容、没有文件字段，重名检查排除自身，提交修改不触碰上传的文件', async () => {
  const { database, assets, open } = createFixture();
  try {
    const asset = assets.createAsset('character', { name: '林夏', characterType: '人类', style: '水彩插画', referenceAspectRatio: '1:1' });
    assets.createAsset('character', { name: '周远' });

    const form = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    assert.equal(form.schema.title, '编辑角色');
    assert.equal(form.schema.fields.find((field) => field.key === 'name')?.checkUnique, true);
    assert.equal(form.schema.fields.some((field) => field.key === 'files'), false);
    assert.deepEqual(
      [form.initialValues.name, form.initialValues.characterType, form.initialValues.style, form.initialValues.referenceAspectRatio, form.initialValues.prompt, form.initialValues.files],
      ['林夏', '人类', '水彩插画', '1:1', undefined, undefined]
    );

    assert.equal(form.checkField?.('name', '周远'), DUPLICATE_ASSET_NAME_MESSAGE);
    assert.equal(form.checkField?.('name', '林夏'), undefined);
    assert.equal(form.checkField?.('name', '新名字'), undefined);

    await submit(form, { ...form.initialValues, name: '林夏二' });
    assert.equal(assets.getAsset(asset.id).name, '林夏二');
    await assert.rejects(() => open(ASSET_FORM_NAMES.edit, { assetId: 9999 }), NotFoundError);
    await assert.rejects(() => open(ASSET_FORM_NAMES.edit, {}), ValidationError);
  } finally {
    database.close();
  }
});

test('编辑上传表单：带出已上传的文件，替换文件后保存；生成来源的资产用 fileSource=upload 打开，保存后改用上传', async () => {
  const { database, assets, open } = createFixture();
  try {
    const file = { name: 'a.png', mimeType: 'image/png', size: PNG.length, data: PNG.toString('base64'), width: 10, height: 10 };
    const asset = assets.createAsset('character', { name: '林夏', files: JSON.stringify([file]) }, { fileSource: 'upload' });
    const form = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    assert.deepEqual([form.schema.title, form.schema.fields.map((field) => field.key)], ['上传角色图片', ['name', 'category', 'files']]);
    assert.deepEqual(JSON.parse(form.initialValues.files), [{ name: 'a.png', mimeType: 'image/png', size: PNG.length, data: PNG.toString('base64') }]);

    await assert.rejects(submit(form, { ...form.initialValues, files: '[]' }), ValidationError);
    await submit(form, { ...form.initialValues, name: '林夏二', files: JSON.stringify([{ ...file, name: 'b.png' }]) });
    assert.deepEqual([assets.getAsset(asset.id).name, assets.getReferenceFiles(asset.id).map((item) => item.fileName)], ['林夏二', ['b.png']]);

    // 切到生成：上传的文件保留；再用 fileSource=upload 打开编辑表单，带出保留的文件，保存后改用上传。
    assets.switchFileSource(asset.id, 'generated');
    const reopened = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id, fileSource: 'upload' });
    assert.equal((JSON.parse(reopened.initialValues.files) as unknown[]).length, 1);
    await submit(reopened, { ...reopened.initialValues });
    assert.equal(assets.getAsset(asset.id).fileSource, 'upload');
    await assert.rejects(() => open(ASSET_FORM_NAMES.edit, { assetId: asset.id, fileSource: 'bogus' }), ValidationError);
  } finally {
    database.close();
  }
});

test('所属分类字段：选项为该类型的分类名称，默认不分类；新建时可选分类，也可不选', async () => {
  const { database, assets, categories, open } = createFixture();
  try {
    categories.createCategory('character', { name: '主角' });
    categories.createCategory('character', { name: '配角' });
    categories.createCategory('scene', { name: '室内' });

    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const field = form.schema.fields.find((item) => item.key === 'category');
    assert.deepEqual([field?.control, field?.required, field?.options, field?.placeholder], ['select', false, ['主角', '配角'], '不分类']);
    assert.equal(form.initialValues.category, undefined);
    assert.deepEqual((await open(ASSET_FORM_NAMES.create, { kind: 'scene' })).schema.fields.find((item) => item.key === 'category')?.options, ['室内']);
    assert.deepEqual((await open(ASSET_FORM_NAMES.create, { kind: 'prop' })).schema.fields.find((item) => item.key === 'category')?.options, []);

    await submit(form, { name: '林夏', category: '主角' });
    await submit(form, { name: '周远', category: '' });
    await submit(form, { name: '路人' });
    const byName = new Map(assets.listAssets('character').map((asset) => [asset.name, asset.categoryId]));
    assert.equal(byName.get('林夏'), categories.resolveCategoryId('character', '主角'));
    assert.equal(byName.get('周远'), null);
    assert.equal(byName.get('路人'), null);

    await assert.rejects(submit(form, { name: '甲', category: '不存在' }), ValidationError);
    await assert.rejects(submit(form, { name: '乙', category: '室内' }), ValidationError);
    assert.equal(assets.listAssets('character').length, 3);
  } finally {
    database.close();
  }
});

test('编辑时带出所属分类；可改成其他分类或改为不分类；分类被删除后显示为不分类', async () => {
  const { database, assets, categories, open } = createFixture();
  try {
    const hero = categories.createCategory('character', { name: '主角' });
    categories.createCategory('character', { name: '配角' });
    const asset = assets.createAsset('character', { name: '林夏' }, { categoryId: hero.id });
    const plain = assets.createAsset('character', { name: '路人' });

    const form = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    assert.equal(form.initialValues.category, '主角');
    assert.equal((await open(ASSET_FORM_NAMES.edit, { assetId: plain.id })).initialValues.category, '');

    await submit(form, { ...form.initialValues, category: '配角' });
    assert.equal(assets.getAsset(asset.id).categoryId, categories.resolveCategoryId('character', '配角'));
    await submit(form, { ...form.initialValues, category: '' });
    assert.equal(assets.getAsset(asset.id).categoryId, null);

    await submit(form, { ...form.initialValues, category: '主角' });
    categories.deleteCategory(hero.id);
    assert.equal((await open(ASSET_FORM_NAMES.edit, { assetId: asset.id })).initialValues.category, '');
    await assert.rejects(submit(form, { ...form.initialValues, category: '主角' }), ValidationError);
  } finally {
    database.close();
  }
});

test('编辑音频的表单带所属分类字段，选项取自音频分类', async () => {
  const { database, assets, categories, open } = createFixture();
  try {
    categories.createCategory('audio', { name: '配乐' });
    const audio = assets.createAsset('audio', { name: '配乐一', audioKind: '背景音乐' });
    const edit = await open(ASSET_FORM_NAMES.edit, { assetId: audio.id });
    assert.deepEqual(edit.schema.fields.find((item) => item.key === 'category')?.options, ['配乐']);
  } finally {
    database.close();
  }
});

test('编辑音频：生成来源初始值使用界面文字、没有文件字段；上传来源已有音频随表单带出', async () => {
  const { database, assets, open } = createFixture();
  try {
    const generated = assets.createAsset('audio', { name: '雨声', audioKind: '音效', description: '细雨' });
    const generatedForm = await open(ASSET_FORM_NAMES.edit, { assetId: generated.id });
    assert.deepEqual([generatedForm.initialValues.audioKind, generatedForm.initialValues.description, generatedForm.initialValues.files], ['音效', '细雨', undefined]);

    const audio = assets.createAsset(
      'audio',
      {
        name: '配乐',
        audioKind: '背景音乐',
        description: '紧张',
        files: JSON.stringify([{ name: 'm.wav', mimeType: 'audio/wav', size: WAV.length, data: WAV.toString('base64'), durationSeconds: 5 }])
      },
      { fileSource: 'upload' }
    );
    const form = await open(ASSET_FORM_NAMES.edit, { assetId: audio.id });
    assert.deepEqual([form.initialValues.audioKind, form.initialValues.description, form.initialValues.language], ['背景音乐', '紧张', '']);
    assert.equal((JSON.parse(form.initialValues.files) as unknown[]).length, 1);
  } finally {
    database.close();
  }
});

test('提交按钮：新建与编辑表单各有两个按钮，主按钮继续生成；编辑的主按钮要求覆盖确认', async () => {
  const { database, assets, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    assert.deepEqual(form.schema.submitActions, [
      { key: 'create', label: '仅创建' },
      { key: 'createAndRun', label: '创建并生成', primary: true }
    ]);

    const asset = assets.createAsset('character', { name: '林夏' });
    const edit = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    const [save, regenerate] = edit.schema.submitActions ?? [];
    assert.deepEqual([save.key, regenerate.key, regenerate.primary], ['save', 'saveAndPrompt', true]);
    assert.equal(regenerate.confirmOverwrite, undefined, '没有提示词时不需要覆盖确认');
    assets.updatePrompts(asset.id, { prompt: '已有提示词' });
    const withPrompt = (await open(ASSET_FORM_NAMES.edit, { assetId: asset.id })).schema.submitActions ?? [];
    assert.deepEqual(withPrompt[1].confirmOverwrite?.fields, [], '提示词不在表单里，总是询问');
  } finally {
    database.close();
  }
});

test('AI 生成提示词：先保存资产，后台用已保存内容生成，写入提示词，不自动出图；仅创建不生成', async () => {
  const { database, assets, text, notifications, run, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    await submit(form, { ...form.initialValues, generateMode: MODE_PROMPT, name: '林夏', style: '写实摄影', appearance: '短发' }, 'createAndRun');

    const [asset] = assets.listAssets('character');
    assert.equal(asset.promptStatus, 'running', '资产已入库，提示词在后台生成');
    await waitForPrompt(assets, asset.id);
    const done = assets.getAsset(asset.id);
    assert.deepEqual(
      [done.promptStatus, done.prompt, done.promptRevision, done.promptContentRevision, done.contentRevision],
      ['succeeded', '生成的提示词', 1, 1, 1]
    );
    const [request] = text.requests;
    assert.match(request.user, /角色名称：林夏/);
    assert.match(request.user, /角色外观：短发/);
    assert.match(request.user, /画面风格：写实摄影/);
    assert.equal(request.images?.length ?? 0, 0, '生成来源的新建表单没有图片');
    assert.equal(request.tool.name, 'submit_asset_prompts');
    assert.ok(notifications.length >= 2, '开始和结束都通知界面刷新');
    assert.deepEqual(run.submitted, [], '只生成提示词，不提交出图');

    await submit(form, { ...form.initialValues, name: '周远', appearance: '长发' }, 'create');
    const other = assets.listAssets('character').find((item) => item.name === '周远');
    assert.equal(other?.promptStatus, 'none');
    assert.equal(text.requests.length, 1);
    assert.deepEqual(run.submitted, [], '仅创建不生成');
  } finally {
    database.close();
  }
});

test('AI 生成提示词：信息不足时不创建资产；仅创建不受限制', async () => {
  const { database, assets, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'prop' });
    await assert.rejects(
      submit(form, { ...form.initialValues, generateMode: MODE_PROMPT, name: '钥匙' }, 'createAndRun'),
      (error) => error instanceof ValidationError && /至少填写一项描述/.test(error.message)
    );
    assert.equal(assets.listAssets('prop').length, 0);
    await submit(form, { ...form.initialValues, name: '钥匙' }, 'create');
    assert.equal(assets.listAssets('prop').length, 1);

    const audio = await open(ASSET_FORM_NAMES.create, { kind: 'audio' });
    const audioValues = { ...audio.initialValues, generateMode: 'AI 生成提示词', name: '雨声', audioKind: '音效' };
    await assert.rejects(submit(audio, audioValues, 'createAndRun'), ValidationError);
    await submit(audio, { ...audioValues, description: '细雨敲窗' }, 'createAndRun');
    const rain = assets.listAssets('audio')[0];
    await waitForPrompt(assets, rain.id);
    assert.equal(assets.getAsset(rain.id).prompt, '生成的提示词');
    assert.equal(assets.getReferenceFiles(rain.id).length, 0, '音频文件可以暂时为空');
  } finally {
    database.close();
  }
});

test('提示词生成失败：资产照常创建，状态为失败并记录原因，重试可以成功', async () => {
  const { database, assets, prompts, text, open } = createFixture();
  try {
    text.unavailable = true;
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'prop' });
    await submit(form, { ...form.initialValues, generateMode: MODE_PROMPT, name: '钥匙', appearance: '黄铜' }, 'createAndRun');
    const key = assets.listAssets('prop')[0];
    await waitForPrompt(assets, key.id);
    const failed = assets.getAsset(key.id);
    assert.deepEqual([failed.promptStatus, failed.promptError, failed.prompt], ['failed', '没有可用的文本模型。', '']);

    text.unavailable = false;
    await prompts.start(key.id).done;
    assert.deepEqual([assets.getAsset(key.id).promptStatus, assets.getAsset(key.id).promptError], ['succeeded', null]);
  } finally {
    database.close();
  }
});

test('提示词生成：取消记为已取消，不能重复启动；重启恢复把遗留任务置为失败', async () => {
  const { database, assets, prompts } = createFixture(['项目甲'], () => new Promise(() => undefined));
  try {
    const asset = assets.createAsset('prop', { name: '钥匙', appearance: '黄铜' });
    const { done } = prompts.start(asset.id);
    assert.throws(() => prompts.start(asset.id), /正在生成中/);
    assert.equal(prompts.recoverInterrupted(), 0, '本进程仍在跟踪的任务不会被恢复逻辑误伤');
    prompts.cancel(asset.id);
    await done;
    assert.deepEqual([assets.getAsset(asset.id).promptStatus, assets.getAsset(asset.id).promptError], ['canceled', null]);

    // 模拟上次退出时遗留的生成中状态。
    database.prepare("UPDATE assets SET prompt_status = 'running' WHERE id = ?").run(asset.id);
    assert.equal(prompts.recoverInterrupted(), 1);
    const recovered = assets.getAsset(asset.id);
    assert.deepEqual([recovered.promptStatus, recovered.promptError], ['failed', '应用重启，已中断。']);
  } finally {
    database.close();
  }
});

test('编辑：保存并重新生成覆盖提示词；生成中保存保留库里的提示词；生成中不能再次生成', async () => {
  let release: (value: unknown) => void = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { database, assets, prompts, open } = createFixture(['项目甲'], () => gate);
  try {
    const asset = assets.createAsset('prop', { name: '钥匙', appearance: '黄铜' });
    assets.updatePrompts(asset.id, { prompt: '旧提示词' });
    const { done } = prompts.start(asset.id);

    const edit = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    assert.ok(!edit.schema.fields.some((field) => field.key === 'prompt'));
    await assert.rejects(submit(edit, { ...edit.initialValues }, 'saveAndPrompt'), (error) => error instanceof ValidationError && /正在生成中/.test(error.message));

    // 生成中保存其他字段：不动提示词，生成完成后是新生成的提示词。
    await submit(edit, { ...edit.initialValues, name: '钥匙二号' }, 'save');
    assert.equal(assets.getAsset(asset.id).name, '钥匙二号');
    release({ prompt: '新提示词' });
    await done;
    const finished = assets.getAsset(asset.id);
    assert.deepEqual([finished.prompt, finished.promptStatus], ['新提示词', 'succeeded']);

    // 提示词已有内容时，“保存并重新生成”改写提示词；表单字段改动使表单修订号加 1，生成依据改动后的内容。
    const again = await open(ASSET_FORM_NAMES.edit, { assetId: asset.id });
    await submit(again, { ...again.initialValues, appearance: '银色' }, 'saveAndPrompt');
    await waitForPrompt(assets, asset.id);
    const regenerated = assets.getAsset(asset.id);
    assert.deepEqual([regenerated.contentRevision, regenerated.promptContentRevision, regenerated.promptStatus], [2, 2, 'succeeded']);
  } finally {
    database.close();
  }
});

test('提示词表单：带出现有提示词与状态说明；保存即确认；生成中只读；重新生成走后台并要求覆盖确认', async () => {
  const { database, assets, open } = createFixture();
  try {
    const asset = assets.createAsset('prop', { name: '钥匙', appearance: '黄铜' });
    const empty = await open(ASSET_FORM_NAMES.prompt, { assetId: asset.id });
    assert.equal(empty.schema.title, '提示词：钥匙');
    assert.deepEqual(empty.schema.fields.map((field) => [field.key, field.disabled]), [['prompt', false], ['textModel', false]]);
    assert.deepEqual((empty.schema.submitActions ?? []).map((action) => [action.key, action.label, action.primary]), [
      ['save', '保存', false],
      ['regenerate', '生成提示词', true]
    ]);

    await submit(empty, { prompt: '黄铜钥匙' }, 'save');
    assets.updateAsset(asset.id, { name: '钥匙', appearance: '银质' });
    const outdated = await open(ASSET_FORM_NAMES.prompt, { assetId: asset.id });
    assert.equal(outdated.initialValues.prompt, '黄铜钥匙');
    assert.match(outdated.schema.fields[0].description, /可能需要更新/);
    const [save, regenerate] = outdated.schema.submitActions ?? [];
    assert.deepEqual([save.primary, regenerate.label, regenerate.confirmOverwrite?.fields], [true, '重新生成提示词', ['prompt']]);

    await submit(outdated, { prompt: '黄铜钥匙' }, 'save');
    const confirmed = assets.getAsset(asset.id);
    assert.deepEqual([confirmed.promptRevision, confirmed.promptContentRevision, confirmed.contentRevision], [1, 2, 2]);
    assert.doesNotMatch((await open(ASSET_FORM_NAMES.prompt, { assetId: asset.id })).schema.fields[0].description, /需要更新/);

    await submit(outdated, {}, 'regenerate');
    assert.equal(assets.getAsset(asset.id).promptStatus, 'running');
    const running = await open(ASSET_FORM_NAMES.prompt, { assetId: asset.id });
    assert.deepEqual(running.schema.fields.map((field) => field.disabled), [true, true]);
    assert.match(running.schema.fields[0].description, /生成中/);
    await assert.rejects(submit(running, { prompt: '新' }, 'save'), ValidationError);
    await waitForPrompt(assets, asset.id);
    assert.equal(assets.getAsset(asset.id).prompt, '生成的提示词');

    await assert.rejects(() => open(ASSET_FORM_NAMES.prompt, { assetId: 9999 }), NotFoundError);
    await assert.rejects(() => open(ASSET_FORM_NAMES.prompt, {}), ValidationError);
  } finally {
    database.close();
  }
});

const FAKE_MODEL_LABEL = '假服务商 · 假文本模型';
const FAKE_MODEL_KEY = 'model:fake/fake-text';

test('文本模型：生成来源的新建与编辑表单带文本模型下拉，上传来源没有；所选模型只用于本次生成提示词', async () => {
  const { database, assets, text, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const field = form.schema.fields.find((item) => item.key === 'textModel');
    assert.deepEqual([field?.control, field?.required], ['select', true]);
    assert.deepEqual(field?.options, [DEFAULT_TEXT_MODEL_OPTION, FAKE_MODEL_LABEL, '假服务商 · 备用文本模型']);
    assert.equal(form.initialValues.textModel, DEFAULT_TEXT_MODEL_OPTION);
    assert.ok(!(await open(ASSET_FORM_NAMES.create, { kind: 'character', fileSource: 'upload' })).schema.fields.some((item) => item.key === 'textModel'));

    // 沿用默认：不指定模型；选了模型：本次使用所选模型。
    const aiValues = { ...form.initialValues, generateMode: MODE_PROMPT };
    await submit(form, { ...aiValues, name: '林夏', appearance: '短发' }, 'createAndRun');
    await submit(form, { ...aiValues, name: '周远', appearance: '长发', textModel: FAKE_MODEL_LABEL }, 'createAndRun');
    for (const asset of assets.listAssets('character')) {
      await waitForPrompt(assets, asset.id);
    }
    assert.deepEqual(text.modelKeys, [null, FAKE_MODEL_KEY]);

    // 仅创建不读取文本模型，即使字段值无效也不影响。
    await submit(form, { ...form.initialValues, name: '许诺', textModel: '已被停用的模型' }, 'create');
    assert.equal(assets.listAssets('character').length, 3);
    await assert.rejects(
      submit(form, { ...aiValues, name: '孙悦', appearance: '卷发', textModel: '已被停用的模型' }, 'createAndRun'),
      (error) => error instanceof ValidationError && error.fieldErrors.textModel !== undefined
    );
    assert.equal(assets.listAssets('character').length, 3, '模型无效时不创建资产');

    const target = assets.listAssets('character').find((item) => item.name === '林夏');
    assert.ok(target);
    const edit = await open(ASSET_FORM_NAMES.edit, { assetId: target.id });
    assert.equal(edit.schema.fields.at(-1)?.key, 'textModel');
    assert.equal(edit.initialValues.textModel, DEFAULT_TEXT_MODEL_OPTION);
    await submit(edit, { ...edit.initialValues, textModel: FAKE_MODEL_LABEL }, 'saveAndPrompt');
    await waitForPrompt(assets, target.id);
    assert.deepEqual(text.modelKeys.slice(2), [FAKE_MODEL_KEY]);
  } finally {
    database.close();
  }
});

test('文本模型：提示词表单重新生成时使用所选模型，保存不使用', async () => {
  const { database, assets, text, open } = createFixture();
  try {
    const asset = assets.createAsset('prop', { name: '钥匙', appearance: '黄铜' });
    const form = await open(ASSET_FORM_NAMES.prompt, { assetId: asset.id });
    assert.equal(form.initialValues.textModel, DEFAULT_TEXT_MODEL_OPTION);

    await submit(form, { prompt: '黄铜钥匙', textModel: '已被停用的模型' }, 'save');
    assert.deepEqual(text.modelKeys, []);
    await assert.rejects(submit(form, { textModel: '已被停用的模型' }, 'regenerate'), ValidationError);
    assert.equal(assets.getAsset(asset.id).promptStatus, 'none');

    await submit(form, { textModel: FAKE_MODEL_LABEL }, 'regenerate');
    await waitForPrompt(assets, asset.id);
    assert.deepEqual(text.modelKeys, [FAKE_MODEL_KEY]);
  } finally {
    database.close();
  }
});

/** 在项目甲下写入作品、集和一个带设定的角色实体。 */
function seedEntity(database: ReturnType<typeof openDatabase>, projectId: number) {
  const insert = (sql: string, ...params: Array<string | number>) => Number(database.prepare(sql).run(...params).lastInsertRowid);
  const work = insert("INSERT INTO works (project_id, name, kind, source_type, created_at, updated_at) VALUES (?, '作品甲', 'short_video', 'text', 't', 't')", projectId);
  const episode = insert("INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 1, '第一集', 't', 't')", work);
  const entity = insert(
    `INSERT INTO script_entities (work_id, kind, name, description, attributes_json, created_at, updated_at)
     VALUES (?, 'character', '守夜人', '灯塔守护者', ?, 't', 't')`,
    work,
    JSON.stringify({ appearance: '花白胡须', outfit: '深蓝雨衣', voice: '低沉沙哑', identity: '守塔四十年' })
  );
  return { episode, entity };
}

test('从实体新建：按设定预填，画面风格预填为作品所在项目的视觉风格，保存后记录来源并绑定为形象', async () => {
  const { database, projects, assets, bindings, created, open } = createFixture();
  try {
    projects.updateProject(created[1].id, { name: '项目乙', visualStyle: '写实摄影' });
    const { episode, entity } = seedEntity(database, created[1].id);
    const form = await open(ASSET_FORM_NAMES.create, { episodeId: episode, entityId: entity });
    assert.equal(form.schema.title, '新建角色');
    assert.ok(!form.schema.fields.some((field) => field.key === 'projectName'));
    assert.match(form.schema.fields.find((field) => field.key === 'style')?.description ?? '', /默认沿用项目视觉风格“写实摄影”/);
    assert.deepEqual(form.initialValues, {
      style: '写实摄影',
      name: '守夜人',
      appearance: '花白胡须',
      clothing: '深蓝雨衣',
      voiceDescription: '低沉沙哑',
      extra: '设定概述：灯塔守护者\n身份与目标：守塔四十年',
      generateMode: MODE_PROMPT_AND_RUN,
      runModel: IMAGE_MODEL.label,
      textModel: DEFAULT_TEXT_MODEL_OPTION
    });
    assert.equal(form.schema.fields.at(-1)?.key, 'textModel');

    await submit(form, { ...form.initialValues });
    const [asset] = assets.listAssets('character');
    assert.deepEqual([asset.name, asset.sourceEntityId], ['守夜人', entity]);
    assert.deepEqual(
      bindings.listBindings(episode).map((binding) => [binding.entityId, binding.assetId, binding.purpose, binding.isPrimary]),
      [[entity, asset.id, 'visual', true]]
    );
  } finally {
    database.close();
  }
});

test('各类图像资产的画面风格下拉都以项目的视觉风格预置项开头，带入的项目风格不会落到“其他”手动输入', async () => {
  const { database, open } = createFixture();
  try {
    for (const kind of ['character', 'scene', 'prop', 'effect']) {
      const form = await open(ASSET_FORM_NAMES.create, { kind });
      const options = form.schema.fields.find((field) => field.key === 'style')?.options ?? [];
      assert.deepEqual(options.slice(0, VISUAL_STYLE_OPTIONS.length), VISUAL_STYLE_OPTIONS, kind);
    }
  } finally {
    database.close();
  }
});

test('从实体新建：可选择所属分类，创建的资产归入该分类并绑定', async () => {
  const { database, assets, categories, created, open } = createFixture();
  try {
    const { episode, entity } = seedEntity(database, created[0].id);
    const hero = categories.createCategory('character', { name: '主角' });
    const form = await open(ASSET_FORM_NAMES.create, { episodeId: episode, entityId: entity });
    assert.deepEqual(form.schema.fields.find((field) => field.key === 'category')?.options, ['主角']);
    assert.equal(form.initialValues.category, undefined);

    await submit(form, { ...form.initialValues, category: '主角' });
    assert.equal(assets.listAssets('character')[0].categoryId, hero.id);
  } finally {
    database.close();
  }
});

test('从实体新建：绑定失败时不留下新资产；实体不存在或标识无效时打不开', async () => {
  const { database, assets, created, open } = createFixture();
  try {
    const { episode, entity } = seedEntity(database, created[0].id);
    const form = await open(ASSET_FORM_NAMES.create, { episodeId: episode, entityId: entity });
    // 实体在打开表单后被删除：绑定会失败，新建的资产要回滚。
    database.prepare('DELETE FROM script_entities WHERE id = ?').run(entity);
    await assert.rejects(submit(form, { ...form.initialValues }));
    assert.equal(assets.listAssets('character').length, 0);

    await assert.rejects(() => open(ASSET_FORM_NAMES.create, { episodeId: episode, entityId: entity }), NotFoundError);
    await assert.rejects(() => open(ASSET_FORM_NAMES.create, { episodeId: 'x', entityId: entity }), ValidationError);
  } finally {
    database.close();
  }
});

test('生成方式字段：三种方式、默认直接出图；模型与出图参数只在需要出图时显示，文本模型只在带 AI 时显示；参数选项随所选模型变化', async () => {
  const { database, run, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const byKey = new Map(form.schema.fields.map((field) => [field.key, field]));
    const mode = byKey.get('generateMode');
    assert.deepEqual([mode?.options, mode?.required, form.initialValues.generateMode], [[MODE_DIRECT, MODE_PROMPT, MODE_PROMPT_AND_RUN], true, MODE_DIRECT]);
    for (const key of ['runModel', 'runCount', 'runResolution']) {
      assert.deepEqual(byKey.get(key)?.visibleWhen, { sourceKey: 'generateMode', values: [MODE_DIRECT, MODE_PROMPT_AND_RUN] }, key);
    }
    assert.deepEqual(byKey.get('textModel')?.visibleWhen, { sourceKey: 'generateMode', values: [MODE_PROMPT, MODE_PROMPT_AND_RUN] });
    assert.equal(form.initialValues.runModel, IMAGE_MODEL.label);
    assert.deepEqual(byKey.get('runCount')?.options, ['1', '2', '3', '4']);
    assert.deepEqual(byKey.get('runCount')?.optionsByValue, { sourceKey: 'runModel', byValue: { [IMAGE_MODEL.label]: ['1', '2', '3', '4'] } });
    assert.deepEqual(byKey.get('runResolution')?.optionsByValue?.byValue[IMAGE_MODEL.label], ['1K', '2K']);

    // 音频：称呼是“生成音频”，模型随音频类型变化，音色随模型变化。
    const audio = await open(ASSET_FORM_NAMES.create, { kind: 'audio' });
    const audioFields = new Map(audio.schema.fields.map((field) => [field.key, field]));
    assert.deepEqual(audioFields.get('generateMode')?.options, ['直接生成音频', 'AI 生成提示词', 'AI 生成提示词并生成音频']);
    assert.deepEqual(audioFields.get('runModel')?.optionsByValue, {
      sourceKey: 'audioKind',
      byValue: { 音色参考: [AUDIO_MODEL.label], 背景音乐: [], 音效: [AUDIO_MODEL.label] }
    });
    assert.deepEqual(audioFields.get('runVoice')?.optionsByValue?.byValue[AUDIO_MODEL.label], ['小红']);

    // 没有可用模型：说明里给出原因，初始没有选中的模型。
    run.state.image = [];
    const empty = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    assert.match(empty.schema.fields.find((field) => field.key === 'runModel')?.description ?? '', /没有可用的图像模型/);
    assert.equal(empty.initialValues.runModel, '');
  } finally {
    database.close();
  }
});

test('出图参数解析：音频类型无效时报错，不按音色参考处理', () => {
  const state = { models: [AUDIO_MODEL], textModel: { choices: [], defaultLabel: null, selectedKey: null, unavailableHint: null } };
  const values = { audioKind: '', runModel: AUDIO_MODEL.label };
  assert.throws(() => readRunRequest('audio', values, state), (error: unknown) => error instanceof ValidationError && error.fieldErrors.audioKind !== undefined);
  assert.throws(() => readRunRequest('audio', { ...values, audioKind: '不存在' }, state), ValidationError);
  assert.deepEqual(readRunRequest('audio', { ...values, audioKind: '音色参考' }, state), { modelId: 8, language: '', voice: '' });
});

test('直接出图：创建资产后立即提交生成，不调用文本模型；画幅取参考图画幅，数量与分辨率取表单，不选时用默认', async () => {
  const { database, assets, run, text, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    await submit(form, { ...form.initialValues, name: '林夏', appearance: '短发', referenceAspectRatio: '16:9', runCount: '3', runResolution: '2K' }, 'createAndRun');
    const first = assets.listAssets('character')[0];
    assert.deepEqual(run.submitted, [{ assetId: first.id, modelId: 7, count: 3, aspectRatio: '16:9', resolution: '2K', useReferenceImages: false }]);
    assert.deepEqual([first.prompt, first.promptStatus], ['', 'none'], '提示词不落库，生成时由模板拼出');
    assert.equal(text.requests.length, 0, '直接出图不调用文本模型');

    await submit(form, { ...form.initialValues, name: '周远', appearance: '长发' }, 'createAndRun');
    const second = assets.listAssets('character').find((item) => item.name === '周远');
    assert.deepEqual(run.submitted[1], { assetId: second?.id, modelId: 7, count: 1, aspectRatio: '', resolution: '', useReferenceImages: false });
  } finally {
    database.close();
  }
});

test('直接出图的校验：画幅或参数不被所选模型支持、设定不足、没有可用模型都不创建资产；提交生成失败时删除刚创建的资产', async () => {
  const { database, assets, run, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const base = { ...form.initialValues, name: '林夏', appearance: '短发' };
    const fieldErrorOf = async (values: Record<string, string>, key: string): Promise<string | undefined> => {
      try {
        await submit(form, values, 'createAndRun');
      } catch (error) {
        return error instanceof ValidationError ? error.fieldErrors[key] : undefined;
      }
      return undefined;
    };
    assert.match((await fieldErrorOf({ ...base, referenceAspectRatio: '2:3' }, 'referenceAspectRatio')) ?? '', /不支持画幅 2:3（支持：1:1、16:9）/);
    assert.match((await fieldErrorOf({ ...base, runCount: '9' }, 'runCount')) ?? '', /1 到 4/);
    assert.match((await fieldErrorOf({ ...base, runResolution: '8K' }, 'runResolution')) ?? '', /分辨率不在/);
    assert.equal(await fieldErrorOf({ ...base, runModel: '不存在的模型' }, 'runModel'), '请选择图像模型。');
    assert.match((await fieldErrorOf({ ...form.initialValues, name: '空设定' }, '')) ?? '', /补充设定描述/);
    assert.equal(assets.listAssets('character').length, 0);

    run.state.failure = new Error('平台拒绝了请求。');
    await assert.rejects(submit(form, base, 'createAndRun'), /平台拒绝了请求/);
    assert.equal(assets.listAssets('character').length, 0, '提交生成失败时不留下资产，重新提交不会因重名被拒绝');
    run.state.failure = null;
    await submit(form, base, 'createAndRun');
    assert.equal(assets.listAssets('character').length, 1);

    run.state.image = [];
    const noModel = await open(ASSET_FORM_NAMES.create, { kind: 'prop' });
    const noModelValues = { ...noModel.initialValues, name: '钥匙', appearance: '黄铜' };
    await assert.rejects(
      submit(noModel, noModelValues, 'createAndRun'),
      (error) => error instanceof ValidationError && /没有可用的图像模型/.test(error.fieldErrors.runModel ?? '')
    );
    await submit(noModel, noModelValues, 'create');
    assert.equal(assets.listAssets('prop').length, 1, '仅创建不需要模型');
  } finally {
    database.close();
  }
});

test('没有启用文本模型：带 AI 的生成方式提示无法创建，直接出图与仅创建不受影响；生成方式的说明里提示原因', async () => {
  const { database, assets, run, open } = createFixture(['项目甲'], undefined, { noTextModels: true });
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const mode = form.schema.fields.find((field) => field.key === 'generateMode');
    assert.match(mode?.descriptionByValue?.byValue[MODE_PROMPT] ?? '', /没有启用任何文本模型/);
    assert.doesNotMatch(mode?.descriptionByValue?.byValue[MODE_DIRECT] ?? '', /文本模型，无法/);

    for (const generateMode of [MODE_PROMPT, MODE_PROMPT_AND_RUN]) {
      await assert.rejects(
        submit(form, { ...form.initialValues, generateMode, name: '林夏', appearance: '短发' }, 'createAndRun'),
        (error) => error instanceof ValidationError && /没有启用任何文本模型/.test(error.fieldErrors.generateMode ?? '')
      );
    }
    assert.equal(assets.listAssets('character').length, 0);
    await submit(form, { ...form.initialValues, name: '林夏', appearance: '短发' }, 'createAndRun');
    assert.equal(run.submitted.length, 1);
  } finally {
    database.close();
  }
});

test('AI 生成提示词并出图：提示词生成成功后自动提交出图；期间改过设定不自动出图；后续失败记在提示词状态上并保留提示词', async () => {
  const gates: Array<(value: unknown) => void> = [];
  const { database, assets, run, open } = createFixture(['项目甲'], () => new Promise((resolve) => gates.push(resolve)));
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'character' });
    const base = { ...form.initialValues, generateMode: MODE_PROMPT_AND_RUN, referenceAspectRatio: '1:1' };

    await submit(form, { ...base, name: '林夏', appearance: '短发' }, 'createAndRun');
    const first = assets.listAssets('character')[0];
    assert.deepEqual(run.submitted, [], '提示词还在生成，不会出图');
    gates[0]({ prompt: '生成的提示词' });
    await waitUntil(() => run.submitted.length === 1);
    assert.deepEqual(run.submitted[0], { assetId: first.id, modelId: 7, count: 1, aspectRatio: '1:1', resolution: '', useReferenceImages: false });
    assert.deepEqual([assets.getAsset(first.id).prompt, assets.getAsset(first.id).promptStatus], ['生成的提示词', 'succeeded']);

    // 生成提示词期间改了设定：提示词已过时，不自动出图。
    await submit(form, { ...base, name: '周远', appearance: '长发' }, 'createAndRun');
    const second = assets.listAssets('character').find((item) => item.name === '周远');
    assert.ok(second);
    assets.updateAsset(second.id, { name: '周远', appearance: '银发' });
    gates[1]({ prompt: '过时的提示词' });
    await waitForPrompt(assets, second.id);
    assert.equal(run.submitted.length, 1);
    assert.equal(assets.getAsset(second.id).promptStatus, 'succeeded');

    // 自动出图失败：提示词保留，原因记在提示词状态上，用户能在列表里看到。
    run.state.failure = new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '没有可用的图像模型。' });
    await submit(form, { ...base, name: '许诺', appearance: '卷发' }, 'createAndRun');
    const third = assets.listAssets('character').find((item) => item.name === '许诺');
    assert.ok(third);
    gates[2]({ prompt: '生成的提示词' });
    await waitUntil(() => assets.getAsset(third.id).promptStatus === 'failed');
    const failed = assets.getAsset(third.id);
    assert.deepEqual([failed.prompt, failed.promptError], ['生成的提示词', '提示词已生成，但自动出图失败：没有可用的图像模型。']);
  } finally {
    database.close();
  }
});

test('音频新建：直接生成音频按描述提交，语言取表单的语言；模型随音频类型过滤，没有支持该类型的模型时无法生成', async () => {
  const { database, assets, run, open } = createFixture();
  try {
    const form = await open(ASSET_FORM_NAMES.create, { kind: 'audio' });
    assert.equal(form.initialValues.runModel, AUDIO_MODEL.label);
    await submit(
      form,
      { ...form.initialValues, name: '守夜人', audioKind: '音色参考', description: '低沉沙哑的中年男声', language: '中文', runVoice: '小红' },
      'createAndRun'
    );
    const voice = assets.listAssets('audio')[0];
    assert.deepEqual(run.submitted, [{ assetId: voice.id, modelId: 8, language: 'zh', voice: '小红' }]);

    await assert.rejects(
      submit(form, { ...form.initialValues, name: '配乐', audioKind: '背景音乐', description: '紧张', runModel: '' }, 'createAndRun'),
      (error) => error instanceof ValidationError && /没有可用的音频模型/.test(error.fieldErrors.runModel ?? '')
    );
    await assert.rejects(
      submit(form, { ...form.initialValues, name: '雨声', audioKind: '音效' }, 'createAndRun'),
      (error) => error instanceof ValidationError && /补充设定描述/.test(error.message)
    );
    assert.equal(assets.listAssets('audio').length, 1);
  } finally {
    database.close();
  }
});
