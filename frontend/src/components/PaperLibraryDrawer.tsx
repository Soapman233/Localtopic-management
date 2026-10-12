/**
 * 全站唯一的试卷管理抽屉，首次打开才下载。
 * 删除前读取整卷，以实际题数确认；删除不可原位恢复，只能据题号重建当前版本副本。
 * 不保存试卷数据副本到全局状态，列表与整卷仍由 react-query / 后端作为事实来源。
 */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Divider, Drawer, List, ListItem, ListItemButton, ListItemText,
  Snackbar, Stack, TextField, Toolbar, Typography } from '@mui/material'
import { createPaper, deletePaper, getPaper, listPapers } from '../api/papers'
import { recreatePaperCopy } from '../api/paperRestore'
import type { Paper } from '../api/types'
import { qk } from '../api/queryKeys'
import { usePermission } from '../hooks/usePermission'
import { usePaperStore } from '../store/paperStore'
import { useSettingsStore } from '../store/settingsStore'
import { useUiStore } from '../store/uiStore'
import ConfirmDialog from './ConfirmDialog'
import LoadingState from './LoadingState'
import ErrorState from './ErrorState'
import EmptyState from './EmptyState'

export interface PaperLibraryDrawerProps {
  open: boolean
  onClose: () => void
  onSelectPaper: (paperId: number) => void
}
export default function PaperLibraryDrawer({ open, onClose, onSelectPaper }: PaperLibraryDrawerProps) {
  const qc = useQueryClient()
  const currentPaperId = usePaperStore(s => s.currentPaperId)
  const canEdit = usePermission('paper.edit')
  const canDelete = usePermission('paper.delete')
  // 异步请求完成时再次核对权限，避免确认等待期间角色变化仍提交删除。
  const permission = useRef({ canEdit, canDelete })
  permission.current = { canEdit, canDelete }
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Paper | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const [deletedPaper, setDeletedPaper] = useState<Paper | null>(null)
  const papersQ = useQuery({ queryKey: qk.papers(), queryFn: () => listPapers(), enabled: open })
  const papers = Array.isArray(papersQ.data) ? papersQ.data : []
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.papers() }) }
  const createMut = useMutation({
    mutationFn: async () => {
      if (!permission.current.canEdit) throw new Error('当前账号不能新建试卷')
      return createPaper({ title: title.trim() || '未命名试卷', template: useSettingsStore.getState().defaultTemplate })
    },
    onSuccess: paper => { refresh(); useUiStore.getState().invalidatePreview(paper.id); setTitle(''); setError(null); onSelectPaper(paper.id) },
    onError: e => setError((e as Error).message),
  })
  const readMut = useMutation({
    mutationFn: async (id: number) => {
      if (!permission.current.canDelete) throw new Error('当前账号不能删除试卷')
      return getPaper(id)
    },
    onSuccess: full => { if (permission.current.canDelete) { setConfirmation(full); setConfirmationError(null) } },
    onError: e => setError('读取整卷失败：' + (e as Error).message),
  })
  const deleteMut = useMutation({
    mutationFn: async (full: Paper) => {
      if (!permission.current.canDelete) throw new Error('当前账号不能删除试卷')
      // 再读整卷发现确认期间题数变动时，更新影响事实并要求重新确认。
      const latest = await getPaper(full.id)
      if (latest.items.length !== full.items.length) {
        setConfirmation(latest)
        setConfirmationError('试卷题数已变化，请核对最新题数后再次确认。')
        return null
      }
      if (!permission.current.canDelete) throw new Error('当前账号不能删除试卷')
      await deletePaper(full.id, true)
      return latest
    },
    onSuccess: full => {
      if (!full) return
      refresh()
      void qc.invalidateQueries({ queryKey: qk.paper(full.id) })
      void qc.invalidateQueries({ queryKey: qk.exportDataRoot() })
      useUiStore.getState().invalidatePreview(full.id)
      const store = usePaperStore.getState()
      if (store.currentPaperId === full.id) { store.setCurrentPaperId(null); store.setTargetSectionId(null) }
      setConfirmation(null); setConfirmationError(null); setError(null); setDeletedPaper(full)
    },
    onError: e => setConfirmationError((e as Error).message),
  })
  const rebuildMut = useMutation({
    mutationFn: async (full: Paper) => {
      if (!permission.current.canEdit) throw new Error('当前账号不能重建副本')
      return recreatePaperCopy(full)
    },
    onSuccess: paper => {
      refresh(); useUiStore.getState().invalidatePreview(paper.id)
      setDeletedPaper(null); setError(null); onSelectPaper(paper.id)
    },
    onError: e => setError('重建副本失败，可能已创建部分副本：' + (e as Error).message),
  })
  const busy = createMut.isPending || readMut.isPending || deleteMut.isPending || rebuildMut.isPending
  // 提示在打开的模态内，关闭后移到宿主，避免被 Drawer 的 aria-hidden 与焦点陷阱遮蔽。
  const deletionNotice = (
    <Snackbar open={deletedPaper !== null} onClose={rebuildMut.isPending ? undefined : () => setDeletedPaper(null)}
      message={'已删除试卷「' + (deletedPaper?.title ?? '') + '」'}
      action={<Button color="inherit" disabled={!canEdit || busy} onClick={() => {
        if (deletedPaper && !rebuildMut.isPending) rebuildMut.mutate(deletedPaper)
      }}>重建副本</Button>} />
  )
  return <>
    <Drawer anchor="left" open={open} onClose={busy ? undefined : onClose}
      PaperProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'paper-library-title' }}>
      <Box sx={{ width: 320, p: 2 }}>
        <Toolbar variant="dense" />
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography id="paper-library-title" variant="subtitle1" component="h2">试卷管理</Typography>
          <Button onClick={onClose} disabled={busy} aria-label="关闭试卷管理">关闭</Button>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ my: 1 }}>
          <TextField size="small" label="新建试卷标题" value={title} disabled={!canEdit || busy}
            onChange={e => setTitle(e.target.value)} fullWidth />
          <Button variant="contained" disabled={!canEdit || busy} onClick={() => createMut.mutate()}>新建</Button>
        </Stack>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {open && deletionNotice}
        <Divider sx={{ my: 1 }} />
        {papersQ.isLoading && <LoadingState dense label="加载中…" />}
        {papersQ.isError && <ErrorState dense error={papersQ.error} title="加载失败" onRetry={() => papersQ.refetch()} />}
        <List dense>
          {papers.map(paper => <ListItem key={paper.id} disablePadding>
            <ListItemButton selected={paper.id === currentPaperId} disabled={busy} onClick={() => onSelectPaper(paper.id)}>
              <ListItemText primary={paper.title} secondary={
                (paper.item_count ?? 0) + ' 题 · ' + (paper.total_score ?? 0) + ' 分' +
                ((paper.unscored_count ?? 0) > 0 ? ' · 未设分 ' + paper.unscored_count : '')} />
            </ListItemButton>
            <Button size="small" color="error" disabled={!canDelete || busy} aria-label={'删除试卷' + paper.title}
              onClick={() => readMut.mutate(paper.id)}>删除</Button>
          </ListItem>)}
        </List>
        {papers.length === 0 && !papersQ.isLoading && !papersQ.isError &&
          <EmptyState dense title="还没有试卷" description="在上方输入标题新建一份试卷。" />}
      </Box>
    </Drawer>
    <ConfirmDialog open={confirmation !== null} title="删除试卷确认" impactPrefix="将删除"
      impactCount={confirmation?.items.length ?? 0} impactLabel="道题" confirmText="确认删除"
      confirmColor="error" loading={deleteMut.isPending} error={confirmationError}
      onCancel={() => { setConfirmation(null); setConfirmationError(null) }}
      onConfirm={() => { if (confirmation && !deleteMut.isPending) deleteMut.mutate(confirmation) }}>
      将删除试卷「{confirmation?.title}」，题目本身仍保留在题库中。
      删除后可重建副本（新 ID，按题号加入当前题目版本），不会恢复原锁定快照。
    </ConfirmDialog>
    {!open && deletionNotice}
  </>
}
