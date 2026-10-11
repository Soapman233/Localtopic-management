/**
 * 探针主界面：路线 B（JS 测量分页）实时演示 + 路线 A（CSS 分栏）对比。
 *
 * 演示能力：
 * - 切换答案模式（学生版 / 答案解析版）→ 内容量变化 → 分页自动重算；
 * - 切换模板（考试 / 测验 / 作业）→ 页边距/字号变化 → 分页自动重算；
 * - 切换纸张（A4 / Letter）→ 用于对照真实导出（真实 PDF 为 Letter）；
 * - 调换题序 / 删除题目 → 分页自动重算（防抖）；
 * - 显示分页耗时、页数、溢出页、测量版本，并可跑基准测试。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildBlocks, BlockView, type DocBlock } from './blocks'
import { computeLayout, type PageSizeName, type TemplateName } from './spec'
import { usePagination } from './usePagination'
import { PageView } from './PageView'
import { CssRouteView } from './CssRouteView'
import type { ExportDataBundle, ExportPayload } from './types'

type AnswerMode = 'student' | 'answer'
type Route = 'B' | 'A'

/** 真实导出（像素预览）参考页数——来自 outputs/export/*.pdf（pypdfium2 计数）。 */
const REAL_EXPORT_PAGES: Record<AnswerMode, number> = { student: 7, answer: 8 }

/** 依答案模式派生有效 payload（学生版屏蔽答案/解析）。 */
function effectivePayload(p: ExportPayload, mode: AnswerMode): ExportPayload {
  const show = mode !== 'student'
  return {
    ...p,
    answer_mode: show ? '答案解析版' : '学生版',
    sections: p.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => ({ ...q, show_answer: show, show_analysis: show })),
    })),
  }
}

/** 把每大题题目重复 factor 倍（用于 10→50 题的规模压测），item_id 重新编号保证唯一。 */
function expandPayload(p: ExportPayload, factor: number): ExportPayload {
  if (factor <= 1) return p
  let uid = 1_000_000
  return {
    ...p,
    sections: p.sections.map((s) => {
      const qs = []
      for (let k = 0; k < factor; k++) {
        for (const q of s.questions) qs.push({ ...q, item_id: uid++ })
      }
      return { ...s, questions: qs }
    }),
  }
}

/** 防抖 hook（200ms，模拟「编辑后自动重算」）。 */
function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

