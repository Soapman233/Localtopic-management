/**
 * 版式模型：**严格镜像后端 `bank/export.py` 的模板 / 图片尺寸规则**。
 *
 * 探针的核心命题是「前端能否近似还原 A4 排版并自动分页」。要做到「近似」且
 * 可对照，就必须让前端的**页面几何、字号、行距、图片显示尺寸**与真实导出
 * 使用同一套常量。本文件把这些常量从后端「搬」到前端（单位统一 pt，再换算 CSS px）。
 *
 * 注意：探针只读取规则，不修改后端；若后端常量变化，本文件需同步（已在报告标注）。
 */

export type TemplateName = '考试' | '测验' | '作业'
export type PageSizeName = 'A4' | 'Letter'

export interface PageSize {
  label: string
  widthPt: number
  heightPt: number
}

/** 纸张尺寸（pt）。A4 为设计目标；Letter 用于对照真实导出（见报告）。 */
export const PAGE_SIZES: Record<PageSizeName, PageSize> = {
  A4: { label: 'A4（210×297mm）', widthPt: 595.3, heightPt: 841.9 },
  Letter: { label: 'Letter（216×279mm）', widthPt: 612.0, heightPt: 792.0 },
}

/** A4 标准尺寸（pt），与 `bank.export.PAGE_SIZE_A4` 一致。 */
export const PAGE_SIZE_A4 = { width: 595.3, height: 841.9 }

export interface Margins {
  top: number
  bottom: number
  left: number
  right: number
}

export interface TemplateSpec {
  label: TemplateName
  titleSize: number
  titleFont: string
  sectionSize: number
  bodySize: number
  bodyFont: string
  lineSpacing: number
  margins: Margins
  gutter: number
  showScore: boolean
  pageBreakSections: boolean
  infoLine: string
  titleBorder: boolean
}

/** 与 `bank.export.TEMPLATE_SPECS` 逐字段一致（pt）。 */
export const TEMPLATE_SPECS: Record<TemplateName, TemplateSpec> = {
  考试: {
    label: '考试',
    titleSize: 18.0,
    titleFont: '黑体',
    sectionSize: 14.0,
    bodySize: 12.0,
    bodyFont: '宋体',
    lineSpacing: 1.5,
    margins: { top: 72.0, bottom: 72.0, left: 73.7, right: 56.7 },
    gutter: 28.35,
    showScore: true,
    pageBreakSections: true,
    infoLine: '班级：__________　姓名：__________　学号：__________　成绩：______',
    titleBorder: true,
  },
  测验: {
    label: '测验',
    titleSize: 16.0,
    titleFont: '黑体',
    sectionSize: 12.0,
    bodySize: 12.0,
    bodyFont: '宋体',
    lineSpacing: 1.5,
    margins: { top: 56.7, bottom: 56.7, left: 56.7, right: 56.7 },
    gutter: 0.0,
    showScore: true,
    pageBreakSections: true,
    infoLine: '班级：__________　姓名：__________',
    titleBorder: false,
  },
  作业: {
    label: '作业',
    titleSize: 14.0,
    titleFont: '黑体',
    sectionSize: 12.0,
    bodySize: 12.0,
    bodyFont: '宋体',
    lineSpacing: 1.5,
    margins: { top: 42.5, bottom: 42.5, left: 42.5, right: 42.5 },
    gutter: 0.0,
    showScore: false,
    pageBreakSections: false,
    infoLine: '姓名：__________　班级：__________',
    titleBorder: false,
  },
}

/** 段间距常量（pt），与 `bank.export` 一致。 */
export const DEFAULT_LINE_SPACING = 1.5

/**
 * **Word「多倍行距」的字体自然行高系数**（关键修正项）。
 *
 * Word 的「1.5 倍行距」= 1.5 × **字体自然行高**（≈ 1.29 × 字号），
 * 而 CSS `line-height:1.5` = 1.5 × **字号**。二者不等价：
 * 宋体 12pt 在 Word 下单行高 ≈ 15.5pt → 1.5 倍 ≈ **23.2pt**；
 * 而 CSS 只有 12×1.5 = **18pt**（低 29%）。
 *
 * 实测（见报告 §差距分析）：真实 A4 PDF 正文相邻行距众数 ≈ **23.2pt**，
 * 与 1.5 × 15.47pt 吻合。此系数即 15.47/12 ≈ **1.29**。
 * 不修正会让前端每行少占 29% 高度 → 整卷少排 ~1 页。
 */
export const WORD_SINGLE_LINE_FACTOR = 1.29
export const SPACING_TITLE_AFTER = 6.0
export const SPACING_INFO_AFTER = 6.0
export const SPACING_SECTION_BEFORE = 16.0
export const SPACING_SECTION_AFTER = 10.0
export const SPACING_QUESTION_AFTER = 16.0
export const SPACING_IMAGE_AROUND = 10.0

/** 图片自适应尺寸规则（与 `bank.export` 一致）。 */
export const IMAGE_REF_DPI = 96.0
export const IMAGE_WIDTH_RATIO: [number, number][] = [
  [3.0, 0.82],
  [1.2, 0.68],
  [0.0, 0.55],
]
export const IMAGE_MAX_HEIGHT_CM = 7.0
export const IMAGE_MIN_WIDTH_CM = 4.0
export const IMAGE_MAX_UPSCALE = 1.5

