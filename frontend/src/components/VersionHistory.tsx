/** 只读版本历史（P0-5 / PRD 3.2）。
 *
 * 硬约束：**只读，不提供「恢复到此版本」按钮**（用户已确认不做回滚界面）。
 * 每条显示：版本号 + 时间 + 字数 + 变更来源；展开后只读查看该版题干/答案/解析/公式数。
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { getVersion } from '../api/questions'
import type { QuestionVersionRow } from '../api/types'
import { FormulaText } from './KatexFormula'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { qk } from '../api/queryKeys'

function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 19)
}

/** 单条版本：折叠时只显示摘要；展开时**只读**拉取该版完整快照。 */
function VersionRow({
  questionId,
  row,
  expanded,
  onToggle,
}: {
  questionId: number
  row: QuestionVersionRow
  expanded: boolean
  onToggle: () => void
}) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.questionVersion(questionId, row.version),
    queryFn: () => getVersion(questionId, row.version),
    enabled: expanded,
    staleTime: Infinity,
  })

  return (
    <Accordion expanded={expanded} onChange={onToggle} disableGutters elevation={0}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip size="small" label={`v${row.version}`} color="primary" variant="outlined" />
          <Typography variant="body2" color="text.secondary">
            {fmtTime(row.created_at)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            字数 {row.char_length ?? '—'}
          </Typography>
          {row.change_source && (
            <Chip size="small" variant="outlined" label={row.change_source} />
          )}
          {row.note && (
            <Typography variant="body2" color="text.secondary">
              {row.note}
            </Typography>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {isLoading && <LoadingState dense size={16} label="正在读取该版快照…" />}
        {isError && (
          <ErrorState
            dense
            error={error ?? new Error('未知错误')}
            title="读取失败"
            onRetry={() => refetch()}
          />
        )}
        {data && (
          <Box>
            <Typography variant="subtitle2" component="div" gutterBottom>
              题干（只读）
            </Typography>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 1.5 }}>
              <FormulaText
                text={data.text ?? data.snapshot?.text}
                formulas={data.snapshot?.formulas}
              />
            </Box>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Box>
                <Typography variant="subtitle2" component="div" gutterBottom>
                  答案
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.snapshot?.answer || '（无）'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" component="div" gutterBottom>
                  解析
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.snapshot?.analysis || '（无）'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" component="div" gutterBottom>
                  公式
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.snapshot?.formulas?.length ?? 0} 条
                </Typography>
              </Box>
            </Stack>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  )
}

export interface VersionHistoryProps {
  questionId: number
  versions?: QuestionVersionRow[] | null
}

/** 版本历史列表（只读）。 */
export function VersionHistory({ questionId, versions }: VersionHistoryProps) {
  const [openVersion, setOpenVersion] = useState<number | null>(null)
  const rows = versions ?? []

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        系统会自动保留每次编辑前的旧版，<strong>仅供查看，不提供一键回滚</strong>。
      </Typography>
      {rows.length === 0 ? (
        <EmptyState dense title="暂无版本记录" />
      ) : (
        <List disablePadding>
          {rows
            .slice()
            .sort((a, b) => b.version - a.version)
            .map((row) => (
              <ListItem key={row.version} disablePadding sx={{ display: 'block' }}>
                <VersionRow
                  questionId={questionId}
                  row={row}
                  expanded={openVersion === row.version}
                  onToggle={() =>
                    setOpenVersion((v) => (v === row.version ? null : row.version))
                  }
                />
              </ListItem>
            ))}
        </List>
      )}
      <Divider sx={{ mt: 1 }} />
    </Box>
  )
}

export default VersionHistory
