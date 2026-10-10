// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art.js
// 说明：分镜动画矢量插画的统一入口：汇总场景背景、角色小人、道具与特效四组图形，供绘制层（renderer）与角色图形（creatures）使用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：依赖 stage-storyboard-preview-art-figure/props/effects/backdrops.js，通过 window.aiStoryboardArt 暴露；扩展图形由 stage-storyboard-preview-props-*.js 经 registerProps、registerEffects、registerBackdrops 登记；基础绘制函数在 stage-storyboard-preview-draw.js；尺寸单位 u 为“画面高度的 1% × 纵深缩放”；颜色固定，不随主题变化。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { headOf, drawFigure } = window.aiStoryboardArtFigure;
  const { PROPS, registerProps, drawProp, drawImageTile } = window.aiStoryboardArtProps;
  const { drawEffect, registerEffects } = window.aiStoryboardArtEffects;
  const { drawBackdrop, drawWindow, registerBackdrops } = window.aiStoryboardArtBackdrops;

  window.aiStoryboardArt = { PROPS, headOf, drawFigure, drawProp, drawImageTile, drawEffect, drawBackdrop, drawWindow, registerProps, registerEffects, registerBackdrops };
})();
