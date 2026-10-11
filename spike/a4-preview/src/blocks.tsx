/**
 * 文档「块」模型与渲染。
 *
 * 分页的**原子单位**：
 * - `title` / `info`：卷头（仅第 1 页），普通块；
 * - `section`：大题标题，`keepWithNext = true`（避免标题孤立在页尾，镜像后端
 *   `set_keep(header, keep_with_next=True)`）；
 * - `question`：**一道题 = 一个不可分割块**（题干 + 配图 + 【答案】/【解析】），
 *   整题推到下一页，绝不拦腰截断（镜像后端「该题各段 keep_together + keep_next」）。
 */
import type { ReactNode } from 'react'
import type { ExportPayload, ExportQuestion, ExportSection, Formula, ImageRef } from './types'
import {
  SPACING_IMAGE_AROUND,
  SPACING_INFO_AFTER,
  SPACING_QUESTION_AFTER,
  SPACING_SECTION_AFTER,
  SPACING_SECTION_BEFORE,
  SPACING_TITLE_AFTER,
  imageDisplayPx,
  ptToPx,
  type LayoutModel,
  type TemplateSpec,
} from './spec'
import { FormulaText } from './katex'

// --------------------------------------------------------------------------- //
// 文本预处理（镜像 bank/export.py / bank/answers.py）
// --------------------------------------------------------------------------- //
const LEADING_NUMBER_RE = /^\s*(\d{1,3})\s*[．.、]\s*/
const ANS_MARKERS = ['【参考答案】', '【答案】']
const ANA_MARKERS = ['【答案与解析】', '【答案详解】', '【详解】', '【解析】', '【解答】', '【分析】', '【点评】']

/** 去掉题干行首的原始题号（导出会重新连续编号）。 */
export function stripOriginalNumber(text: string | null | undefined, number?: string | number | null): string {
  const t = text ?? ''
  const m = LEADING_NUMBER_RE.exec(t)
  if (!m) return t
  if (number != null) {
    const want = String(number).replace(/\D/g, '')
    if (want && m[1] !== want) return t // 行首数字与原题号不符 → 视为正文，不剥离
  }
  return t.slice(m[0].length)
}

function firstMarker(text: string, markers: string[]): [number, string] | null {
  let best: [number, string] | null = null
  for (const mk of markers) {
    const i = text.indexOf(mk)
    if (i >= 0 && (best === null || i < best[0])) best = [i, mk]
  }
  return best
}

/** 把题干按内联标记拆成 (stem, answer, analysis)（镜像 bank.answers.split_inline）。 */
export function splitInline(text: string | null | undefined): {
  stem: string
  answer: string | null
  analysis: string | null
} {
  const t = text ?? ''
  const ans = firstMarker(t, ANS_MARKERS)
  const ana = firstMarker(t, ANA_MARKERS)
  if (ans && (!ana || ans[0] < ana[0])) {
    const stem = t.slice(0, ans[0]).trim()
    if (!stem) return { stem: t, answer: null, analysis: null }
    const start = ans[0] + ans[1].length
    if (ana && ana[0] > ans[0]) {
      return {
        stem,
        answer: t.slice(start, ana[0]).trim(),
        analysis: t.slice(ana[0] + ana[1].length).trim(),
      }
    }
    return { stem, answer: t.slice(start).trim(), analysis: '' }
  }
  if (ana) {
    const stem = t.slice(0, ana[0]).trim()
    if (!stem) return { stem: t, answer: null, analysis: null }
    return { stem, answer: null, analysis: t.slice(ana[0] + ana[1].length).trim() }
  }
  return { stem: t, answer: null, analysis: null }
}