// --------------------------------------------------------------------------- //
// 单位换算（96 DPI：1pt = 96/72 px = 4/3 px；1pt = 2.54/72 cm）
// --------------------------------------------------------------------------- //
export const ptToPx = (pt: number): number => (pt * 96) / 72
export const ptToCm = (pt: number): number => (pt * 2.54) / 72
export const cmToPx = (cm: number): number => (cm / 2.54) * 96

export interface LayoutModel {
  template: TemplateName
  pageSizeName: PageSizeName
  spec: TemplateSpec
  /** 纸张（px）。 */
  pageWidthPx: number
  pageHeightPx: number
  /** 页边距（px）。 */
  marginTopPx: number
  marginBottomPx: number
  marginLeftPx: number
  marginRightPx: number
  gutterPx: number
  /** 正文区（px）：宽 = 页宽 − 左右边距 − 装订线；高 = 页高 − 上下边距。 */
  contentWidthPx: number
  contentHeightPx: number
  /** 字号（px）。 */
  titleFontPx: number
  sectionFontPx: number
  bodyFontPx: number
  /** 正文单行高度（px）= 字号 × 行距。 */
  lineHeightPx: number
  /** 正文区宽度（cm），供图片尺寸计算。 */
  contentWidthCm: number
  /** 图片可用宽度（cm）——镜像后端 `avail_width_cm`（= 页宽 − 左右边距）。 */
  imageAvailCm: number
}

/** 由「模板 + 纸张」推导出完整版式模型。 */
export function computeLayout(template: TemplateName, pageSizeName: PageSizeName): LayoutModel {
  const spec = TEMPLATE_SPECS[template]
  const size = PAGE_SIZES[pageSizeName]
  const m = spec.margins

  const contentWidthPt = size.widthPt - m.left - m.right - spec.gutter
  const contentHeightPt = size.heightPt - m.top - m.bottom

  return {
    template,
    pageSizeName,
    spec,
    pageWidthPx: ptToPx(size.widthPt),
    pageHeightPx: ptToPx(size.heightPt),
    marginTopPx: ptToPx(m.top),
    marginBottomPx: ptToPx(m.bottom),
    marginLeftPx: ptToPx(m.left),
    marginRightPx: ptToPx(m.right),
    gutterPx: ptToPx(spec.gutter),
    contentWidthPx: ptToPx(contentWidthPt),
    contentHeightPx: ptToPx(contentHeightPt),
    titleFontPx: ptToPx(spec.titleSize),
    sectionFontPx: ptToPx(spec.sectionSize),
    bodyFontPx: ptToPx(spec.bodySize),
    // 正文单行高度：镜像 Word「多倍行距」语义（字号 × 行距 × 字体自然行高系数）。
    lineHeightPx: ptToPx(spec.bodySize * spec.lineSpacing * WORD_SINGLE_LINE_FACTOR),
    contentWidthCm: ptToCm(contentWidthPt),
    imageAvailCm: ptToCm(size.widthPt - m.left - m.right),
  }
}

/**
 * 按宽高比与可用宽度计算图片显示尺寸（cm）——**逐行镜像** `bank.export.fit_image_size`。
 * 返回 `null` 表示缺少原始尺寸，调用方需回退。
 */
export function fitImageSize(
  pxW: number | null | undefined,
  pxH: number | null | undefined,
  availCm: number,
): { widthCm: number; heightCm: number } | null {
  if (!pxW || !pxH || pxW <= 0 || pxH <= 0 || availCm <= 0) return null
  const ratio = pxW / pxH
  let factor = IMAGE_WIDTH_RATIO[IMAGE_WIDTH_RATIO.length - 1][1]
  for (const [th, f] of IMAGE_WIDTH_RATIO) {
    if (ratio > th) {
      factor = f
      break
    }
  }
  const target = factor * availCm
  const natural = (pxW / IMAGE_REF_DPI) * 2.54 // 96DPI 自然宽
  let width = Math.min(target, natural) // 不放大
  if (width < IMAGE_MIN_WIDTH_CM) {
    width = Math.min(IMAGE_MIN_WIDTH_CM, natural * IMAGE_MAX_UPSCALE)
  }
  width = Math.min(width, availCm) // 绝不超可用宽度
  let height = width / ratio
  if (height > IMAGE_MAX_HEIGHT_CM) {
    height = IMAGE_MAX_HEIGHT_CM
    width = height * ratio
  }
  return { widthCm: width, heightCm: height }
}

/**
 * 计算图片在页面中的显示尺寸（px）。
 *
 * 关键点（回答 E1 必验项 3「图片高度未知怎么办」）：
 * 只要拿到图片**原始像素宽高**，显示尺寸就**完全可确定**（规则是纯函数），
 * 于是可以在 `<img>` 上**预先写入 width/height**，在图片解码前就占好位——
 * 分页不因图片异步加载而错乱。这里再把宽度夹到正文区宽度，避免超框。
 */
export function imageDisplayPx(
  img: { natural_w?: number; natural_h?: number },
  model: LayoutModel,
): { widthPx: number; heightPx: number } | null {
  const fit = fitImageSize(img.natural_w, img.natural_h, model.imageAvailCm)
  if (!fit) return null
  const widthCm = Math.min(fit.widthCm, model.contentWidthCm)
  const heightCm = (widthCm / fit.widthCm) * fit.heightCm
  return { widthPx: cmToPx(widthCm), heightPx: cmToPx(heightCm) }
}
