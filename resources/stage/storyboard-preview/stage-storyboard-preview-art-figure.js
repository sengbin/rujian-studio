// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art-figure.js
// 说明：分镜动画的角色小人矢量插画：脸（肤色、头发、眼睛、鼻子、嘴）、小人的头（可换成资产图头像）与整个小人（影子、腿、手臂、躯干与头）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js，通过 window.aiStoryboardArtFigure 暴露，由 stage-storyboard-preview-art.js 汇总，非人类角色在 stage-storyboard-preview-creatures.js；尺寸单位 u 为“画面高度的 1% × 纵深缩放”；颜色固定，不随主题变化。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, SHADOW, WALK_SPEED, MOUTH_SPEED, shade, circle, roundedRect, drawAvatar } = window.aiStoryboardDraw;
  const SKIN = 'rgb(241, 201, 165)';
  const HAIR = 'rgb(43, 38, 35)';

  /** 角色图形从脚到头顶的高度（单位 u），用来摆放名字与气泡。 */
  const FIGURE_HEIGHT = 29;
  /** 没有摆放站位时的虚线轮廓比图形多出的高度（单位 u，脚下的余量）。 */
  const UNPLACED_OUTLINE_PAD = 0.6;


  /** 脸：肤色、头发、眼睛、鼻子与嘴；说话时嘴一开一合，背对镜头只有头发。 */
  function drawFace(ctx, x, y, radius, spec) {
    const skin = spec.skin || SKIN;
    const hair = spec.hair === undefined ? HAIR : spec.hair;
    circle(ctx, x, y, radius, skin);
    if (spec.facing === 'away') {
      if (hair) circle(ctx, x, y, radius * 1.02, hair);
      return;
    }
    const side = spec.facing === 'left' ? -1 : spec.facing === 'right' ? 1 : 0;
    if (hair) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.04, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      if (side !== 0) {
        ctx.beginPath();
        ctx.ellipse(x - side * radius * 0.55, y - radius * 0.1, radius * 0.5, radius * 0.85, 0, 0, TAU);
        ctx.fill();
      }
    }
    const eye = radius * 0.13;
    ctx.fillStyle = 'rgb(26, 26, 26)';
    for (const offset of side === 0 ? [-0.38, 0.38] : [0.45 * side]) {
      ctx.beginPath();
      ctx.arc(x + offset * radius, y - radius * 0.05, eye, 0, TAU);
      ctx.fill();
    }
    if (side !== 0) {
      ctx.fillStyle = shade(skin, 0.88);
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.95, y);
      ctx.lineTo(x + side * radius * 1.25, y + radius * 0.2);
      ctx.lineTo(x + side * radius * 0.9, y + radius * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    const open = spec.speaking ? radius * (0.1 + 0.14 * Math.abs(Math.sin(spec.phase * MOUTH_SPEED))) : radius * 0.045;
    ctx.fillStyle = 'rgb(122, 59, 59)';
    ctx.beginPath();
    ctx.ellipse(x + side * radius * 0.35, y + radius * 0.5, radius * 0.28, open, 0, 0, TAU);
    ctx.fill();
  }

  /**
   * 小人的头：圆心与半径（像素），headScale 放大头（儿童、婴儿头身比更大），extra 是头放大后图形增加的高度（单位 u）。
   * @param {{ x: number, y: number, unit: number, image?: object|null, headScale?: number }} spec
   */
  function headOf(spec) {
    const u = spec.unit;
    const scale = spec.headScale || 1;
    const baseR = spec.image ? 5.4 : 4.4;
    const baseY = spec.image ? 23.2 : 22.6;
    return { headY: spec.y - baseY * u - (scale - 1) * baseR * 0.9 * u, headR: baseR * scale * u, extra: (scale - 1) * baseR * 1.9 };
  }

  /**
   * 画一个角色小人：影子、腿、手臂、躯干与头；有资产图时头部换成圆形头像。
   * @param {{ x: number, y: number, unit: number, color: string, facing: string, walking: boolean, speaking: boolean, placed: boolean,
   *   phase: number, image: object|null, skin?: string, hair?: string|null, armsUp?: boolean, noHead?: boolean, noShadow?: boolean, headScale?: number }} spec
   *   x、y 为脚下位置，unit 为单位长度（画面高度的 1% × 纵深缩放），phase 为动画时间（秒）；skin、hair 换肤色与发色（hair 为 null 表示没有头发），
   *   armsUp 为双臂向前平举（僵尸），noHead 为不画头、noShadow 为不画影子（由调用方画），headScale 为头的放大倍数。
   * @returns {{ headX: number, headY: number, headR: number, height: number }} 头的位置与图形总高度（单位 u）。
   */
  function drawFigure(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const skin = spec.skin || SKIN;
    const swing = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    if (!spec.noShadow) {
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 * u, 1.6 * u, 0, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(color, 0.55);
    ctx.lineWidth = 2.6 * u;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 1.7 * u, y - 8 * u);
      ctx.lineTo(x + side * 1.9 * u + swing * side * 2.4 * u, y - 0.6 * u);
      ctx.stroke();
    }
    ctx.strokeStyle = shade(color, 0.8);
    ctx.lineWidth = 2.2 * u;
    for (const side of [-1, 1]) {
      const handX = spec.armsUp ? x + side * 9 * u : x + side * 5.3 * u - swing * side * 2.2 * u;
      const handY = spec.armsUp ? y - 15 * u : y - 9.2 * u;
      ctx.beginPath();
      ctx.moveTo(x + side * 4.1 * u, y - 16.5 * u);
      ctx.lineTo(handX, handY + (spec.armsUp ? 0 : -0.4 * u));
      ctx.stroke();
      circle(ctx, handX, handY, 1.2 * u, skin);
    }
    ctx.fillStyle = color;
    roundedRect(ctx, x - 4 * u, y - 18.5 * u, 8 * u, 11 * u, 3 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 0.4 * u;
    ctx.stroke();
    const head = headOf(spec);
    if (spec.noHead) {
      // 头由调用方画。
    } else if (spec.image) {
      drawAvatar(ctx, spec.image, x, head.headY, head.headR, 0.6 * u);
    } else {
      drawFace(ctx, x, head.headY, head.headR, spec);
    }
    if (!spec.placed) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgb(255, 255, 255)';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, x - 7 * u, y - (FIGURE_HEIGHT + head.extra) * u, 14 * u, (FIGURE_HEIGHT + UNPLACED_OUTLINE_PAD + head.extra) * u, 3 * u);
      ctx.stroke();
      ctx.restore();
    }
    return { headX: x, headY: head.headY, headR: head.headR, height: FIGURE_HEIGHT + head.extra };
  }

  window.aiStoryboardArtFigure = { headOf, drawFigure };
})();
