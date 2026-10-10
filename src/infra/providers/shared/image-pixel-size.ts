// ------------------------------------------------------------------------
// 名称：image-pixel-size.ts
// 说明：图像适配器共用的尺寸换算：按画幅和总像素数计算宽高。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只做数值换算；宽高的步长由各服务商的目录给出，结果的文本写法（“宽x高”或“宽*高”）由各适配器自行拼接。
// ------------------------------------------------------------------------

/** 以像素为单位的图片尺寸。 */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * 按画幅和总像素数计算宽高：宽高取 step 的整数倍并向下取整，保证总像素不超过 totalPixels。
 * @param aspectRatio 画幅，形如“16:9”。
 * @param totalPixels 总像素数。
 * @param step 宽高必须是它的整数倍。
 */
export function toPixelSize(aspectRatio: string, totalPixels: number, step: number): PixelSize {
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
  return {
    width: Math.floor(Math.sqrt((totalPixels * ratioWidth) / ratioHeight) / step) * step,
    height: Math.floor(Math.sqrt((totalPixels * ratioHeight) / ratioWidth) / step) * step
  };
}
