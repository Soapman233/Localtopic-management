/** P5 知识点复核页（PRD P0-14 / P1-6）。
 *
 * 覆盖需求：
 * - P0-14：按标签汇总（标签名 + 命中关联条数 + 待复核/已确认/已否决计数）、逐条确认/否决、
 *   导出/导入 CSV（供老师离线填写后读回）；
 * - P1-6：「仅看已确认知识点」严格模式说明（开关在检索页，本页给出说明与入口）；
 * - PRD 5.3：知识点为「提及」口径——必须用大白话 + 反例说明，避免被误当「考查范围」。
 *
 * B4-1 重构（内容优先的工具型极简）：
 * - 两条大 Alert 合成**一行搜索线索口径 + 帮助按钮**，删除 CLI 参数说明；
 * - 标签按 `pending` **降序**，并提供「有待复核」筛选；
 * - 右侧未选择时显示**待复核最多的前五个标签**（可点击进入）；
 * - CSV 导出/导入收进「**批量处理**」菜单；
 * - 计数口径统一标为「**关联条数**」，不写成题数。
 *
 * 审计修复（T19 / T22 / T24a）：
 * - **T19**：撤掉逐条清单里**恒定的**逐行状态徽章（实测 `review_status` 38,588/38,588 = 100% 同值）
 *   ——状态区分交给**顶部状态筛选**，仅当某行状态与当前筛选不一致时才补一个行级标记；
 * - **T22**：左标签列表**分页**（实测 183 行未分页，违反 §4.2「行数 >50 必须分页」）；
 * - **T24a**：视口 **<1200（`lg`）** 时左栏折叠为**左侧抽屉**（规范 §2.8），不再常驻定宽 340。
 *
 * ⚠️ 系统只负责**排序、聚合、影响预检**；内容决定仍由人完成。
 *
 * 关键约束（PRD Q6）：**批量否决/确认必须先显示影响条数并要求二次确认**。本页通过
 * ``/api/labels/decision/preview`` 预检影响条数，再以 ``confirm=true`` 提交；
 * 默认批量**只处理待复核项，绝不覆盖已有决定**。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import { useAppNavigate } from '../hooks/useAppNavigate'
import {
  decideLabel,
  exportReviewUrl,
  getReviewItems,
  getReviewSummary,
  importReviewCsv,
  previewDecision,
} from '../api/labels'
import type { DecisionBody } from '../api/labels'
import type { LabelDecisionPreview, LabelImportResult, LabelSummaryRow } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { describeMentionScope } from '../lib/glossary'
import { qk } from '../api/queryKeys'

const ITEM_PAGE_SIZE = 50
// T22：左标签列表实测 183 行未分页（仅 maxHeight 滚动）→ 违反规范 §4.2「行数 >50 必须分页」。
// 与逐条清单同口径每页 50 行；筛选/开关变化时回到第 1 页。
const LABEL_PAGE_SIZE = 50
const STATUS_TABS: { key: string; label: string }[] = [
  { key: '待复核', label: '待复核' },
  { key: '已确认', label: '已确认' },
  { key: '已否决', label: '已否决' },
]

/** 标签行的**复核状态点**（T04）。
 *
 * 只表达「这一行还需不需要人工处理」，**不重复左侧的关联条数**、不显示各状态计数
 * （计数在右侧详情与顶部汇总里各出现一次）。优先级：待复核 > 已确认 > 已否决。
 *
 * ⚠️ 刻意**就近定义**、不放进共享的 `StatusBadges`：该组件被组卷页（首屏）引用，
 * 往共享 chunk 里加代码会直接吃掉「首屏 ≤1,059,742 B」的硬门禁预算；
 * 这里只用一个小圆点 + caption，语义色一律走文字安全值（`*.main`）。
 */
function LabelReviewDot({ row }: { row: LabelSummaryRow }) {
  const tone: 'warning' | 'success' | 'neutral' =
    row.pending > 0 ? 'warning' : row.confirmed > 0 ? 'success' : 'neutral'
  const label = tone === 'warning' ? '待复核' : tone === 'success' ? '已确认' : '已否决'
  const paletteKey = tone === 'neutral' ? 'text.secondary' : `${tone}.main`
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      component="span"
      sx={{ flexShrink: 0 }}
      title={
        tone === 'warning'
          ? '该标签还有尚未人工复核的关联'
          : tone === 'success'
            ? '该标签的关联均已人工确认'
            : '该标签的关联均已人工否决'
      }
    >
      <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: paletteKey }} />
      <Typography variant="caption" component="span" sx={{ color: paletteKey }}>
        {label}
      </Typography>
    </Stack>
  )
}

