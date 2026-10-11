/**
 * 文档「块」模型与渲染（**从 spike 移植**，适配生产前端类型）。
 *
 * 分页的**原子单位**：
 * - `title` / `info`：卷头（仅第 1 页），普通块；
 * - `section`：大题标题，`keepWithNext = true`（避免标题孤立在页尾，镜像后端
 *   `set_keep(header, keep_with_next=True)`）；
 * - `question`：**一道题 = 一个不可分割块**（题干 + 配图 + 【答案】/【解析】），
 *   整题推到下一结构页；超高块自然增高以完整阅读，最终断点以像素预览为准。
 *
 * 与 spike 的差异（均为适配生产而必须）：
 *  1. 类型改用 `frontend/src/api/types` 的 `ExportPayload` / `ExportQuestion` 等；
 *  2. 图片不再依赖探针专用的 `offline_url` / `natural_w` / `natural_h`，改由调用方
 *     注入 `ResolvedImage`（url + 原始像素尺寸由前端解析，见 useResolvedImages.ts）；
 *  3. 公式渲染**复用**生产组件 `FormulaText`（含 `⟦Fn⟧` 按 fid 映射），不重写。
 */
import type { ReactNode } from 'react'
import type { ExportPayload, ExportQuestion, ExportSection, Formula, ContentBlock, ExportIssue } from '../../api/types'
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
import { FormulaText } from '../KatexFormula'
import { describeIssueSource, describeIssueTechnical, describeTechnicalInfo, isDebugMode } from '../../lib/glossary'

// --------------------------------------------------------------------------- //
// 图片解析结果（由调用方注入）
// --------------------------------------------------------------------------- //
export interface ResolvedImage {
  /** 可用的图片直链；`null` 表示取不到图（如实提示，不伪造）。 */
  url: string | null
  /** 原始像素宽高（由前端预加载解码得到，用于按后端规则预置显示尺寸）。 */
  naturalW: number | null
  naturalH: number | null
  /** 包内相对路径（用于缺失提示 / 调试）。 */
  mediaPath: string | null
  instanceId?: string
  sourceWidthEmu?: number | null
  sourceHeightEmu?: number | null
}

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

