/**
 * PaperSwitcher —— 组卷工作台**顶部试卷切换器**（P3，§5-Q8 附「多份试卷并行」）。
 *
 * 把原本藏在左抽屉里的「试卷列表」入口**显性化**到工作台顶部：
 *  - 下拉一键切换当前试卷，每项显示「题数 · 总分 · 未设分」；
 *  - 保留「试卷列表」按钮（新建 / 删除）入口。
 *
 * 仅承载 UI 选择，数据由父级（react-query）提供；**不缓存整卷内容**（沿用 paperStore 约定）。
 */
import { Box, Button, Chip, MenuItem, Select, Stack } from '@mui/material'
import ListAltIcon from '@mui/icons-material/ListAlt'
import type { Paper } from '../api/types'

export interface PaperSwitcherProps {
  /** 试卷列表（含题数 / 总分 / 未设分统计）。 */
  papers: Paper[]
  currentPaperId: number | null
  onSwitch: (id: number) => void
  onOpenList: () => void
}

/** 顶部试卷切换器。 */
export function PaperSwitcher({ papers, currentPaperId, onSwitch, onOpenList }: PaperSwitcherProps) {
  const current = papers.find((p) => p.id === currentPaperId) ?? null
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Select
        size="small"
        value={currentPaperId ?? ''}
        displayEmpty
        onChange={(e) => onSwitch(Number(e.target.value))}
        sx={{ minWidth: 260 }}
        data-testid="paper-switcher"
        renderValue={() =>
          current ? current.title : currentPaperId != null ? `试卷 #${currentPaperId}` : '选择试卷…'
        }
      >
        {papers.length === 0 && (
          <MenuItem value="" disabled>
            还没有试卷，请新建
          </MenuItem>
        )}
        {papers.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.title}（{p.item_count ?? 0} 题 · {p.total_score ?? 0} 分
            {(p.unscored_count ?? 0) > 0 ? ` · 未设分 ${p.unscored_count}` : ''}）
          </MenuItem>
        ))}
      </Select>
      {current && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Chip size="small" variant="outlined" label={`${current.item_count ?? 0} 题`} />
          <Chip size="small" variant="outlined" label={`${current.total_score ?? 0} 分`} />
          {(current.unscored_count ?? 0) > 0 && (
            <Chip size="small" color="warning" variant="outlined" label={`未设分 ${current.unscored_count}`} />
          )}
        </Box>
      )}
      <Box sx={{ flex: 1 }} />
      <Button size="small" startIcon={<ListAltIcon />} onClick={onOpenList}>
        试卷列表
      </Button>
    </Stack>
  )
}

export default PaperSwitcher