/** 逐条清单的**行级状态标记**（T19）。
 *
 * 实测 `question_labels.review_status` 为 38,588/38,588 = **100% 同值**，且右清单本就按
 * 顶部状态筛选取数 → 逐行渲染一个**永不变化**的状态徽章是纯噪音（规范 §4.2：某列同值率
 * >60% 时不应作逐行徽章，改为**顶部筛选 + 行级标记**）。
 *
 * 因此：状态区分交给顶部三态筛选 Chip（含行内「确认 / 否决」按钮的禁用态）；这里**仅在
 * 行状态与当前筛选不一致时**（数据异常 / 迟到响应等边界）才补一个极小的行级标记——
 * **既不渲染恒定值，也不丢失「能区分三态」的能力**。
 */
function LabelStatusMarker({ status, activeStatus }: { status?: string | null; activeStatus: string }) {
  if (!status || status === activeStatus) return null
  return (
    <Typography variant="caption" component="span" color="text.secondary">
      （{status}）
    </Typography>
  )
}

/** P5 知识点复核页。 */
/** 嵌入维护父页时主标题为 h2；独立使用保留 h1，不改变视觉排版。 */
export default function KnowledgeReviewPage({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const pageHeading = headingLevel === 1 ? 'h1' : 'h2'
  const sectionHeading = headingLevel === 1 ? 'h2' : 'h3'
  const navigate = useAppNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const theme = useTheme()
  // T24a：窄屏（<1200，MUI `lg`）左栏折叠为抽屉，与组卷页同一断点口径（规范 §2.8）。
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))

  const [selected, setSelected] = useState<string | null>(null)
  const [itemStatus, setItemStatus] = useState<string>('待复核')
  const [page, setPage] = useState(1)
  const [labelPage, setLabelPage] = useState(1)
  const [labelFilter, setLabelFilter] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [batchMenuAnchor, setBatchMenuAnchor] = useState<null | HTMLElement>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [importResult, setImportResult] = useState<LabelImportResult | null>(null)

  // 批量确认状态：先预检影响条数，再二次确认。
  // ⚠️ `target` 是**发起预检时的目标标签**，与 `preview` 同源冻结；展示与提交都用它，
  //    绝不读「当前选中」，否则切标签后弹窗数字与实际写入会不一致（FIX-1）。
  const [batch, setBatch] = useState<{
    decision: string
    target: string
    preview: LabelDecisionPreview
  } | null>(null)
  // 预检请求代次：切标签 / 取消 / 卸载都会自增，使在途的旧预检响应失效（拒绝迟到响应）。
  const batchSeq = useRef(0)

  const summaryQ = useQuery({
    queryKey: qk.labelsSummary(),
    queryFn: () => getReviewSummary({ status: null }),
  })

  const itemsQ = useQuery({
    queryKey: qk.labelsItems(selected, itemStatus, page),
    queryFn: () =>
      getReviewItems({
        label_name: selected as string,
        status: itemStatus,
        limit: ITEM_PAGE_SIZE,
        offset: (page - 1) * ITEM_PAGE_SIZE,
      }),
    enabled: Boolean(selected),
  })

  const decideMut = useMutation({
    mutationFn: (body: DecisionBody) => decideLabel(body),
    onSuccess: (res, body) => {
      const verb = body.decision === '否决' ? '否决' : '确认'
      const scope = body.question_id ? '该题该标签' : `标签「${body.label_name}」全部待复核`
      setToast({ kind: 'success', text: `已${verb} ${res.updated} 条关联（${scope}）` })
      setBatch(null)
      qc.invalidateQueries({ queryKey: qk.labelsRoot() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
      qc.invalidateQueries({ queryKey: qk.facetsRoot() })
    },
    onError: (err) => {
      setToast({ kind: 'error', text: `操作失败：${(err as Error).message}` })
      setBatch(null)
    },
  })

  const importMut = useMutation({
    mutationFn: (file: File) => importReviewCsv(file, false),
    onSuccess: (res) => {
      setImportResult(res)
      setToast({
        kind: res.errors.length > 0 ? 'error' : 'success',
        text: `CSV 导入完成：共 ${res.total} 行，应用 ${res.applied}，跳过 ${res.skipped}`,
      })
      qc.invalidateQueries({ queryKey: qk.labelsRoot() })
      qc.invalidateQueries({ queryKey: qk.coverage() })
    },
    onError: (err) => setToast({ kind: 'error', text: `CSV 导入失败：${(err as Error).message}` }),
  })

  const counts = summaryQ.data?.counts ?? {}
  // 标签按待复核条数降序（其次按关联总数、再按名称），并提供「有待复核」筛选。
  const labels = useMemo(() => {
    const all = summaryQ.data?.summary ?? []
    const kw = labelFilter.trim()
    return all
      .filter((l) => {
        if (onlyPending && l.pending <= 0) return false
        if (kw && !l.label_name.includes(kw)) return false
        return true
      })
      .sort((a, b) => b.pending - a.pending || b.total - a.total || a.label_name.localeCompare(b.label_name, 'zh-CN'))
  }, [summaryQ.data, labelFilter, onlyPending])

  // 待复核最多的前五个标签（未选择时在右侧呈现，可点击进入）。
  const topPending = useMemo(() => {
    const all = summaryQ.data?.summary ?? []
    return all
      .filter((l) => l.pending > 0)
      .sort((a, b) => b.pending - a.pending || b.total - a.total)
      .slice(0, 5)
  }, [summaryQ.data])

  // T22：筛选 / 开关变化后标签集合会变，回到第 1 页，避免停在越界页看到空列表。
  useEffect(() => { setLabelPage(1) }, [labelFilter, onlyPending])

  // T22：左标签列表分页（每页 LABEL_PAGE_SIZE 行）；页数至少 1，页码做上界钳制。
  const labelPageCount = Math.max(1, Math.ceil(labels.length / LABEL_PAGE_SIZE))
  const labelPageSafe = Math.min(labelPage, labelPageCount)
  const visibleLabels = labels.slice((labelPageSafe - 1) * LABEL_PAGE_SIZE, labelPageSafe * LABEL_PAGE_SIZE)

  /** 作废当前 / 在途的批量预检并关闭确认框（切标签、取消、卸载时调用）。 */
  const invalidateBatch = () => {
    batchSeq.current += 1
    setBatch(null)
  }

  // 卸载时作废在途预检，避免迟到响应在组件卸载后写状态。
  useEffect(() => () => { batchSeq.current += 1 }, [])

  /** 打开批量确认：先预检影响条数（只读，不写库）。
   *
   * 冻结目标：`target` 取自发起预检时的选中标签，并与请求代次一起校验——
   * 只有「仍是同一代次」的响应才会被接受，从而拒绝迟到响应；提交时也用 `target`，
   * 保证「写哪个标签」由弹窗展示的那个标签决定，而不是当前的 `selected`。
   */
  const openBatch = async (decision: string) => {
    if (!selected) return
    const target = selected
    const seq = ++batchSeq.current
    try {
      const pv = await previewDecision({ label_name: target, decision })
      // 拒绝迟到响应：切标签 / 取消 / 再次预检已使本次预检失效 → 丢弃。
      if (seq !== batchSeq.current) return
      setBatch({ decision, target, preview: pv })
    } catch (err) {
      if (seq !== batchSeq.current) return
      setToast({ kind: 'error', text: `预检失败：${(err as Error).message}` })
    }
  }

  const selectedRow = summaryQ.data?.summary.find((l) => l.label_name === selected)
  const itemTotal = itemsQ.data?.total ?? 0
  const itemPageCount = Math.max(1, Math.ceil(itemTotal / ITEM_PAGE_SIZE))

  const pickLabel = (name: string) => {
    // 切换标签 → 作废在途 / 待确认的批量操作，旧弹窗不得继续可确认。
    if (name !== selected) invalidateBatch()
    setSelected(name)
    setPage(1)
    // T24a：窄屏从抽屉里选标签后自动收起抽屉，露出右侧逐条清单（宽屏下为无操作）。
    setLabelsOpen(false)
  }

  const renderLabelButton = (l: LabelSummaryRow, dense = false) => (
    <Button
      key={l.label_id}
      variant="text"
      size="small"
      onClick={() => pickLabel(l.label_name)}
      sx={{
        justifyContent: 'flex-start',
        textTransform: 'none',
        fontWeight: 400,
        color: 'text.primary',
        py: dense ? 0.25 : 0.5,
        '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' },
      }}
    >
      {l.label_name} · 待复核 {l.pending.toLocaleString('zh-CN')}
    </Button>
  )

  /** 左栏「标签汇总」面板（T22 分页；T24a 宽屏内联 / 窄屏抽屉**复用同一份**）。 */
  const labelPanel = (
    <Paper
      variant="outlined"
      sx={{
        // T24a：宽屏（≥1200）常驻定宽 340；窄屏（<1200）放进左侧抽屉，占满抽屉并撑满高度。
        width: narrow ? '100%' : 340,
        flexShrink: 0,
        // 高度按「视口 − 本页头部（标题/计数/口径行 ≈300px）」取，使**列表 + 分页脚**
        // 整体落在 1366×768 首屏内（T22：分页控件不能被挤到折叠线以下）。
        maxHeight: narrow ? 'none' : 'calc(100vh - 300px)',
        flex: narrow ? 1 : undefined,
        minHeight: narrow ? 0 : undefined,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="筛选标签名…"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
        />
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            共 {labels.length} 个标签（按待复核降序）
          </Typography>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Switch size="small" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />}
            label={<Typography variant="caption">有待复核</Typography>}
          />
        </Stack>
      </Box>
      <Divider />
      <List dense sx={{ overflow: 'auto', flex: 1 }}>
        {summaryQ.isLoading && (
          <Box sx={{ p: 2 }}>
            <LoadingState dense label="正在加载标签汇总…" />
          </Box>
        )}
        {summaryQ.isError && (
          <Box sx={{ p: 2 }}>
            <ErrorState
              dense
              error={summaryQ.error}
              title="加载标签汇总失败"
              onRetry={() => summaryQ.refetch()}
            />
          </Box>
        )}
        {/* T22：只渲染**当前页**（每页 LABEL_PAGE_SIZE 行），不再一次铺 183 行。 */}
        {visibleLabels.map((l) => (
          <ListItemButton
            key={l.label_id}
            selected={selected === l.label_name}
            onClick={() => pickLabel(l.label_name)}
          >
            <ListItemText
              primary={l.label_name}
              secondary={`关联 ${l.total.toLocaleString('zh-CN')} 条`}
            />
            {/* T04：原右侧「橙色填充徽章 + 裸数字」与左侧「关联 N 条」是**同一数值渲染两次**
                （实测 4/4 行：`压强 关联 2,378 条 [2378]`），且把中性计数染成了警告橙。
                现改为**行级状态点**：只表状态、不重复数字、不填充底色（规范 §4.2：
                某列同值率过高时不应作逐行徽章；纯数字计数不用 Chip）。 */}
            <LabelReviewDot row={l} />
          </ListItemButton>
        ))}
      </List>
      {/* T22：左标签列表分页（规范 §4.2「行数 >50 必须分页或虚拟滚动」）。 */}
      {labelPageCount > 1 && (
        <>
          <Divider />
          <Box sx={{ p: 0.5, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              size="small"
              page={labelPageSafe}
              count={labelPageCount}
              onChange={(_e, p) => setLabelPage(p)}
              aria-label="标签列表分页"
            />
          </Box>
        </>
      )}
    </Paper>
  )

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" component={pageHeading}>知识点复核</Typography>
        {/* T04：顶部三个是**聚合计数**（题-标签关联条数），不是单项状态 → 一律中性描边，
            不给语义色（语义色只留给「需要立刻行动」的状态，见设计规范 §2.1 颜色铁律 2）。 */}
        <Chip size="small" variant="outlined" label={`待复核 ${(counts['待复核'] ?? 0).toLocaleString('zh-CN')} 条`} />
        <Chip size="small" variant="outlined" label={`已确认 ${(counts['已确认'] ?? 0).toLocaleString('zh-CN')} 条`} />
        <Chip size="small" variant="outlined" label={`已否决 ${(counts['已否决'] ?? 0).toLocaleString('zh-CN')} 条`} />
        <Box sx={{ flex: 1 }} />
        {/* T24a：窄屏（<1200）左栏折叠为左侧抽屉，这里给一个显式入口
            （规范 §2.8 断点 + §3.2 窄屏态「折叠为抽屉，不用常驻横幅」）。 */}
        {narrow && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setLabelsOpen(true)}
            aria-expanded={labelsOpen}
            aria-controls="knowledge-labels-drawer"
          >
            标签列表
          </Button>
        )}
        {/* CSV 导出 / 导入收进「批量处理」菜单 */}
        <Button
          size="small"
          variant="outlined"
          onClick={(e) => setBatchMenuAnchor(e.currentTarget)}
        >
          批量处理
        </Button>
        <Menu
          anchorEl={batchMenuAnchor}
          open={Boolean(batchMenuAnchor)}
          onClose={() => setBatchMenuAnchor(null)}
        >
          <MenuItem
            component="a"
            href={exportReviewUrl('待复核')}
            download
            onClick={() => setBatchMenuAnchor(null)}
          >
            <FileDownloadIcon fontSize="small" style={{ marginRight: 8 }} />
            导出待复核 CSV
          </MenuItem>
          <MenuItem
            disabled={importMut.isPending}
            onClick={() => {
              setBatchMenuAnchor(null)
              fileRef.current?.click()
            }}
          >
            <FileUploadIcon fontSize="small" style={{ marginRight: 8 }} />
            导入复核 CSV
          </MenuItem>
        </Menu>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importMut.mutate(f)
            e.target.value = ''
          }}
        />
      </Stack>

      {/* 口径说明合成一行 + 帮助按钮（删除 CLI 参数说明） */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary">
          知识点为「<strong>提及</strong>」口径：{describeMentionScope()}；下方计数均为「题-标签关联条数」。
        </Typography>
        <Button size="small" onClick={() => setHelpOpen(true)}>
          口径说明
        </Button>
      </Stack>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 1 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}
      {importResult && importResult.errors.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setImportResult(null)}>
          导入跳过 {importResult.skipped} 行，原因（最多 50 条）：
          {importResult.errors.map((e, i) => (
            <div key={i}>· {e}</div>
          ))}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        {/* 左：标签汇总（T24a：窄屏折叠进下方抽屉，此处不内联） */}
        {!narrow && labelPanel}

        {/* 右：逐条复核 / 未选择时展示待复核 Top5 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" component={sectionHeading} fontWeight={600} gutterBottom>
                待复核最多的标签
              </Typography>
              {topPending.length === 0 ? (
                <EmptyState dense title="暂无待复核关联" description="所有关联都已确认或否决；可在左侧查看已确认 / 已否决的标签。" />
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    点击进入逐条复核；也可从左侧选择任意标签。
                  </Typography>
                  <Stack alignItems="flex-start">
                    {topPending.map((l) => renderLabelButton(l))}
                  </Stack>
                </>
              )}
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1" component={sectionHeading} fontWeight={600}>
                  {selected}
                </Typography>
                {selectedRow && (
                  <Typography variant="body2" color="text.secondary">
                    关联 {selectedRow.total} 条 · 待复核 {selectedRow.pending} · 已确认 {selectedRow.confirmed} · 已否决 {selectedRow.rejected}
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  color="success"
                  variant="outlined"
                  startIcon={<CheckCircleOutlineIcon />}
                  disabled={decideMut.isPending}
                  onClick={() => openBatch('确认')}
                >
                  批量确认待复核
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<CancelOutlinedIcon />}
                  disabled={decideMut.isPending}
                  onClick={() => openBatch('否决')}
                >
                  批量否决待复核
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                {STATUS_TABS.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    color={itemStatus === t.key ? 'primary' : 'default'}
                    variant={itemStatus === t.key ? 'filled' : 'outlined'}
                    onClick={() => {
                      setItemStatus(t.key)
                      setPage(1)
                    }}
                  />
                ))}
              </Stack>

              {itemsQ.isLoading && <LoadingState label="正在加载逐条清单…" />}
              {itemsQ.isError && (
                <ErrorState
                  error={itemsQ.error}
                  title="加载逐条清单失败"
                  onRetry={() => itemsQ.refetch()}
                />
              )}
              {itemsQ.data && itemsQ.data.items.length === 0 && (
                <EmptyState dense title={`该标签下没有「${itemStatus}」的关联`} />
              )}

              <Stack divider={<Divider flexItem />} spacing={0}>
                {itemsQ.data?.items.map((it) => (
                  <Box key={it.question_id} sx={{ py: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`题 ${it.number ?? it.question_id}`}
                        onClick={() => navigate(`/question/${it.question_id}`)}
                        sx={{ cursor: 'pointer' }}
                      />
                      <LabelStatusMarker status={it.review_status} activeStatus={itemStatus} />
                      {it.source && <Chip size="small" variant="outlined" label={it.source} />}
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        color="success"
                        disabled={decideMut.isPending || it.review_status === '已确认'}
                        onClick={() =>
                          decideMut.mutate({ label_name: selected, decision: '确认', question_id: it.question_id })
                        }
                      >
                        确认
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={decideMut.isPending || it.review_status === '已否决'}
                        onClick={() =>
                          decideMut.mutate({ label_name: selected, decision: '否决', question_id: it.question_id })
                        }
                      >
                        否决
                      </Button>
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, cursor: 'pointer' }}
                      onClick={() => navigate(`/question/${it.question_id}`)}
                    >
                      {it.snippet || '（无题干片段）'}
                    </Typography>
                  </Box>
                ))}
              </Stack>

              {itemPageCount > 1 && (
                <Stack alignItems="center" sx={{ mt: 2 }}>
                  <Pagination page={page} count={itemPageCount} onChange={(_e, p) => setPage(p)} color="primary" />
                </Stack>
              )}
            </Paper>
          )}
        </Box>
      </Box>

      {/* T24a：窄屏（<1200）左栏折叠为左侧抽屉（规范 §2.8 断点 + §3.2 窄屏态）。
          ⚠️ 顶栏 AppBar 的 zIndex 比 Drawer 高（项目刻意设置），会遮住抽屉顶部 →
          按 MUI 惯例放 `<Toolbar variant="dense" />` 占位，把内容推到顶栏之下（§2.7）。 */}
      {narrow && (
        <Drawer
          id="knowledge-labels-drawer"
          anchor="left"
          open={labelsOpen}
          onClose={() => setLabelsOpen(false)}
          PaperProps={{ role: 'dialog', 'aria-labelledby': 'knowledge-labels-drawer-title' }}
        >
          <Box sx={{ width: '86vw', maxWidth: 360, height: '100%', p: 1.5, display: 'flex', flexDirection: 'column' }}>
            <Toolbar variant="dense" />
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography id="knowledge-labels-drawer-title" variant="subtitle1" component="h2" sx={{ flex: 1 }}>
                标签
              </Typography>
              <Button size="small" onClick={() => setLabelsOpen(false)}>关闭</Button>
            </Stack>
            {labelPanel}
          </Box>
        </Drawer>
      )}

      {/* 口径帮助：说明「提及」口径与严格模式（不含 CLI 参数） */}
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>知识点口径说明</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {describeMentionScope()}。系统自动识别题干中<strong>出现过</strong>的知识词，
            <strong>不代表</strong>本题在<strong>考查</strong>它（平均 4.26 个/题，可能误标）。
            例如一道「原子结构」题因选项出现「太阳系」被打上「太阳系」标签。
          </Typography>
          <Typography variant="body2">
            检索页的「仅看已确认知识点」开关<strong>默认关闭</strong>；复核完成前请保持关闭，
            否则检索结果会缺少尚未确认的知识点。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => navigate('/search')}>去检索页</Button>
          <Button onClick={() => setHelpOpen(false)}>知道了</Button>
        </DialogActions>
      </Dialog>

      {/* 批量二次确认：显示影响条数 */}
      <ConfirmDialog
        open={batch !== null}
        title={batch?.decision === '否决' ? '批量否决确认' : '批量确认确认'}
        impactPrefix={batch?.decision === '否决' ? '将否决' : '将确认'}
        impactCount={batch?.preview.will_update ?? 0}
        impactLabel="条关联"
        confirmText={batch?.decision === '否决' ? '确认否决' : '确认'}
        confirmColor={batch?.decision === '否决' ? 'error' : 'success'}
        loading={decideMut.isPending}
        onCancel={invalidateBatch}
        onConfirm={() => {
          // 提交与展示同源：写 `batch.target`（弹窗展示的标签），不读当前选中。
          if (batch) {
            decideMut.mutate({ label_name: batch.target, decision: batch.decision, confirm: true })
          }
        }}
      >
        标签「{batch?.target}」共命中 {batch?.preview.matched.toLocaleString('zh-CN')} 条关联，
        其中 {batch?.preview.pending.toLocaleString('zh-CN')} 条为「待复核」。
        批量操作<strong>只处理待复核项，绝不覆盖已有决定</strong>（如需覆盖请使用强制模式）。
      </ConfirmDialog>
    </Box>
  )
}
