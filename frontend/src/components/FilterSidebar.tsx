/** 左侧固定筛选栏（P0-2 / PRD 4「筛选栏」/ PRD 5.1–5.3）。
 *
 * 每个维度为可折叠分组，选项后带**计数**，并**单列「待补充 (n)」桶**（缺失元数据）。
 * 维度旁显示**覆盖率徽标**。默认**不预选**任何值（= 全库）。
 * 知识点维度标签写作「知识点（提及）」，并提供「仅看已确认知识点」严格模式开关（默认关闭）。
 */
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { CoverageBucket, FacetDimension, FacetsData } from '../api/types'
import type { SearchParams } from '../api/search'

/** 维度定义：key 与后端 facets 维度名一致。 */
interface DimDef {
  key: string
  label: string
  /** 是否支持「待补充」桶筛选（依赖后端 `<key>_missing` 参数）。 */
  missingKey?: keyof SearchParams
}

const DIMENSIONS: DimDef[] = [
  { key: 'stage', label: '学段' },
  { key: 'subject', label: '学科' },
  { key: 'grade', label: '年级', missingKey: 'grade_missing' },
  { key: 'textbook', label: '教材', missingKey: 'textbook_missing' },
  { key: 'chapter', label: '章节', missingKey: 'chapter_missing' },
  { key: 'qtype', label: '题型', missingKey: 'qtype_missing' },
  { key: 'difficulty', label: '难度', missingKey: 'difficulty_missing' },
]

export interface FilterSidebarProps {
  facets?: FacetsData | null
  loading?: boolean
  filters: SearchParams
  onChange: (patch: Partial<SearchParams>) => void
  strictKp: boolean
  onStrictKpChange: (v: boolean) => void
  onReset: () => void
}

function coverageOf(facets: FacetsData | null | undefined, key: string): CoverageBucket | undefined {
  if (!facets?.coverage) return undefined
  const c = facets.coverage as unknown as Record<string, CoverageBucket | undefined>
  return c[key]
}

/**
 * 该维度在库中**是否有可用取值**（P0-5）。
 *
 * 背景：难度字段全库 **100% 未标注**（源数据无难度），但筛选栏仍提供「难度」维度 →
 * 老师点了筛不出任何结果，会误判成「系统坏了 / 题库没题」，而不是「数据没标」。
 *
 * 判定：`items` 为空即无可用取值（只剩「待补充」桶）。
 * **未知（尚未加载，bucket 为 undefined）时不判定为不可用**，避免加载期间闪现「暂不可用」。
 */
function dimensionUsable(bucket?: FacetDimension): boolean {
  if (!bucket) return true
  return bucket.items.length > 0
}

/** 维度帮助：覆盖率数值与「按它筛会漏题」的说明收进悬浮说明（B2 §3.3 帮助化）。
 *
 * 此前这些说明**直接铺在筛选栏里**（每个维度一个覆盖率徽标 + 年级/教材/章节一段橙色长文），
 * 视觉噪声大。改为默认只留一个小「i」，把数值和解释放到悬浮说明里；
 * **影响当前筛选结果的漏题事实**仍由结果区的 {@link GradeGapNotice} 实时显露，不随这里藏掉。
 */