export default function App() {
  // URL 参数用于「证据截图」：?panel=0&mode=answer&template=考试&pageSize=A4&route=B&scale=0.6&debug=1
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [bundle, setBundle] = useState<ExportDataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<AnswerMode>((params.get('mode') as AnswerMode) || 'student')
  const [template, setTemplate] = useState<TemplateName>((params.get('template') as TemplateName) || '考试')
  const [pageSize, setPageSize] = useState<PageSizeName>((params.get('pageSize') as PageSizeName) || 'A4')
  const [route, setRoute] = useState<Route>((params.get('route') as Route) || 'B')
  const [debug, setDebug] = useState(params.get('debug') !== '0')
  const [showPanel, setShowPanel] = useState(params.get('panel') !== '0')
  const scale = Number(params.get('scale') || '1') || 1
  const templateTouched = useRef(params.get('template') != null)

  // 取证模式：无面板时给 body 打标记，使文档随内容增高（便于整页截图）
  useEffect(() => {
    document.body.classList.toggle('evidence', params.get('panel') === '0')
  }, [params])

  /** 工作副本（可编辑）；以「答案解析版」为底，学生版通过 show_* 屏蔽。 */
  const [working, setWorking] = useState<ExportPayload | null>(null)
  const [benchMs, setBenchMs] = useState<number | null>(null)
  const [qFactor, setQFactor] = useState<number>(Number(params.get('qf')) || 1)

  // 载入真实数据
  useEffect(() => {
    fetch('./data/export_data.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: ExportDataBundle) => {
        setBundle(d)
        setWorking(JSON.parse(JSON.stringify(d.answer)) as ExportPayload)
        if (!templateTouched.current) setTemplate((d.answer.paper.template as TemplateName) || '考试')
      })
      .catch((e) => setError(String(e)))
  }, [])

  const model = useMemo(() => computeLayout(template, pageSize), [template, pageSize])

  const effective = useMemo(
    () => (working ? expandPayload(effectivePayload(working, mode), qFactor) : null),
    [working, mode, qFactor],
  )

  const blocks: DocBlock[] = useMemo(
    () => (effective ? buildBlocks(effective, model) : []),
    [effective, model],
  )

  // 防抖后的块（模拟编辑后 200ms 重算）
  const debouncedBlocks = useDebounced(blocks, 200)
  const pagination = usePagination(debouncedBlocks, model)
  const { measureRef, pages, ms, ready, fontsReady, imagesReady, benchmark, version, heights } = pagination

  const runBench = useCallback(() => {
    const avg = benchmark(20)
    setBenchMs(avg)
  }, [benchmark])

  // 自动跑基准（供无头截图/取证读取）：?autobench=1
  const autoBench = params.get('autobench') === '1'
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoBench && ready && !autoRan.current) {
      autoRan.current = true
      setBenchMs(benchmark(20))
    }
  }, [autoBench, ready, benchmark])

  // 暴露给取证脚本（puppeteer）读取真实指标
  useEffect(() => {
    const qCount = effective ? effective.sections.reduce((a, s) => a + s.questions.length, 0) : 0
    // 每页「从第几题开始 / 含哪些题」，用于与真实 PDF 的断页位置比对
    const pageSummary = pages.map((p, i) => {
      const qs = p.blockIndices
        .map((idx) => debouncedBlocks[idx])
        .filter((b) => b.kind === 'question')
        .map((b) => b.qNumber)
      return {
        page: i + 1,
        firstQuestion: qs.length ? qs[0] : null,
        questions: qs,
        startsWithSection: p.blockIndices.some((idx) => debouncedBlocks[idx].kind === 'section'),
        usedPx: Math.round(p.usedPx),
      }
    })
    ;(window as unknown as { __spike?: unknown }).__spike = {
      pages: pages.length,
      ms,
      ready,
      fontsReady,
      imagesReady,
      version,
      benchmark,
      questions: qCount,
      blocks: blocks.length,
      overflow: pages.filter((p) => p.overflow).length,
      pageSummary,
      pageHeightPx: model.contentHeightPx,
      blockHeights: heights,
      blockIds: debouncedBlocks.map((b) => b.id),
      mode,
      template,
      pageSize,
      qFactor,
    }
  })

  // ---- 编辑操作（作用于工作副本） ----
  const moveQuestion = useCallback((si: number, qi: number, dir: -1 | 1) => {
    setWorking((w) => {
      if (!w) return w
      const sections = w.sections.map((s) => ({ ...s, questions: [...s.questions] }))
      const arr = sections[si].questions
      const nj = qi + dir
      if (nj < 0 || nj >= arr.length) return w
      ;[arr[qi], arr[nj]] = [arr[nj], arr[qi]]
      return { ...w, sections }
    })
  }, [])

  const removeQuestion = useCallback((si: number, qi: number) => {
    setWorking((w) => {
      if (!w) return w
      const sections = w.sections.map((s) => ({ ...s, questions: [...s.questions] }))
      sections[si].questions.splice(qi, 1)
      return { ...w, sections }
    })
  }, [])

  const reset = useCallback(() => {
    if (bundle) setWorking(JSON.parse(JSON.stringify(bundle.answer)) as ExportPayload)
  }, [bundle])

  const totalBlocks = blocks.length
  const totalQuestions = effective
    ? effective.sections.reduce((a, s) => a + s.questions.length, 0)
    : 0
  const overflowPages = pages.filter((p) => p.overflow).length

  if (error) return <div className="loading">加载数据失败：{error}</div>
  if (!bundle || !working) return <div className="loading">正在载入演示卷数据…</div>

  return (
    <div className="app">
      {showPanel && (
      <aside className="panel">
        <h1>前端 A4 近似排版 · 分页探针</h1>
        <div className="sub">
          数据：真实演示卷 #{bundle.answer.paper.id}《{bundle.answer.paper.title}》
          （{working.sections.reduce((a, s) => a + s.questions.length, 0)} 题，含公式与图片）。
          <br />
          本探针独立运行，不接入 frontend/，不写 bank.db。
        </div>

        <div className="field">
          <label>实现路线</label>
          <div className="seg">
            <button className={route === 'B' ? 'active' : ''} onClick={() => setRoute('B')}>
              B · JS 测量分页（推荐）
            </button>
            <button className={route === 'A' ? 'active' : ''} onClick={() => setRoute('A')}>
              A · CSS 分栏分页
            </button>
          </div>
        </div>

        <div className="field">
          <label>答案模式</label>
          <div className="seg">
            <button className={mode === 'student' ? 'active' : ''} onClick={() => setMode('student')}>
              学生版
            </button>
            <button className={mode === 'answer' ? 'active' : ''} onClick={() => setMode('answer')}>
              答案解析版
            </button>
          </div>
        </div>

        <div className="field">
          <label>模板</label>
          <div className="seg">
            {(['考试', '测验', '作业'] as TemplateName[]).map((t) => (
              <button key={t} className={template === t ? 'active' : ''} onClick={() => setTemplate(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>纸张（对照真实导出）</label>
          <div className="seg">
            <button className={pageSize === 'A4' ? 'active' : ''} onClick={() => setPageSize('A4')}>
              A4
            </button>
            <button className={pageSize === 'Letter' ? 'active' : ''} onClick={() => setPageSize('Letter')}>
              Letter（真实 PDF）
            </button>
          </div>
        </div>

        <div className="field">
          <label>题量放大（压测 10→50 题）</label>
          <div className="seg">
            {[1, 3, 5].map((f) => (
              <button key={f} className={qFactor === f ? 'active' : ''} onClick={() => setQFactor(f)}>
                ×{f}（{f * 10} 题）
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>操作</label>
          <button className="btn" onClick={runBench}>
            跑基准（20 次）
          </button>
          <button className="btn" onClick={reset}>
            重置题目
          </button>
          <button className="btn" onClick={() => setDebug((d) => !d)}>
            {debug ? '隐藏调试' : '显示调试'}
          </button>
        </div>

        <div className="field">
          <label>分页指标（路线 B）</label>
          <div className="metrics">
            {'页数：'}<b>{pages.length}</b>{'\n'}
            {'题数：'}{totalQuestions}{'　块数：'}{totalBlocks}{'（大题标题+题，整题不可拆）\n'}
            {'首次测量：'}<b>{ms.toFixed(3)}</b>{' ms（含一次回流）\n'}
            {'基准均值：'}{benchMs == null ? '（未跑）' : <b>{benchMs.toFixed(3)} ms</b>}{'（20 次，每次含回流）\n'}
            {'就绪：'}{ready ? '是' : '否'}（字体{fontsReady ? '✓' : '…'} 图片{imagesReady ? '✓' : '…'}）{'\n'}
            {'重排版本：'}{version}{'\n'}
            {'溢出页：'}{overflowPages}{overflowPages ? ' ⚠' : ''}{'\n'}
            {'\n'}
            {'对照真实导出（Letter，7/8 页）：\n'}
            {'  学生版 → 探针 '}
            <b>{mode === 'student' ? pages.length : '—'}</b>{' / 真实 '}{REAL_EXPORT_PAGES.student}{'\n'}
            {'  解析版 → 探针 '}
            <b>{mode === 'answer' ? pages.length : '—'}</b>{' / 真实 '}{REAL_EXPORT_PAGES.answer}{'\n'}
          </div>
        </div>

        <div className="field">
          <label>题序编辑（改后自动重算分页）</label>
          <div className="qlist">
            {working.sections.map((s, si) =>
              s.questions.map((q, qi) => (
                <div className="qrow" key={`${s.section_id}-${q.item_id}`}>
                  <span className="num">{si + 1}.{qi + 1}</span>
                  <span className="txt" title={(q.text ?? '').slice(0, 120)}>
                    {(q.text ?? '').replace(/⟦F\d+⟧/g, '〔公式〕').slice(0, 40) || '（无题干）'}
                  </span>
                  <button onClick={() => moveQuestion(si, qi, -1)} title="上移">↑</button>
                  <button onClick={() => moveQuestion(si, qi, 1)} title="下移">↓</button>
                  <button onClick={() => removeQuestion(si, qi)} title="删除">✕</button>
                </div>
              )),
            )}
          </div>
        </div>
      </aside>
      )}

      <main className="preview-area">
        <div className="preview-toolbar">
          <span>
            <span className={`tag ${ready ? 'ok' : 'warn'}`}>
              {route === 'B' ? '路线 B · JS 测量分页' : '路线 A · CSS 分栏分页'}
            </span>
            <span className="tag">模板 {template}</span>
            <span className="tag">纸张 {pageSize}</span>
            <span className="tag">{mode === 'student' ? '学生版' : '答案解析版'}</span>
            {route === 'B' && <span className="tag">共 {pages.length} 页</span>}
          </span>
        </div>

        {/* 测量层（不可见，宽度 = 正文区宽）。**必须放在缩放容器之外**，
            否则 transform:scale 会等比缩小 getBoundingClientRect，污染测量。 */}
        <div ref={measureRef} className="measure-layer" style={{ width: model.contentWidthPx }}>
          {debouncedBlocks.map((b) => (
            <div
              key={b.id}
              data-mid={b.id}
              className={`doc-block doc-block--${b.kind}`}
              style={{ paddingBottom: b.spacingAfterPx }}
            >
              <BlockView block={b} model={model} />
            </div>
          ))}
        </div>

        <div style={{ transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }}>
        {route === 'B' ? (
          <>
            {!ready && <div className="loading">正在测量（等待字体与图片）…</div>}
            {pages.map((p, i) => (
              <PageView
                key={i}
                page={p}
                blocks={debouncedBlocks}
                model={model}
                pageNumber={i + 1}
                totalPages={pages.length}
                debug={debug}
              />
            ))}
          </>
        ) : (
          <CssRouteView blocks={debouncedBlocks} model={model} />
        )}
        </div>
      </main>
    </div>
  )
}
