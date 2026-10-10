// ------------------------------------------------------------------------
// 名称：context-bar.js
// 说明：工作台顶部的上下文栏：项目、作品、分集三个下拉和当前生效的生成配置；内容没有变化时保持原样，避免后台刷新关闭用户打开的下拉。同时提供“作品标识:集标识”这种集选择值的拆分与拼接。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出；对外是 window.aiWorkbenchContext（create、parseEpisodeKey、selectableWorks、episodeKeyOf）；必须先于 workbench.js 加载；render 时使用 aiProfile.summarize，依赖 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { stageStatusLabel } = window.pageFormat;

  /** 把“作品标识:集标识”拆成数字。 */
  function parseEpisodeKey(key) {
    const [workId, episodeId] = key.split(':').map(Number);
    return { workId, episodeId };
  }

  /** 可选的作品：只列有集的作品。 */
  function selectableWorks(catalog) {
    return catalog.works.filter((work) => work.episodes.length > 0);
  }

  /** 一集在下拉里的取值：“作品标识:集标识”。 */
  function episodeKeyOf(work, episode) {
    return `${work.id}:${episode.episodeId}`;
  }

  /** 一集在下拉里的文字：序号、标题与分镜脚本状态。 */
  function episodeLabel(episode) {
    return `第 ${episode.seq} 集${episode.title ? ` ${episode.title}` : ''}（${stageStatusLabel(episode.display)}）`;
  }

  /** 顶部上下文栏里的一项：标签加内容。 */
  function renderContextItem(label, content) {
    return aiUi.h('div', { class: 'wb-context__item' }, aiUi.h('span', { class: 'wb-context__label', text: label }), content);
  }

  /**
   * 创建上下文栏；只创建一个实例。
   * @param {{
   *   getCatalog: () => object|null,
   *   getEpisodeKey: () => string,
   *   getResolved: () => object|null,
   *   selectEpisode: (key: string) => void
   * }} host 宿主页面提供的状态与操作：getCatalog 在清单加载成功前返回 null，selectEpisode 切换到另一集。
   * @returns {{ element: HTMLElement, render: () => void }}
   */
  function create(host) {
    /** 上下文栏当前对应的选项标记，选项变化时才重建，避免后台刷新关闭用户打开的下拉。 */
    let contextKey = null;
    const element = aiUi.h('section', { class: 'wb-context', hidden: true, attrs: { 'aria-label': '当前集与生成配置' } });

    /** 切换项目或作品后，落到所选作品的第一集。 */
    function selectWork(work) {
      host.selectEpisode(episodeKeyOf(work, work.episodes[0]));
    }

    /** 当前所选集所在的作品；没有选中任何集时为 undefined。 */
    function selectedWork() {
      const catalog = host.getCatalog();
      const episodeKey = host.getEpisodeKey();
      if (!catalog || episodeKey === '') return undefined;
      const { workId } = parseEpisodeKey(episodeKey);
      return catalog.works.find((work) => work.id === workId);
    }

    /** 重绘上下文栏：项目、作品、分集三个下拉和当前生效的生成配置；内容没有变化时保持原样。 */
    function render() {
      const catalog = host.getCatalog();
      const episodeKey = host.getEpisodeKey();
      const resolved = host.getResolved();
      const work = selectedWork();
      const summary = resolved ? aiProfile.summarize(resolved) : '';
      const key = JSON.stringify([
        catalog && catalog.works.map((item) => [item.id, item.name, item.projectName, item.episodes.map((episode) => [episode.episodeId, episode.seq, episode.title, episode.display])]),
        episodeKey,
        summary
      ]);
      if (key === contextKey) return;
      contextKey = key;
      element.textContent = '';
      element.hidden = !work;
      if (!work) return;

      const works = selectableWorks(catalog);
      const projectNames = [...new Set(works.map((item) => item.projectName))];
      const projectSelect = aiUi.select({
        options: projectNames.map((name) => ({ value: name, label: name })),
        value: work.projectName,
        allowEmpty: false,
        ariaLabel: '选择项目',
        onChange: (name) => selectWork(works.find((item) => item.projectName === name))
      });
      const workSelect = aiUi.select({
        options: works.filter((item) => item.projectName === work.projectName).map((item) => ({ value: String(item.id), label: item.name })),
        value: String(work.id),
        allowEmpty: false,
        ariaLabel: '选择作品',
        onChange: (id) => selectWork(works.find((item) => String(item.id) === id))
      });
      const episodeSelect = aiUi.select({
        options: work.episodes.map((episode) => ({ value: episodeKeyOf(work, episode), label: episodeLabel(episode) })),
        value: episodeKey,
        allowEmpty: false,
        ariaLabel: '选择分集',
        onChange: host.selectEpisode
      });
      element.append(
        renderContextItem('项目', projectSelect.element),
        renderContextItem('作品', workSelect.element),
        renderContextItem('分集', episodeSelect.element),
        renderContextItem('当前生成配置（在“配置参数”步骤中修改）', aiUi.h('div', { class: 'wb-context__summary', text: summary || '—', attrs: { title: summary } }))
      );
    }

    return { element, render };
  }

  window.aiWorkbenchContext = { create, parseEpisodeKey, selectableWorks, episodeKeyOf };
})();