function DimHelp({ label, bucket }: { label: string; bucket?: CoverageBucket }) {
  const lines: string[] = []
  if (bucket) {
    lines.push(
      `${label}有值的题占全库 ${bucket.pct}%（${(bucket.n ?? 0).toLocaleString('zh-CN')}/${(bucket.total ?? 0).toLocaleString('zh-CN')}）。`,
    )
  }
  lines.push('缺失元数据的题仍可被关键词检索命中，只是无法按此维度筛出。')
  if (['年级', '教材', '章节'].includes(label) && bucket && (bucket.n ?? 0) < (bucket.total ?? 0)) {
    lines.push(
      `按具体${label}筛选会漏掉 ${((bucket.total ?? 0) - (bucket.n ?? 0)).toLocaleString('zh-CN')} 道未标注题；可选「全部」配合关键词查找，或选「待补充」。`,
    )
  }
  return (
    <Tooltip title={lines.join('')}>
      {/* 阻止点击冒泡到 AccordionSummary，避免点「说明」把分组一起开合。 */}
      <IconButton
        size="small"
        aria-label={`${label}覆盖率说明`}
        sx={{ p: 0.25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
      </IconButton>
    </Tooltip>
  )
}

/** 左侧固定筛选栏。 */
export function FilterSidebar({
  facets,
  loading,
  filters,
  onChange,
  strictKp,
  onStrictKpChange,
  onReset,
}: FilterSidebarProps) {
  const dims = facets?.dimensions ?? {}
  const activeMissing = DIMENSIONS.filter((d) => d.missingKey && filters[d.missingKey])

  return (
    <Box sx={{ width: 248, flexShrink: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        {/* P5-3：筛选栏面板小标题，显式降为 <div>，避免与页面 h1 形成 h1→h6 跳级（视觉不变）。 */}
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Typography variant="subtitle2" component="div">筛选</Typography>
          {/* 说明帮助化（B2 §3.3）：默认不把整段「默认不预选…」铺在筛选栏里，收进悬浮说明。 */}
          <Tooltip title="默认不预选任何筛选条件（= 全库）；缺失元数据单列「待补充」桶，避免系统性漏题。">
            <IconButton size="small" aria-label="筛选说明" sx={{ p: 0.25 }}>
              <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <Chip size="small" variant="outlined" label="重置" onClick={onReset} />
      </Stack>

      {activeMissing.length > 0 && (
        <Alert severity="info" sx={{ mb: 1, py: 0.25 }}>
          已启用「待补充」筛选（{activeMissing.map((d) => d.label).join('、')}）。
          这些题尚未标注相应信息，可进入详情页补充。
        </Alert>
      )}

      {/* 答案 / 解析 / 公式 快捷开关 */}
      <Accordion defaultExpanded disableGutters elevation={0}
        sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" fontWeight={600}>状态</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={0.5}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={filters.has_answer === true}
                  onChange={(e) => onChange({ has_answer: e.target.checked ? true : undefined })}
                />
              }
              label={
                <Typography variant="body2">
                  仅看有答案
                  {facets?.has_answer && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}（{facets.has_answer['有答案']?.toLocaleString('zh-CN') ?? 0}）
                    </Typography>
                  )}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={filters.has_analysis === true}
                  onChange={(e) => onChange({ has_analysis: e.target.checked ? true : undefined })}
                />
              }
              label={
                <Typography variant="body2">
                  仅看有解析
                  {facets?.has_analysis && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}（{facets.has_analysis['有解析']?.toLocaleString('zh-CN') ?? 0}）
                    </Typography>
                  )}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={filters.needs_review === true}
                  onChange={(e) => onChange({ needs_review: e.target.checked ? true : undefined })}
                />
              }
              label={
                <Typography variant="body2">
                  仅看含待复核公式
                  {facets?.needs_review && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}（{facets.needs_review['待复核']?.toLocaleString('zh-CN') ?? 0}）
                    </Typography>
                  )}
                </Typography>
              }
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* 知识点（提及）维度 */}
      <Accordion defaultExpanded disableGutters elevation={0}
        sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" fontWeight={600}>知识点（搜索线索）</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            系统自动识别题干中<strong>出现过</strong>的知识词，<strong>不代表</strong>本题在考查它
            （平均 4.26 个/题，可能误标）。
          </Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={strictKp}
                onChange={(e) => onStrictKpChange(e.target.checked)}
              />
            }
            label={<Typography variant="body2">仅看已确认知识点</Typography>}
          />
          {/* B2 §3.3：严格模式状态就地显示在知识点筛选旁（原在搜索框右侧另起一条 Alert）。 */}
          {strictKp && (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label="严格模式已启用"
              sx={{ mt: 0.5, height: 20, fontSize: 11 }}
              data-testid="strict-kp-active"
            />
          )}
          {facets?.coverage?.label_status && (
            <Typography variant="caption" color="text.secondary" display="block">
              已确认 {(facets.coverage.label_status['已确认'] ?? 0).toLocaleString('zh-CN')} / 待复核{' '}
              {(facets.coverage.label_status['待复核'] ?? 0).toLocaleString('zh-CN')}
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>

      {/* 各维度 */}
      {DIMENSIONS.map((dim) => {
        const bucket = dims[dim.key]
        const selected = (filters as Record<string, unknown>)[dim.key] as string | undefined
        const missingSelected = dim.missingKey ? Boolean(filters[dim.missingKey]) : false
        const cov = coverageOf(facets, dim.key)
        const usable = dimensionUsable(bucket)
        return (
          <Accordion key={dim.key} data-testid={`filter-dim-${dim.key}`}
            defaultExpanded={usable} disableGutters elevation={0}
            sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {dim.label}
                </Typography>
                <DimHelp label={dim.label} bucket={cov} />
                {!usable && (
                  <Chip size="small" variant="outlined" label="暂不可用"
                    sx={{ height: 20, fontSize: 11 }} />
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {!usable ? (
                // P0-5：无标注数据的维度 → 明确说明原因并给出出路，而不是给一排筛不出结果的按钮。
                <Alert severity="info" sx={{ py: 0.25 }}>
                  题库中「{dim.label}」尚无标注数据（覆盖率 {cov?.pct ?? 0}%），
                  按它筛选不会有结果。请改用关键词检索
                  {(selected || missingSelected) ? '，或清除下面已选的条件' : ''}。
                  {(selected || missingSelected) && (
                    <Box sx={{ mt: 0.5 }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label="清除该筛选"
                        onClick={() =>
                          onChange({
                            [dim.key]: undefined,
                            ...(dim.missingKey ? { [dim.missingKey]: undefined } : {}),
                          } as Partial<SearchParams>)
                        }
                      />
                    </Box>
                  )}
                </Alert>
              ) : (
                <>
                  {/* B2 §3.3：原「年级覆盖率 17.6%；按具体年级筛选会漏掉 N 道未标注题」的橙色长文
                      已收进维度标题旁的帮助说明（DimHelp）。当前筛选条件下真正漏掉的题数
                      由结果区的 GradeGapNotice 实时显露，不随这里一起藏掉。 */}
                  {loading && <Skeleton variant="rounded" height={28} />}
                  {!loading && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        label="全部"
                        color={!selected && !missingSelected ? 'primary' : 'default'}
                        variant={!selected && !missingSelected ? 'filled' : 'outlined'}
                        onClick={() => onChange({ [dim.key]: undefined, ...(dim.missingKey ? { [dim.missingKey]: undefined } : {}) } as Partial<SearchParams>)}
                      />
                      {(bucket?.items ?? []).slice(0, 30).map((it) => (
                        <Chip
                          key={it.key}
                          size="small"
                          label={`${it.key} (${it.count.toLocaleString('zh-CN')})`}
                          color={selected === it.key ? 'primary' : 'default'}
                          variant={selected === it.key ? 'filled' : 'outlined'}
                          onClick={() =>
                            onChange({
                              [dim.key]: selected === it.key ? undefined : it.key,
                              ...(dim.missingKey ? { [dim.missingKey]: undefined } : {}),
                            } as Partial<SearchParams>)
                          }
                        />
                      ))}
                      {dim.missingKey && (bucket?.missing ?? 0) > 0 && (
                        <Tooltip title="筛出该维度缺失元数据的题，便于逐题补充">
                          <Chip
                            size="small"
                            label={`待补充 (${(bucket?.missing ?? 0).toLocaleString('zh-CN')})`}
                            color={missingSelected ? 'warning' : 'default'}
                            variant={missingSelected ? 'filled' : 'outlined'}
                            onClick={() =>
                              onChange({
                                [dim.key]: undefined,
                                [dim.missingKey as string]: missingSelected ? undefined : true,
                              } as Partial<SearchParams>)
                            }
                          />
                        </Tooltip>
                      )}
                    </Stack>
                  )}
                </>
              )}
            </AccordionDetails>
          </Accordion>
        )
      })}

      <Divider sx={{ my: 1 }} />
      {/* B2 §3.3：原「默认不预选任何筛选条件（= 全库）…」的常驻说明已收进标题旁的帮助（见上）。
          此处只留一个可触达的帮助入口，默认不占版面。 */}
      <Stack direction="row" spacing={0.25} alignItems="center">
        <Tooltip title="默认不预选任何筛选条件（= 全库）；缺失元数据单列「待补充」桶，避免系统性漏题。">
          <IconButton size="small" aria-label="筛选行为说明" sx={{ p: 0.25 }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" color="text.secondary">
          筛选说明
        </Typography>
      </Stack>
    </Box>
  )
}

export default FilterSidebar
