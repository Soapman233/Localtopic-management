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
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { CoverageBucket, FacetsData } from '../api/types'
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

/** 覆盖率徽标：按后端动态统计显示当前维度覆盖率，不硬编码历史题量。 */
function CoverageChip({ bucket, label }: { bucket?: CoverageBucket; label: string }) {
  if (!bucket) return null
  return (
    <Tooltip title={`${label}有值的题占全库比例；缺失元数据的题仍可被关键词检索命中，只是无法按此维度筛出`}>
      <Chip
        size="small"
        variant="outlined"
        label={`${label} ${bucket.pct}%`}
        sx={{ height: 20, fontSize: 11 }}
      />
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
        <Typography variant="subtitle2">筛选</Typography>
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
          <Typography variant="body2" fontWeight={600}>知识点（提及）</Typography>
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
        return (
          <Accordion key={dim.key} defaultExpanded disableGutters elevation={0}
            sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {dim.label}
                </Typography>
                <CoverageChip bucket={cov} label={dim.label} />
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {['grade', 'textbook', 'chapter'].includes(dim.key) && cov && cov.n < cov.total && (
                <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1 }}>
                  {dim.label}覆盖率 {cov.pct}%；按具体{dim.label}筛选会漏掉
                  {(cov.total - cov.n).toLocaleString('zh-CN')} 道未标注题。
                  可选「全部」配合关键词查找，或选「待补充」。
                </Typography>
              )}
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
            </AccordionDetails>
          </Accordion>
        )
      })}

      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary">
        默认不预选任何筛选条件（= 全库）；缺失元数据单列「待补充」桶，避免系统性漏题。
      </Typography>
    </Box>
  )
}

export default FilterSidebar
