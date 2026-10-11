/** 当前筛选漏掉的年级未标注题：不推断归属，提供保留其他条件的查看入口。 */
import { Alert, Button } from '@mui/material'
import type { SearchParams } from '../api/search'
import type { SearchResult } from '../api/types'

export interface GradeGapNoticeProps {
  gap?: SearchResult['grade_gap']
  filters: SearchParams
  /** 切换筛选或分页时隐藏旧结果提示，避免把旧计数用于新条件。 */
  pending: boolean
  onChange: (patch: Partial<SearchParams>) => void
}

export function GradeGapNotice({ gap, filters, pending, onChange }: GradeGapNoticeProps) {
  if (pending || !filters.grade || filters.grade_missing || !gap || gap.count <= 0 || gap.selected_grade !== filters.grade) return null
  return (
    <Alert
      severity="warning"
      sx={{ mb: 1 }}
      data-testid="grade-gap-notice"
      action={
        <Button
          color="inherit"
          size="small"
          sx={{ whiteSpace: 'nowrap' }}
          onClick={() => onChange({ grade: undefined, grade_missing: true })}
        >
          查看未标注年级的题
        </Button>
      }
    >
      另有 {gap.count.toLocaleString('zh-CN')} 道年级未标注的题符合其他检索条件，未参与本次年级筛选。
      这些题的年级尚未确认，不代表属于「{gap.selected_grade}」。点击查看会保留关键词和其他筛选条件。
    </Alert>
  )
}
