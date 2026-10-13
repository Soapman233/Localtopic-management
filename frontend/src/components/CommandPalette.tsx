/**
 * 全局快速跳转 / 搜索面板（⌘K / Ctrl+K，设计规范 §4 P2）。
 *
 * 参考截图 5/6 里都有这个：一个快捷键唤起的浮层，输入即筛页面、回车即跳转，
 * 不用回到侧栏找入口。
 *
 * 三条设计决定
 * ------------
 * 1. **目的地由 `ROUTE_TITLES` 派生**，不反向依赖 `App.tsx`（否则组件 → 外壳 →
 *    组件形成依赖环，且懒加载页面会多拽一份外壳）。
 * 2. **输入非空时，第一项是「搜索题目「xxx」」**——跳到找题页并带上关键词。
 *    只列页面而不真搜，就只是「快捷导航」，挂「搜索」的名不副实。
 * 3. **键盘与读屏可用**：ARIA 1.2 combobox 模式（`role="combobox"` +
 *    `aria-activedescendant` 指向 `role="option"`），↑↓ 选择、Enter 打开、Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { ROUTE_TITLES } from '../lib/routeMeta'
import { GLOSSARY, describePaletteSearch } from '../lib/glossary'

/** 面板里可跳转的页面（按使用频率排序，与侧栏「日常优先」的口径一致）。 */
const PALETTE_PREFIXES = [
  'builder',
  'search',
  'import',
  'export',
  'manage/knowledge',
  'manage/formula-review',
  'manage/sources',
  'manage/stats',
  'settings',
]

/** 一条面板条目。 */
export interface PaletteItem {
  /** 稳定 id（React key 与 aria-activedescendant 用）。 */
  id: string
  label: string
  /** 跳转目标路径。 */
  to: string
  /** 次要说明。 */
  hint?: string
}

/**
 * 由查询串构造条目列表（**纯函数，便于单测**）。
 *
 * 规则：输入非空 → 首项为「搜索题目「q」」，其余为匹配的页面。
 * 匹配范围是**标题 + 路径**（所以输入 `manage`、`stats` 这类英文路径也能命中）。
 *
 * ⚠️ 搜索项的 URL 参数必须是 **`keyword`**：找题页的 `useQuestionFilters` 就是从
 * `?keyword=` 还原条件的（`src/hooks/useQuestionFilters.ts`）。自造一个 `?q=` 会
 * 「看起来能跳转、其实条件没带上」——正是本项目最忌讳的「假通过」。
 */
export function buildPaletteItems(query: string): PaletteItem[] {
  const q = query.trim()
  const items: PaletteItem[] = []

  if (q) {
    items.push({
      id: 'action-search',
      label: describePaletteSearch(q),
      to: `/search?keyword=${encodeURIComponent(q)}`,
      hint: '找题',
    })
  }

  const needle = q.toLowerCase()
  for (const prefix of PALETTE_PREFIXES) {
    const hit = ROUTE_TITLES.find((r) => r.prefix === prefix)
    if (!hit) continue
    if (needle && !hit.title.toLowerCase().includes(needle) && !prefix.toLowerCase().includes(needle)) {
      continue
    }
    items.push({ id: `nav-${prefix}`, label: hit.title, to: `/${prefix}`, hint: '打开页面' })
  }

  return items
}

/** 面板主体（拆出来是为了**关闭时随 Dialog 一起卸载**，状态自然重置）。 */
function PaletteBody({ onRun }: { onRun: (to: string) => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  const items = useMemo(() => buildPaletteItems(query), [query])

  // 查询变化后，高亮回到第一项（否则可能停在越界索引上）。
  useEffect(() => setActive(0), [query])

  // 高亮项滚进可视区。
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#palette-option-${active}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = items[active]
      if (hit) onRun(hit.to)
    }
  }

  const activeId = items.length ? `palette-option-${active}` : undefined

  return (
    <>
      <TextField
        autoFocus
        fullWidth
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={GLOSSARY.palettePlaceholder}
        // ARIA 1.2 combobox：输入框负责「可访问名 + 当前高亮项」，列表负责选项集合。
        inputProps={{
          role: 'combobox',
          'aria-label': GLOSSARY.paletteInputLabel,
          'aria-expanded': true,
          'aria-controls': 'palette-listbox',
          'aria-autocomplete': 'list',
          'aria-activedescendant': activeId,
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 1 }}
      />
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          {GLOSSARY.paletteEmpty}
        </Typography>
      ) : (
        <List
          ref={listRef}
          id="palette-listbox"
          role="listbox"
          aria-label={GLOSSARY.paletteTitle}
          dense
          sx={{ maxHeight: 320, overflowY: 'auto' }}
        >
          {items.map((item, i) => (
            <ListItemButton
              key={item.id}
              id={`palette-option-${i}`}
              role="option"
              aria-selected={i === active}
              selected={i === active}
              onClick={() => onRun(item.to)}
              onMouseEnter={() => setActive(i)}
            >
              <ListItemText primary={item.label} secondary={item.hint} />
            </ListItemButton>
          ))}
        </List>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {GLOSSARY.paletteShortcutHint}
      </Typography>
    </>
  )
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** 执行跳转（由外壳注入带 View Transition 的 navigate）。 */
  onNavigate: (to: string) => void
}

/** 全局快速跳转面板。 */
export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="palette-dialog-title"
      PaperProps={{ sx: { alignSelf: 'flex-start', mt: { xs: 6, sm: 10 } } }}
    >
      {/* 标题对视觉是冗余的（占位文案已说明用途），但对话框**必须有可访问名**，
          故保留一个视觉隐藏的标题供 `aria-labelledby` 引用。 */}
      <Typography id="palette-dialog-title" sx={visuallyHidden}>
        {GLOSSARY.paletteTitle}
      </Typography>
      <DialogContent sx={{ pt: 2 }}>
        <PaletteBody
          onRun={(to) => {
            onNavigate(to)
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** 视觉隐藏但读屏可见（不依赖主题，保持组件自洽）。 */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

export default CommandPalette