/** 按 `\n` 分行、逐行去首尾空白、`\t` → 4 空格；`prefix` 只加在第一行最前。 */
export function toLines(text: string | null | undefined, prefix = ''): string[] {
  const lines: string[] = []
  for (const raw of (text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim().replace(/\t/g, '    ')
    if (line) lines.push(line)
  }
  if (lines.length === 0) lines.push('')
  if (prefix) lines[0] = prefix + lines[0]
  return lines
}

/** 分值格式化：3.0 → "3"，2.5 → "2.5"。 */
export function fmtNum(x: number | null | undefined): string {
  if (x == null) return ''
  const f = Number(x)
  return f === Math.trunc(f) ? String(Math.trunc(f)) : String(f)
}

/** 大题标题（镜像 bank.export._section_header）。 */
export function sectionHeader(name: string, questions: ExportQuestion[], spec: TemplateSpec): string {
  const scores = questions.map((q) => q.score).filter((s): s is number => s != null)
  if (scores.length === 0) return name
  const subtotal = scores.reduce((a, b) => a + b, 0)
  const count = scores.length
  const allEqual = scores.every((s) => s === scores[0])
  if (spec.showScore && allEqual) {
    return `${name}（本大题共 ${count} 小题，每小题 ${fmtNum(scores[0])} 分，共 ${fmtNum(subtotal)} 分）`
  }
  return `${name}（本大题共 ${count} 小题，共 ${fmtNum(subtotal)} 分）`
}

/** 题号前缀（镜像 bank.export._question_prefix）。 */
export function questionPrefix(number: number, score: number | null, spec: TemplateSpec): string {
  if (spec.showScore && score != null) return `${number}．（${fmtNum(score)} 分）`
  return `${number}．`
}

// --------------------------------------------------------------------------- //
// 块模型
// --------------------------------------------------------------------------- //
export type BlockKind = 'title' | 'info' | 'section' | 'question'

export interface DocBlock {
  id: string
  kind: BlockKind
  /** 是否与下一块「同页」（大题标题用）。 */
  keepWithNext: boolean
  /** 是否强制在本块之前分页（大题分页模板用）。 */
  forcePageBreakBefore: boolean
  /** 段前间距（px）——仅大题标题非零；页首会抑制。 */
  spacingBeforePx: number
  /** 段后间距（px）——用 padding-bottom 实现，计入测量高度。 */
  spacingAfterPx: number
  text: string
  stemLines: string[]
  /** 该题公式（按 fid 精确映射题干占位符）。 */
  formulas: Formula[]
  images: ImageRef[]
  answerLines: string[]
  analysisLines: string[]
  sectionName?: string
  qNumber?: number
  qId?: number
  score?: number | null
}

/** 把 export-data 转成「块」列表（**已重排题号**，与导出连续编号一致）。 */
export function buildBlocks(payload: ExportPayload, model: LayoutModel): DocBlock[] {
  const spec = model.spec
  const blocks: DocBlock[] = []

  blocks.push({
    id: 'title',
    kind: 'title',
    keepWithNext: true,
    forcePageBreakBefore: false,
    spacingBeforePx: 0,
    spacingAfterPx: ptToPx(SPACING_TITLE_AFTER),
    text: payload.paper.title || '试卷',
    stemLines: [],
    formulas: [],
    images: [],
    answerLines: [],
    analysisLines: [],
  })
  blocks.push({
    id: 'info',
    kind: 'info',
    keepWithNext: true,
    forcePageBreakBefore: false,
    spacingBeforePx: 0,
    spacingAfterPx: ptToPx(SPACING_INFO_AFTER),
    text: spec.infoLine,
    stemLines: [],
    formulas: [],
    images: [],
    answerLines: [],
    analysisLines: [],
  })

  let number = 0
  payload.sections.forEach((sec: ExportSection, si: number) => {
    const questions = sec.questions ?? []
    blocks.push({
      id: `sec-${si}`,
      kind: 'section',
      keepWithNext: true,
      forcePageBreakBefore: si > 0 && spec.pageBreakSections,
      spacingBeforePx: ptToPx(SPACING_SECTION_BEFORE),
      spacingAfterPx: ptToPx(SPACING_SECTION_AFTER),
      text: sectionHeader(sec.name, questions, spec),
      stemLines: [],
      formulas: [],
      images: [],
      answerLines: [],
      analysisLines: [],
      sectionName: sec.name,
    })

    for (const q of questions) {
      number += 1
      const split = splitInline(q.text)
      const stem = stripOriginalNumber(split.stem, q.number)
      const prefix = questionPrefix(number, q.score, spec)
      const answerLines: string[] = []
      const analysisLines: string[] = []
      if (q.show_answer) {
        const ansText = q.answer != null ? q.answer : split.answer
        if (ansText && String(ansText).trim()) answerLines.push(...toLines('【答案】' + String(ansText).trim()))
      }
      if (q.show_analysis) {
        const anaText = q.analysis != null ? q.analysis : split.analysis
        if (anaText && String(anaText).trim()) analysisLines.push(...toLines('【解析】' + String(anaText).trim()))
      }
      blocks.push({
        id: `q-${q.item_id}`,
        kind: 'question',
        keepWithNext: false,
        forcePageBreakBefore: false,
        spacingBeforePx: 0,
        spacingAfterPx: ptToPx(SPACING_QUESTION_AFTER),
        text: '',
        stemLines: toLines(stem, prefix),
        formulas: q.formulas ?? [],
        images: q.images ?? [],
        answerLines,
        analysisLines,
        sectionName: sec.name,
        qNumber: number,
        qId: q.question_id,
        score: q.score,
      })
    }
  })

  return blocks
}

/** 收集所有块的图片地址（供预加载 / 就绪判定）。 */
export function collectImageUrls(blocks: DocBlock[]): string[] {
  const urls: string[] = []
  for (const b of blocks) for (const im of b.images) if (im.offline_url) urls.push(im.offline_url)
  return urls
}

// --------------------------------------------------------------------------- //
// 渲染（测量层与页面层共用，保证 DOM 完全一致）
// --------------------------------------------------------------------------- //
export interface BlockViewProps {
  block: DocBlock
  model: LayoutModel
}

/** 渲染单个块的**内部内容**（外层间距由父级负责，确保测量一致）。 */
export function BlockView({ block, model }: BlockViewProps): ReactNode {
  const spec = model.spec
  if (block.kind === 'title') {
    return (
      <div
        className="doc-title"
        style={{
          fontFamily: '"黑体", "SimHei", "Heiti SC", sans-serif',
          fontSize: model.titleFontPx,
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {block.text}
      </div>
    )
  }
  if (block.kind === 'info') {
    return (
      <div
        className="doc-info"
        style={{
          fontFamily: '"宋体", "SimSun", serif',
          fontSize: model.bodyFontPx,
          textAlign: 'center',
          borderBottom: spec.titleBorder ? '1px solid #000' : undefined,
          paddingBottom: spec.titleBorder ? 4 : 0,
        }}
      >
        {block.text}
      </div>
    )
  }
  if (block.kind === 'section') {
    return (
      <div
        className="doc-section"
        style={{
          fontFamily: '"宋体", "SimSun", serif',
          fontSize: model.sectionFontPx,
          fontWeight: 700,
        }}
      >
        {block.text}
      </div>
    )
  }
  // question
  return (
    <div className="doc-question" style={{ fontFamily: '"宋体", "SimSun", serif', fontSize: model.bodyFontPx }}>
      {block.stemLines.map((ln, i) => (
        <div key={`s${i}`} className="q-line" style={{ lineHeight: `${model.lineHeightPx}px` }}>
          <FormulaText text={ln} formulas={block.formulas} />
        </div>
      ))}
      {block.images.map((im, i) => (
        <ImageBlock key={`im${i}`} img={im} model={model} />
      ))}
      {block.answerLines.map((ln, i) => (
        <div key={`a${i}`} className="q-line" style={{ lineHeight: `${model.lineHeightPx}px` }}>
          <FormulaText text={ln} />
        </div>
      ))}
      {block.analysisLines.map((ln, i) => (
        <div key={`n${i}`} className="q-line" style={{ lineHeight: `${model.lineHeightPx}px` }}>
          <FormulaText text={ln} />
        </div>
      ))}
    </div>
  )
}

function ImageBlock({ img, model }: { img: ImageRef; model: LayoutModel }) {
  const size = imageDisplayPx(img, model)
  const url = img.offline_url
  return (
    <div className="q-image" style={{ padding: `${ptToPx(SPACING_IMAGE_AROUND / 2)}px 0`, textAlign: 'center' }}>
      {url ? (
        <img
          src={url}
          alt={img.media_path ?? '图片'}
          width={size ? Math.round(size.widthPx) : undefined}
          height={size ? Math.round(size.heightPx) : undefined}
          style={
            size
              ? { width: `${size.widthPx}px`, height: `${size.heightPx}px`, objectFit: 'contain' }
              : { maxWidth: '100%', height: 'auto' }
          }
        />
      ) : (
        <span className="qb-image-missing">［图片缺失：{img.media_path ?? '未知'}］</span>
      )}
    </div>
  )
}
