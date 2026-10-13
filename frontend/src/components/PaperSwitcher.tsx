/**
 * PaperSwitcher —— **全局顶栏**试卷切换器（P3 §5-Q8「多份试卷并行」；P1-6 提升为全站可达）。
 *
 * 原仅出现在组卷工作台顶部，其它页面要换试卷必须先回组卷页；现提升到全局 `AppBar`，
 * 让**任意页面**都能一键切换 / 新建试卷。
 *  - 下拉一键切换当前试卷，每项显示「题数 · 总分 · 未设分」；
 *  - 保留「试卷列表」入口（新建 / 选择）。
 *
 * 仅承载 UI 选择，数据由父级（react-query）提供；**不缓存整卷内容**（沿用 paperStore 约定）。
 * 因宿主是深色 `primary.main` 顶栏，文本/描边统一用 `inherit`（白色）保证对比度。
 */
import { Box, Button, Chip, IconButton, MenuItem, Select, Stack } from '@mui/material'
import ListAltIcon from '@mui/icons-material/ListAlt'
import type { Paper } from '../api/types'

export interface PaperSwitcherProps {
  /** 试卷列表（含题数 / 总分 / 未设分统计）。 */
  papers: Paper[]
  currentPaperId: number | null
  onSwitch: (id: number) => void
  onOpenList: () => void
  /** 窄屏（AppBar 空间紧张）：隐藏统计 Chip、缩窄下拉、列表入口改为图标按钮。 */
  compact?: boolean
}

/** 全局顶栏试卷切换器。 */
export function PaperSwitcher({ papers, currentPaperId, onSwitch, onOpenList, compact = false }: PaperSwitcherProps) {
  const current = papers.find((p) => p.id === currentPaperId) ?? null
  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ minWidth: 0 }}>
      <Select
        size="small"
        value={currentPaperId ?? ''}
        displayEmpty
        onChange={(e) => onSwitch(Number(e.target.value))}
        sx={{
          minWidth: compact ? 132 : 260,
          maxWidth: compact ? 200 : 360,
          color: 'inherit',
          // ⚠️ 这里曾把描边与下拉箭头**硬写成白色系**（`rgba(255,255,255,0.5)` / `#fff`），
          //    理由是「深色顶栏」。但顶栏后来改成了**纸面白**（对齐参考截图的设计语言），
          //    于是白描边压在白底上 —— **输入框描边与键盘焦点环完全不可见**。
          //    （做「硬编码颜色清零」时才发现的真实缺陷；本地版看不到是因为它一直在浅色顶栏上。）
          //    现在交回 MUI 默认（取 palette 语义槽），不再硬编码颜色。
          '& .MuiSelect-select': { color: 'inherit' },
          '& .MuiSvgIcon-root': { color: 'inherit' },
        }}
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
      {!compact && current && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Chip size="small" variant="outlined" sx={{ color: 'inherit', borderColor: 'currentColor' }} label={`${current.item_count ?? 0} 题`} />
          <Chip size="small" variant="outlined" sx={{ color: 'inherit', borderColor: 'currentColor' }} label={`${current.total_score ?? 0} 分`} />
          {(current.unscored_count ?? 0) > 0 && (
            <Chip size="small" color="warning" variant="outlined" label={`未设分 ${current.unscored_count}`} />
          )}
        </Box>
      )}
      {compact ? (
        <IconButton size="small" color="inherit" aria-label="试卷列表" onClick={onOpenList} data-testid="open-paper-list">
          <ListAltIcon fontSize="small" />
        </IconButton>
      ) : (
        <>
          <Box sx={{ flex: 1 }} />
          <Button size="small" color="inherit" startIcon={<ListAltIcon />} onClick={onOpenList}>
            试卷列表
          </Button>
        </>
      )}
    </Stack>
  )
}

export default PaperSwitcher