/** 按 `\n` 分行，保留真实TAB；`prefix` 只加在第一行最前。 */
export function toLines(text: string | null | undefined, prefix = ''): string[] {
  const lines: string[] = []
  for (const raw of (text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
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
  /** 是否与下一块「同页」（大题标题 / 卷头用）。 */
  keepWithNext: boolean
  /** 是否强制在本块之前分页（大题分页模板用）。 */
  forcePageBreakBefore: boolean
  /** 段前间距（px）——仅大题标题非零；页首会抑制。 */
  spacingBeforePx: number
  /** 段后间距（px）——用 padding-bottom 实现，计入测量高度。 */
  spacingAfterPx: number
  text: string
  stemLines: string[]
  /** 该题公式（按 fid 精确映射题干 / 答案 / 解析里的占位符）。 */
  formulas: Formula[]
  images: ResolvedImage[]
  answerLines: string[]
  analysisLines: string[]
  content?: ContentBlock[]
  issues?: ExportIssue[]
  blocked?: boolean
  sectionName?: string
  qNumber?: number
  qId?: number
  /** P3：试卷条目 id（`paper_questions.id`）——排版视图内拖拽调序 / 改分 / 删除的键。 */
  itemId?: number
  /** P3：所属大题 id（`null` = 未分组）——用于「跨大题拖拽暂不支持」的判定。 */
  sectionId?: number | null
  score?: number | null
}

/** 从 payload 的 paper 字段里安全取标题 / 模板。 */
function paperMeta(payload: ExportPayload): { title: string; template: string } {
  const p = payload.paper as { title?: unknown; template?: unknown }
  return {
    title: typeof p?.title === 'string' && p.title ? p.title : '试卷',
    template: typeof p?.template === 'string' ? p.template : '考试',
  }
}

/**
 * 把 export-data 转成「块」列表（**已重排题号**，与导出连续编号一致）。
 *
 * `imagesByItem` 由调用方提供（item_id → 已解析图片），缺失时按空图片处理。
 */
export function buildBlocks(
  payload: ExportPayload,
  model: LayoutModel,
  imagesByItem: Map<number, ResolvedImage[]>,
): DocBlock[] {
  const spec = model.spec
  const blocks: DocBlock[] = []

  blocks.push({
    id: 'title',
    kind: 'title',
    keepWithNext: true,
    forcePageBreakBefore: false,
    spacingBeforePx: 0,
    spacingAfterPx: ptToPx(SPACING_TITLE_AFTER),
    text: paperMeta(payload).title,
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
      id: `sec-${sec.section_id ?? si}`,
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
      const prefix = questionPrefix(number, q.score, spec)
      // 后端已经裁剪分支；只按有序块消费，不再从旧 text/images 猜测。
      let firstStem = true
      const content = (q.content_blocks ?? []).map(block => {
        if (block.kind === 'paragraph' && block.branch === 'stem' && firstStem) {
          firstStem = false
          return { ...block, text: prefix + stripOriginalNumber(block.text, q.number) }
        }
        return block
      })
      if (firstStem && q.content_status === 'ready') content.unshift({ kind: 'paragraph', branch: 'stem', text: prefix })
      blocks.push({
        id: `q-${q.item_id}`,
        kind: 'question',
        keepWithNext: false,
        forcePageBreakBefore: false,
        spacingBeforePx: 0,
        spacingAfterPx: ptToPx(SPACING_QUESTION_AFTER),
        text: '',
        stemLines: [],
        content,
        issues: q.issues,
        blocked: q.content_status === 'blocked',
        formulas: q.formulas ?? [],
        images: imagesByItem.get(q.item_id) ?? [],
        answerLines: [],
        analysisLines: [],
        sectionName: sec.name,
        qNumber: number,
        qId: q.question_id,
        itemId: q.item_id,
        sectionId: sec.section_id,
        score: q.score,
      })
    }
  })

  return blocks
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
        className="lp-title"
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
        className="lp-info"
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
        className="lp-section"
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
  const lineStyle = { lineHeight: `${model.lineHeightPx}px` }
  return (
    <div className="lp-question" style={{ fontFamily: '"宋体", "SimSun", serif', fontSize: model.bodyFontPx }}>
      {block.blocked ? <div className="lp-content-blocked" data-item-id={block.itemId}>
        {/* P0-1：老师只看「第几题 + 内容待核对」；item / qid / scan index 等原始字段走 debug。 */}
        <strong>第 {block.qNumber} 题：内容待核对，暂无法导出</strong>
        {(block.issues ?? []).map((issue, i) => <div key={i}>
          {issue.severity === 'blocker' ? '【阻断】' : '【提示】'}{issue.summary}：{issue.message}<br />
          {describeIssueSource(issue.source)}；建议：{issue.suggested_action}
          {isDebugMode() && <details>
            <summary style={{ cursor: 'pointer' }}>{describeTechnicalInfo()}</summary>
            <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {describeIssueTechnical(issue)}
            </div>
          </details>}
        </div>)}
      </div> : (block.content ?? []).map((part, i, all) => {
        const branchTitle = part.branch !== 'stem' && (i === 0 || all[i - 1].branch !== part.branch)
          ? <div className="lp-line" style={lineStyle}>{part.branch === 'answer' ? '【答案】' : '【解析】'}</div> : null
        const img = part.kind === 'image' ? block.images.find(im => im.instanceId === part.instance_id) : null
        return <div key={part.kind === 'image' ? part.instance_id : `p${i}`} data-content-branch={part.branch} data-instance-id={part.kind === 'image' ? part.instance_id : undefined}>
          {branchTitle}
          {part.kind === 'paragraph' ? toLines(part.text).map((ln, j) => <div key={j} className="lp-line" style={lineStyle}><FormulaText text={ln} formulas={block.formulas} className="lp-line-formula" /></div>)
            : <ImageBlock img={img ?? { url: part.url, naturalW: part.width, naturalH: part.height, mediaPath: part.media_path, instanceId: part.instance_id, sourceWidthEmu: part.source_width_emu, sourceHeightEmu: part.source_height_emu }} model={model} />}
        </div>
      })}
    </div>
  )
}

function ImageBlock({ img, model }: { img: ResolvedImage; model: LayoutModel }) {
  const size = imageDisplayPx(img, model)
  return (
    <div className="lp-image" style={{ padding: `${ptToPx(SPACING_IMAGE_AROUND / 2)}px 0`, textAlign: 'center' }}>
      {img.url ? (
        <img
          src={img.url}
          alt={img.mediaPath ?? '图片'}
          width={size ? Math.round(size.widthPx) : undefined}
          height={size ? Math.round(size.heightPx) : undefined}
          style={
            size
              ? { width: `${size.widthPx}px`, height: `${size.heightPx}px`, objectFit: 'contain' }
              : { maxWidth: '100%', height: 'auto' }
          }
        />
      ) : (
        <span className="lp-image-missing">［图片缺失：{img.mediaPath ?? '未知'}］</span>
      )}
    </div>
  )
}
