// ------------------------------------------------------------------------
// 名称：stage-storyboard-panels.js
// 说明：分镜脚本阶段镜头编辑区三个页签的内容：“调度”（出场实体，以及出场角色、道具、特效的起点、终点、朝向与动作）、“镜头”（场次、时长、景别、机位、运镜、转场、连续性、首帧来源（含本地指定图片的预览与更换））与“画面与声音”（画面描述、声音条目）；每个页签返回元素与收集字段值的函数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：由 stage-storyboard.js 调用，必须先于它加载，通过 window.aiStoryboardPanels 暴露；收集的字段随 stage.saveShot、stage.addShot 请求提交，需与 src/app/services/storyboard-service.ts 的镜头字段一致；样式在 stage-storyboard.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const FIRST_FRAME_NONE = 'none';
  const FIRST_FRAME_PREV_TAIL = 'prev_tail';
  const FIRST_FRAME_ASSET = 'asset';
  const FIRST_FRAME_IMAGE = 'image';
  /** 首帧图片支持的扩展名；单张大小上限来自视图的 limits，与宿主校验一致。 */
  const FIRST_FRAME_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
  const SOUND_DIALOGUE = 'dialogue';
  /** 画面描述、连续性要求按内容增高，最多长到这个行数再滚动。 */
  const PROMPT_MAX_ROWS = 6;
  const NOTE_MAX_ROWS = 3;

  /** 可空的数字转为输入框文字。 */
  function numberText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  /** 带标签的字段。 */
  function field(label, control, description) {
    return aiUi.field({ label, description, control }).element;
  }

  /** 区块标题：标题加一行说明。 */
  function sectionHeading(title, note) {
    return aiUi.h('div', {}, aiUi.h('h3', { class: 'ui-heading storyboard-section__title', text: title }), note ? aiUi.h('p', { class: 'storyboard-section__note', text: note }) : null);
  }

  /**
   * 出场实体：按类型分组的切换按钮，点击切换是否出场。
   * @returns { element, getValue }，getValue 返回已绑定的实体标识，顺序与作品的实体列表一致。
   */
  function createEntityBindings(view, shot, canEdit, markDirty) {
    if (view.entities.length === 0) {
      return { element: aiUi.h('p', { class: 'storyboard-empty', text: '作品里还没有实体。' }), getValue: () => [] };
    }
    const selected = new Set(shot.entityIds);
    // 按实体类型分组，类型的先后顺序与实体列表中首次出现的顺序一致。
    const groups = new Map();
    for (const entity of view.entities) {
      if (!groups.has(entity.kind)) groups.set(entity.kind, { label: entity.kindLabel, entities: [] });
      groups.get(entity.kind).entities.push(entity);
    }
    const element = aiUi.h('div', { class: 'storyboard-entity-groups' });
    for (const { label, entities } of groups.values()) {
      const buttons = entities.map((entity) => {
        const button = aiUi.h('button', {
          class: 'ui-button storyboard-entity',
          text: entity.isActive ? entity.name : `${entity.name}（已停用）`,
          attrs: { type: 'button', 'aria-pressed': String(selected.has(entity.id)) }
        });
        button.disabled = !canEdit;
        button.addEventListener('click', () => {
          if (!selected.delete(entity.id)) selected.add(entity.id);
          button.setAttribute('aria-pressed', String(selected.has(entity.id)));
          markDirty();
        });
        return button;
      });
      element.append(
        aiUi.h(
          'section',
          { class: 'storyboard-entity-group' },
          aiUi.h('h4', { class: 'ui-subheading storyboard-entity-group__title' }, label, aiUi.h('span', { class: 'storyboard-entity-group__count', text: `${entities.length} 个` })),
          aiUi.h('div', { class: 'ui-wrap storyboard-entity-list' }, buttons)
        )
      );
    }
    return { element, getValue: () => view.entities.filter((entity) => selected.has(entity.id)).map((entity) => entity.id) };
  }

  /**
   * 首帧来源：不指定、上一镜头尾帧、指定图片（本地图片）、资产参考图；选“指定图片”时显示图片选择，选“资产参考图”时显示资产下拉。
   * 指定的图片保存在本地：已保存的图片读取后放进控件，可预览（点缩略图看原图）、选择新图片更换或移除；
   * 提交时没有改动的已保存图片不重传，换了新图片才带上内容，移除后保存会提示重新选择。
   * @param loadSavedImage 读取镜头已保存的首帧图片，返回 { name, mimeType, size, data }；读取失败时抛出错误。
   */
  function createFirstFrame(view, shot, canEdit, markDirty, loadSavedImage) {
    const sourceOptions = [{ value: FIRST_FRAME_NONE, label: '不指定' }];
    // 第 1 个镜头没有上一镜头。
    if (shot.seq > 1) sourceOptions.push({ value: FIRST_FRAME_PREV_TAIL, label: '上一镜头尾帧' });
    sourceOptions.push({ value: FIRST_FRAME_IMAGE, label: '指定图片' }, { value: FIRST_FRAME_ASSET, label: '资产参考图' });
    let sourceValue = FIRST_FRAME_NONE;
    if (shot.firstFrameMode === FIRST_FRAME_PREV_TAIL && shot.seq > 1) sourceValue = FIRST_FRAME_PREV_TAIL;
    if (shot.firstFrameMode === FIRST_FRAME_ASSET || shot.firstFrameMode === FIRST_FRAME_IMAGE) sourceValue = shot.firstFrameMode;
    const source = aiUi.select({
      options: sourceOptions,
      value: sourceValue,
      allowEmpty: false,
      ariaLabel: '首帧来源',
      disabled: !canEdit,
      onChange: () => {
        updateVisibility();
        markDirty();
      }
    });

    // 指定图片：已保存的图片在读取完成前不算“被移除”。
    let savedPending = Boolean(shot.firstFrameImage);
    const imageNote = aiUi.h('p', { class: 'storyboard-help', hidden: true, attrs: { role: 'status' } });
    const picker = aiUi.filePicker({
      accept: FIRST_FRAME_IMAGE_EXTENSIONS,
      maxFileBytes: view.limits.firstFrameImageMaxBytes,
      preview: 'image',
      buttonText: '选择图片',
      emptyText: '尚未选择首帧图片',
      ariaLabel: '首帧图片',
      disabled: !canEdit,
      onChange: markDirty
    });
    const imageField = field('首帧图片', picker, '上传一张本地图片作首帧（PNG、JPEG、WebP，不超过 10 MB）；点缩略图查看原图，重新选择即可更换');
    imageField.append(imageNote);
    imageField.classList.add('storyboard-first-frame-image');
    if (shot.firstFrameImage) {
      imageNote.textContent = '正在读取已保存的首帧图片…';
      imageNote.hidden = false;
      loadSavedImage(shot.id).then(
        (file) => {
          savedPending = false;
          imageNote.hidden = true;
          // 读取期间用户已经选了新图片时，以新图片为准。
          if (picker.getValue().length === 0) picker.setValue([{ name: file.name, mimeType: file.mimeType, size: file.size, data: file.data, saved: true }]);
        },
        (error) => {
          savedPending = false;
          imageNote.textContent = `${(error && error.message) || '读取失败'}`;
          imageNote.hidden = false;
        }
      );
    }

    // 资产参考图：取所选资产的第一张参考图作首帧。
    const asset = aiUi.select({
      options: view.firstFrameAssets.map((item) => ({ value: String(item.id), label: `[${item.kindLabel}] ${item.name}` })),
      value: shot.firstFrameAssetId === null || shot.firstFrameAssetId === undefined ? '' : String(shot.firstFrameAssetId),
      placeholder: view.firstFrameAssets.length === 0 ? '资产库里还没有带参考图的资产' : '选择带参考图的资产',
      ariaLabel: '首帧资产',
      disabled: !canEdit,
      onChange: markDirty
    });
    const assetField = field('首帧资产', asset, '使用该资产的第一张参考图作首帧；资产改了参考图，首帧随之更新');
    assetField.classList.add('storyboard-first-frame-asset');
    /** 按所选来源显示对应的字段。 */
    function updateVisibility() {
      imageField.hidden = source.getValue() !== FIRST_FRAME_IMAGE;
      assetField.hidden = source.getValue() !== FIRST_FRAME_ASSET;
    }
    updateVisibility();

    return {
      element: aiUi.h(
        'div',
        { class: 'storyboard-binding' },
        field('首帧来源', source, '只在镜头组的第一个镜头上生效；选了首帧（尾帧、图片、资产）后，本组不再传角色和场景的参考图与音色参考；以上一镜头尾帧为首帧时，需要等上一镜头生成完成'),
        imageField,
        assetField
      ),
      collect: () => {
        const mode = source.getValue();
        const values = {
          firstFrameMode: mode,
          firstFrameAssetId: mode === FIRST_FRAME_ASSET && asset.getValue() !== '' ? Number(asset.getValue()) : null
        };
        if (mode === FIRST_FRAME_IMAGE) {
          const [item] = picker.getValue();
          // 没有改动的已保存图片不重传（不带该字段）；控件为空表示用户移除了图片，传 null 让宿主提示重新选择。
          if (item === undefined) {
            if (!savedPending) values.firstFrameImage = null;
          } else if (!item.saved) {
            values.firstFrameImage = { name: item.name, mimeType: item.mimeType, size: item.size, data: item.data };
          }
        }
        return values;
      }
    };
  }

  /** 一条声音的编辑行：类型、说话人、启用、排序与删除，以及内容、说话方式和起止时间。 */
  function createSoundRow(view, sound, canEdit, markDirty, actions) {
    const speakers = view.entities
      .filter((entity) => entity.kind === 'character')
      .map((entity) => ({ value: String(entity.id), label: entity.isActive ? entity.name : `${entity.name}（已停用）` }));
    const kind = aiUi.select({
      options: view.soundKinds.map((item) => ({ value: item.kind, label: item.label })),
      value: sound.kind,
      allowEmpty: false,
      ariaLabel: '声音类型',
      disabled: !canEdit,
      onChange: () => {
        updateSpeakerVisibility();
        markDirty();
      }
    });
    const speaker = aiUi.select({
      options: speakers,
      value: sound.speakerEntityId === null ? '' : String(sound.speakerEntityId),
      placeholder: '选择说话的角色',
      ariaLabel: '说话人',
      disabled: !canEdit,
      onChange: markDirty
    });
    const text = aiUi.textArea({ value: sound.text, minRows: 1, maxRows: NOTE_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
    const delivery = aiUi.textInput({ value: sound.delivery, disabled: !canEdit, onChange: markDirty });
    const start = aiUi.textInput({ value: numberText(sound.startOffsetSeconds), disabled: !canEdit, onChange: markDirty });
    const duration = aiUi.textInput({ value: numberText(sound.durationSeconds), disabled: !canEdit, onChange: markDirty });
    const enabled = aiUi.switchControl({
      label: '启用',
      checked: sound.isEnabled,
      disabled: !canEdit,
      onChange: () => {
        updateEnabledState();
        markDirty();
      }
    });

    const speakerSlot = aiUi.h('div', { class: 'storyboard-sound__speaker' }, speaker.element);
    const speakerHelp = aiUi.h('p', { class: 'storyboard-help', text: '对白的说话人会自动加入本镜头的出场实体。' });
    /** 只有角色对白需要说话人。 */
    function updateSpeakerVisibility() {
      const isDialogue = kind.getValue() === SOUND_DIALOGUE;
      speakerSlot.hidden = !isDialogue;
      speakerHelp.hidden = !isDialogue;
    }

    const moveUp = aiUi.button({ text: '上移', compact: true, disabled: !canEdit, onClick: () => actions.move(row, -1) });
    const moveDown = aiUi.button({ text: '下移', compact: true, disabled: !canEdit, onClick: () => actions.move(row, 1) });
    const remove = aiUi.button({ kind: 'delete', text: '删除', compact: true, disabled: !canEdit, onClick: () => actions.remove(row) });
    const element = aiUi.h(
      'article',
      { class: 'storyboard-sound' },
      aiUi.h(
        'div',
        { class: 'storyboard-sound__controls' },
        aiUi.h('div', { class: 'storyboard-sound__kind' }, kind.element),
        speakerSlot,
        aiUi.h('div', { class: 'storyboard-sound__actions' }, enabled.element, canEdit ? [moveUp.element, moveDown.element, remove.element] : null)
      ),
      speakerHelp,
      aiUi.h(
        'div',
        { class: 'storyboard-sound__fields' },
        field('声音内容', text),
        field('说话方式或声音质感', delivery),
        aiUi.h('div', { class: 'storyboard-sound__timing' }, field('开始时间（秒）', start), field('持续时长（秒）', duration))
      )
    );
    /** 停用的声音内容区变淡。 */
    function updateEnabledState() {
      element.classList.toggle('storyboard-sound--off', !enabled.getValue());
    }
    updateSpeakerVisibility();
    updateEnabledState();

    const row = {
      element,
      moveUp,
      moveDown,
      collect: () => ({
        kind: kind.getValue(),
        speakerEntityId: kind.getValue() === SOUND_DIALOGUE && speaker.getValue() !== '' ? Number(speaker.getValue()) : null,
        text: text.getValue(),
        delivery: delivery.getValue(),
        startOffsetSeconds: start.getValue(),
        durationSeconds: duration.getValue(),
        isEnabled: enabled.getValue()
      })
    };
    return row;
  }

  /** 声音区：按条目编辑，可添加、上移、下移、删除；返回 { element, collect, count }。 */
  function createSounds(view, shot, canEdit, markDirty) {
    const heading = sectionHeading('镜头声音', '对白、旁白、音效与配乐按条目管理');
    // 无声的生成里没有声音条目，也不能添加。
    if (view.params && view.params.audioMode === 'none' && shot.sounds.length === 0) {
      return {
        element: aiUi.h(
          'section',
          { class: 'storyboard-sound-section' },
          aiUi.h('div', { class: 'storyboard-sound-section__head' }, heading),
          aiUi.h('p', { class: 'storyboard-empty', text: '本次生成选择了“无声”，没有声音条目。' })
        ),
        collect: () => [],
        count: () => 0
      };
    }
    const rows = [];
    const listElement = aiUi.h('div', { class: 'storyboard-sound-list', attrs: { role: 'group', 'aria-label': '镜头声音条目' } });
    const actions = {
      move(row, offset) {
        const index = rows.indexOf(row);
        const target = index + offset;
        if (target < 0 || target >= rows.length) return;
        rows.splice(index, 1);
        rows.splice(target, 0, row);
        renderRows();
        markDirty();
      },
      remove(row) {
        rows.splice(rows.indexOf(row), 1);
        renderRows();
        markDirty();
      }
    };
    const addButton = aiUi.button({
      kind: 'add',
      text: '添加声音',
      compact: true,
      disabled: !canEdit,
      onClick: () => {
        if (rows.length >= view.limits.maxSoundsPerShot) return;
        const blank = { kind: view.soundKinds[0].kind, speakerEntityId: null, text: '', delivery: '', startOffsetSeconds: null, durationSeconds: null, isEnabled: true };
        rows.push(createSoundRow(view, blank, canEdit, markDirty, actions));
        renderRows();
        markDirty();
      }
    });
    /** 按当前顺序重绘条目，并更新各行排序按钮与添加按钮的可用状态。 */
    function renderRows() {
      listElement.textContent = '';
      if (rows.length === 0) listElement.append(aiUi.h('p', { class: 'storyboard-empty', text: '这个镜头没有声音。' }));
      rows.forEach((row, index) => {
        row.moveUp.setDisabled(!canEdit || index === 0);
        row.moveDown.setDisabled(!canEdit || index === rows.length - 1);
        listElement.append(row.element);
      });
      addButton.setDisabled(!canEdit || rows.length >= view.limits.maxSoundsPerShot);
    }
    for (const sound of shot.sounds) rows.push(createSoundRow(view, sound, canEdit, markDirty, actions));
    renderRows();
    return {
      element: aiUi.h(
        'section',
        { class: 'storyboard-sound-section' },
        aiUi.h('div', { class: 'storyboard-sound-section__head' }, heading, canEdit ? addButton.element : null),
        listElement
      ),
      collect: () => rows.map((row) => row.collect()),
      count: () => rows.length
    };
  }

  /**
   * 创建“镜头”页签：场次、时长、景别、机位与视角、摄影机运动、转场、连续性要求与首帧来源。
   * @param view 阶段视图（首帧资产）。
   * @param shot 镜头；新增镜头传空白镜头。
   * @param canEdit 是否可编辑。
   * @param markDirty 任一字段改变时调用。
   * @param loadSavedImage 读取镜头已保存的首帧图片（参数为镜头标识），返回文件信息与 Base64 内容。
   * @returns { element, duration, collect }：duration 是时长输入控件（页面据此同步标题旁的时长），collect 返回这些字段的值。
   */
  function buildShotPanel(view, shot, canEdit, markDirty, loadSavedImage) {
    const input = (value, placeholder) => aiUi.textInput({ value, placeholder, disabled: !canEdit, onChange: markDirty });
    const sceneLabel = input(shot.sceneLabel);
    const duration = input(numberText(shot.durationSeconds));
    const shotSize = input(shot.shotSize, '如“中景”“特写”');
    const cameraAngle = input(shot.cameraAngle, '如“平视”“低角度仰拍”');
    const cameraMovement = input(shot.cameraMovement, '如“固定镜头”“推近”');
    const transition = input(shot.transition, '如“叠化”“淡出”');
    const continuityNote = aiUi.textArea({ value: shot.continuityNote, minRows: 1, maxRows: NOTE_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
    const firstFrame = createFirstFrame(view, shot, canEdit, markDirty, loadSavedImage);

    const element = aiUi.h(
      'div',
      { class: 'storyboard-shot-panel' },
      aiUi.h('div', { class: 'storyboard-row storyboard-row--basic' }, field('场次', sceneLabel), field('时长（秒）', duration)),
      aiUi.h(
        'div',
        { class: 'storyboard-row storyboard-row--camera' },
        field('景别', shotSize),
        field('机位与视角', cameraAngle),
        field('摄影机运动', cameraMovement),
        field('转场', transition)
      ),
      aiUi.h('p', { class: 'storyboard-help', text: '景别会自动写在提示词最前面；运镜用大白话写；转场为“切”（硬切）时不写进提示词。' }),
      field('连续性要求', continuityNote),
      firstFrame.element
    );
    return {
      element,
      duration,
      collect: () => ({
        sceneLabel: sceneLabel.getValue(),
        durationSeconds: duration.getValue(),
        shotSize: shotSize.getValue(),
        cameraAngle: cameraAngle.getValue(),
        cameraMovement: cameraMovement.getValue(),
        transition: transition.getValue(),
        continuityNote: continuityNote.getValue(),
        ...firstFrame.collect()
      })
    };
  }

  /**
   * 站位区：每个出场的角色、道具、特效一行，填写起点、终点、朝向与动作；场景不需要站位。
   * 位置与朝向都以观众看到的画面为准；终点不填表示整个镜头里不移动；起点或终点选“画面左外/右外”表示进入或走出画面。
   * @param view 阶段视图（实体、站位选项）。
   * @param shot 镜头；新增镜头传空白镜头。
   * @param canEdit 是否可编辑。
   * @param markDirty 任一字段改变时调用。
   * @param getEntityIds 返回当前出场的实体标识；出场实体变化后调用返回的 refresh 重绘。
   * @returns { element, refresh, collect, count }：count 是已填写站位的实体数。
   */
  function createStaging(view, shot, canEdit, markDirty, getEntityIds) {
    const options = view.stagingOptions;
    const entityById = new Map(view.entities.map((entity) => [entity.id, entity]));
    const saved = new Map((shot.staging || []).map((item) => [item.entityId, item]));
    /** 已创建的行，出场实体取消后再选回时保留已填的内容。 */
    const rows = new Map();
    const listElement = aiUi.h('div', { class: 'storyboard-staging-list', attrs: { role: 'group', 'aria-label': '镜头站位' } });
    let renderedKey = null;

    /** 位置与朝向的下拉：第一项为空，含义由 placeholder 说明。 */
    const choice = (items, value, placeholder, ariaLabel) =>
      aiUi.select({ options: items, value: value || '', placeholder, ariaLabel, disabled: !canEdit, onChange: markDirty });

    /** 一个实体的站位行。 */
    function createRow(entity) {
      const item = saved.get(entity.id) || {};
      const name = entity.isActive ? entity.name : `${entity.name}（已停用）`;
      const startX = choice(options.x, item.startX, '不指定', `${name}起点横向位置`);
      const startDepth = choice(options.depth, item.startDepth, '不指定', `${name}起点纵深位置`);
      const endX = choice(options.x, item.endX, '不移动', `${name}终点横向位置`);
      const endDepth = choice(options.depth, item.endDepth, '不移动', `${name}终点纵深位置`);
      const facing = choice(options.facing, item.facing, '不指定', `${name}朝向`);
      const action = aiUi.textInput({ value: item.action || '', placeholder: '如“坐在桌边”“端起茶杯”', disabled: !canEdit, onChange: markDirty });
      const controls = [startX, startDepth, endX, endDepth, facing];
      return {
        element: aiUi.h(
          'article',
          { class: 'storyboard-staging' },
          aiUi.h('h4', { class: 'ui-heading storyboard-staging__title' }, name, aiUi.h('span', { class: 'storyboard-staging__kind', text: entity.kindLabel })),
          aiUi.h(
            'div',
            { class: 'storyboard-staging__fields' },
            field('起点横向', startX),
            field('起点纵深', startDepth),
            field('终点横向', endX),
            field('终点纵深', endDepth),
            field('朝向', facing)
          ),
          field('姿态或动作', action)
        ),
        isFilled: () => controls.some((control) => control.getValue() !== '') || action.getValue().trim() !== '',
        collect: () => ({
          entityId: entity.id,
          startX: startX.getValue() || null,
          startDepth: startDepth.getValue() || null,
          endX: endX.getValue() || null,
          endDepth: endDepth.getValue() || null,
          facing: facing.getValue() || null,
          action: action.getValue()
        })
      };
    }

    /** 需要站位的出场实体（场景除外），顺序与出场实体一致。 */
    function stagedEntities() {
      return getEntityIds().map((id) => entityById.get(id)).filter((entity) => entity !== undefined && entity.kind !== 'scene');
    }

    /** 出场实体变化后重绘；实体没变时不动，避免输入时反复重绘。 */
    function refresh() {
      const entities = stagedEntities();
      const key = entities.map((entity) => entity.id).join(',');
      if (key === renderedKey) return;
      renderedKey = key;
      listElement.textContent = '';
      if (entities.length === 0) {
        listElement.append(aiUi.h('p', { class: 'storyboard-empty', text: '本镜头没有需要站位的角色、道具或特效；请先在上方选择出场实体（场景不需要站位）。' }));
        return;
      }
      for (const entity of entities) {
        if (!rows.has(entity.id)) rows.set(entity.id, createRow(entity));
        listElement.append(rows.get(entity.id).element);
      }
    }
    refresh();

    const element = aiUi.h(
      'section',
      { class: 'storyboard-staging-section' },
      sectionHeading('站位与调度', '位置与朝向以观众看到的画面为准（画面左侧是观众的左边）；终点不填表示整个镜头里不移动；选“画面左外/右外”表示进入或走出画面'),
      listElement
    );
    return {
      element,
      refresh,
      collect: () => stagedEntities().map((entity) => rows.get(entity.id).collect()),
      count: () => stagedEntities().filter((entity) => rows.get(entity.id).isFilled()).length
    };
  }

  /**
   * 创建“调度”页签：出场实体在上，站位与调度在下；选中或取消实体后，下面的站位行跟着增减。
   * @param view 阶段视图（实体、站位选项）。
   * @param shot 镜头；新增镜头传空白镜头。
   * @param canEdit 是否可编辑。
   * @param markDirty 任一字段改变时调用，出场实体或站位内容的变化都会触发。
   * @returns { element, describe, collect }：describe 返回“N 个实体 · M 条站位”，collect 返回 entityIds 与 staging。
   */
  function buildBlockingPanel(view, shot, canEdit, markDirty) {
    const entities = createEntityBindings(view, shot, canEdit, () => {
      staging.refresh();
      markDirty();
    });
    const staging = createStaging(view, shot, canEdit, markDirty, entities.getValue);
    const element = aiUi.h(
      'div',
      { class: 'storyboard-blocking' },
      aiUi.h('section', {}, sectionHeading('出场实体', '点击实体名称切换是否出场'), entities.element),
      staging.element
    );
    return {
      element,
      describe: () => `${entities.getValue().length} 个实体 · ${staging.count()} 条站位`,
      collect: () => ({ entityIds: entities.getValue(), staging: staging.collect() })
    };
  }

  /**
   * 创建“画面与声音”页签：画面描述、声音条目。
   * @param view 阶段视图（声音类型、生成参数、实体）。
   * @param shot 镜头；新增镜头传空白镜头。
   * @param canEdit 是否可编辑。
   * @param markDirty 任一字段改变时调用，声音条目数量的变化也会触发。
   * @returns { element, describe, collect }：describe 返回“M 条声音”，collect 返回 prompt 与 sounds。
   */
  function buildContentPanel(view, shot, canEdit, markDirty) {
    const prompt = aiUi.textArea({ value: shot.prompt, minRows: 3, maxRows: PROMPT_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
    const sounds = createSounds(view, shot, canEdit, markDirty);
    const element = aiUi.h(
      'div',
      { class: 'storyboard-content' },
      field('画面描述', prompt, '按“主体 + 场景 + 运动 + 审美控制”描述'),
      sounds.element
    );
    return {
      element,
      describe: () => `${sounds.count()} 条声音`,
      collect: () => ({ prompt: prompt.getValue(), sounds: sounds.collect() })
    };
  }

  window.aiStoryboardPanels = { FIRST_FRAME_NONE, buildBlockingPanel, buildShotPanel, buildContentPanel };
})();
