/** 试卷条目行（R2 从 `PaperPanel.tsx` 抽出）。
 *
 * 单条可拖拽条目：题序 / 预览 / 分值 chip / 状态徽章 / `⋮` 菜单（上移/下移/设分/详情/移除）。
 * 由 `PaperPanel` 在 `SortableContext` 内渲染。
 */
import { useState } from 'react'
import {
  Box,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ArticleIcon from '@mui/icons-material/Article'
import EditIcon from '@mui/icons-material/Edit'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PaperItem, ExportQuestion } from '../api/types'
import { IssueDetails } from './livePreview/ExportDiagnostics'
import { AnswerBadge } from './StatusBadges'

/** 判断条目快照是否落后于题库当前版本。
 *
 * `GET /api/papers/{id}` 的 item 已下发布尔标志 `stale`（当前 version ≠ 快照 question_version），
 * 据此点亮「题库已更新，本卷仍用加入时的版本」提示 + 刷新快照按钮。
 */
export function isStale(item: PaperItem): boolean {
  return item.stale === true
}

export function SortableItemRow({
  item,
  seq,
  canUp,
  canDown,
  onUp,
  onDown,
  onRemove,
  onScore,
  onDetail,
  contentQuestion,
}: {
  item: PaperItem
  seq: number
  canUp: boolean
  canDown: boolean
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onScore: () => void
  onDetail: () => void
  contentQuestion?: ExportQuestion
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item-${item.id}`,
    data: { type: 'paper-item', itemId: item.id, sectionId: item.section_id },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  }
  const preview = (contentQuestion ? contentQuestion.content_blocks.filter(b => b.kind === 'paragraph' && b.branch === 'stem').map(b => b.kind === 'paragraph' ? b.text : '').join(' ') || contentQuestion.issues[0]?.summary || '内容待核对' : '正在核对锁定内容…').replace(/\s+/g, ' ').trim()

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        p: 0.75,
        borderRadius: 1,
        border: '1px solid',
        borderColor: isStale(item) ? 'warning.main' : 'divider',
        bgcolor: 'background.paper',
        mb: 0.75,
      }}
    >
      <Tooltip title="拖拽排序">
        <DragIndicatorIcon
          fontSize="small"
          sx={{ color: 'text.disabled', mt: 0.25, cursor: 'grab' }}
          {...attributes}
          {...listeners}
        />
      </Tooltip>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" fontWeight={600} color="primary">
            {seq}.
          </Typography>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 80 }} noWrap title={preview}>
            {preview || `题 ${item.number ?? item.question_id}`}
          </Typography>
          <Chip
            size="small"
            variant={item.score == null ? 'outlined' : 'filled'}
            color={item.score == null ? 'default' : 'primary'}
            label={item.score == null ? '未设分' : `${item.score} 分`}
            onClick={onScore}
          />
          {!item.has_answer && <AnswerBadge hasAnswer={false} />}
          {isStale(item) && (
            <Tooltip title="题库中该题已更新，本卷仍使用加入时的版本（快照锁定）">
              <Chip size="small" color="warning" label="题库已更新" />
            </Tooltip>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">item {item.id} · qid {item.question_id} · 锁定 v{item.question_version}</Typography>
        {contentQuestion?.issues.length ? <Box component="details"><summary>本项问题（{contentQuestion.issues.length}）</summary>{contentQuestion.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}</Box> : null}
      </Box>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="条目菜单">
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          disabled={!canUp}
          onClick={() => {
            setAnchor(null)
            onUp()
          }}
        >
          <ListItemIcon>
            <ArrowUpwardIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>上移</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={!canDown}
          onClick={() => {
            setAnchor(null)
            onDown()
          }}
        >
          <ListItemIcon>
            <ArrowDownwardIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>下移</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onScore()
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>设置分值</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onDetail()
          }}
        >
          <ListItemIcon>
            <ArticleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>查看详情</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onRemove()
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>移除</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}

export default SortableItemRow
