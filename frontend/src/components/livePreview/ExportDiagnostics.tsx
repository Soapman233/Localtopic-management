/** 统一内容诊断及显式修订出口；不重新猜测后端判定。 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import type { ExportPayload, ExportIssue } from '../../api/types'
import { getExportData } from '../../api/export'
import { createRevision } from '../../api/papers'
import { ErrorCode, errorCodeOf } from '../../api/errors'
import { usePaperStore } from '../../store/paperStore'
import { useUiStore } from '../../store/uiStore'
import { qk } from '../../api/queryKeys'

export function IssueDetails({ issue }: { issue: ExportIssue }) {
  const s = issue.source
  return <Box sx={{ mb: 0.75 }} data-issue-kind={issue.kind}>
    {/* P1-5：主导出流先给教师能懂的摘要；技术细节（scan index / 快照摘要等）折叠到「技术详情」。 */}
    <Typography variant="body2">
      {issue.severity === 'blocker' ? '【阻断】' : '【提示】'}{issue.summary}：{issue.message}
    </Typography>
    <Typography variant="caption" component="div" color="text.secondary">
      来源文件：{s.file_name ?? '无来源'}；建议：{issue.suggested_action}
    </Typography>
    <Box component="details" sx={{ mt: 0.5 }}>
      <summary style={{ cursor: 'pointer' }}>技术详情</summary>
      <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        卷 #{issue.paper_id ?? '—'} · item {issue.item_id ?? '—'} · 原序 {issue.seq ?? '—'} · qid {issue.question_id} · 锁定 v{issue.question_version} · {issue.kind}
        {'\n'}scan index（0起）{s.start_scan_index ?? '—'}–{s.end_scan_index ?? '—'}；答案区scan index（0起）{s.answer_region_start_scan_index ?? '—'}；body直属段号（1起）{s.body_paragraph_number ?? '—'}{issue.instance_id ? `；图实例 ${issue.instance_id}` : ''}
        {'\n'}受影响模式：{issue.blocked_modes.join('、') || '无'}
      </Typography>
    </Box>
  </Box>
}

export function ExportDiagnosticsPanel({ paperId, data, onRevised }: { paperId: number; data: ExportPayload; onRevised?: (id: number) => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [excluded, setExcluded] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const candidateQ = useQuery({
    queryKey: qk.exportData(paperId, '答案解析版', String(data.paper.template ?? '考试')),
    queryFn: () => getExportData(paperId, '答案解析版', String(data.paper.template ?? '考试')),
    enabled: open,
  })
  const d = data.diagnostics
  const candidateItems = candidateQ.data?.sections.flatMap(s => s.questions) ?? []
  const items = data.sections.flatMap(s => s.questions).sort((a, b) => a.seq - b.seq)
  const revision = useMutation({
    mutationFn: () => createRevision(paperId, { title: title.trim() || undefined, exclude_item_ids: excluded, diagnostic_digest: token, confirm: true }),
    onSuccess: result => {
      useUiStore.getState().invalidatePreview(paperId)
      useUiStore.getState().invalidatePreview(result.paper_id)
      qc.setQueryData(['paper', result.paper_id], result.paper)
      qc.invalidateQueries({ queryKey: qk.papers() })
      qc.invalidateQueries({ queryKey: qk.exportDataRoot() })
      usePaperStore.getState().setCurrentPaperId(result.paper_id)
      usePaperStore.getState().setTargetSectionId(null)
      setOpen(false)
      onRevised?.(result.paper_id)
    },
    onError: error => {
      setMessage(error.message)
      useUiStore.getState().invalidatePreview(paperId)
      if (errorCodeOf(error) === ErrorCode.ExportEvidenceStale) {
        qc.invalidateQueries({ queryKey: qk.exportDataForPaper(paperId) })
        setMessage('诊断依据已变化。请关闭候选窗口，刷新诊断后重新审阅。')
      }
    },
  })
  const copy = async () => {
    const json = JSON.stringify(d, null, 2)
    try { await navigator.clipboard.writeText(json); setMessage('完整诊断JSON已复制') }
    catch { setMessage('浏览器未允许自动复制，可在下方展开完整JSON手动复制。') }
  }
  return <Box sx={{ mb: 1.5 }} data-testid="export-diagnostics">
    <Alert severity={d.export_allowed ? (d.warning_count ? 'warning' : 'success') : 'error'}>
      {d.export_allowed ? '当前模式内容检查通过' : '当前模式内容被阻断'}：{d.blocker_count} 个阻断条目；{d.warning_count} 条提示。修订候选仍需逐项核对。
    </Alert>
    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
      <Button size="small" onClick={copy}>复制完整诊断JSON</Button>
      <Button size="small" variant="outlined" onClick={() => { setExcluded([...d.revision_proposal.exclude_item_ids]); setTitle(`${String(data.paper.title ?? '未命名试卷')}（修订）`); setToken(d.diagnostic_digest); setMessage(''); setOpen(true) }}>查看修订候选</Button>
    </Stack>
    {message && <Alert severity="info" sx={{ mt: 1 }}>{message}</Alert>}
    <Box component="details" sx={{ mt: 1 }}><summary>逐条问题与来源（{d.issues.length}）</summary>{d.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}</Box>
    {d.duplicate_groups.map(g => <Typography variant="caption" display="block" key={g.question_id}>重复 qid {g.question_id}：原序 {g.seqs.join(' / ')}；items {g.item_ids.join(' / ')}。可保留有意重复。</Typography>)}
    <Box component="details"><summary>完整诊断JSON</summary><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{JSON.stringify(d, null, 2)}</Box></Box>
    <Dialog open={open} onClose={() => !revision.isPending && setOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle>修订候选 · 原卷 #{paperId} 保留</DialogTitle>
      <DialogContent>
        <Alert severity="info">{d.revision_proposal.message} 默认仅建议移除已确认答案区条目。勾选代表移除；其余条目复制原锁定快照。新卷需要重新预览。</Alert>
        <TextField fullWidth size="small" label="修订卷标题" value={title} onChange={e => setTitle(e.target.value)} sx={{ my: 1 }} inputProps={{ maxLength: 200 }} />
        {candidateQ.isFetching && <Alert severity="info">正在核对候选的全部分支与源证据…</Alert>}
        {candidateQ.isError && <Alert severity="error" action={<Button onClick={() => candidateQ.refetch()}>重试</Button>}>候选内容加载失败：{(candidateQ.error as Error).message}</Alert>}
        {items.map(q => <Box key={q.item_id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1, mb: 1 }}>
          <FormControlLabel control={<Checkbox checked={excluded.includes(q.item_id)} onChange={e => setExcluded(current => e.target.checked ? [...current, q.item_id] : current.filter(id => id !== q.item_id))} />} label={`${excluded.includes(q.item_id) ? '移除' : '保留'} · 原序 ${q.seq} · item ${q.item_id} · qid ${q.question_id} · v${q.question_version} · ${q.score ?? '未设'}分`} />
          <Typography variant="body2">{q.text?.slice(0, 180) || q.issues[0]?.summary || '内容待核对'}</Typography>
          {q.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}
          <Typography variant="caption" component="div">状态：{q.content_status === 'ready' ? '当前模式合格' : '当前模式阻断'}</Typography>
          <Box component="details"><summary style={{ cursor: 'pointer' }}>技术详情</summary><Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>锁定快照 {q.snapshot_digest}；源证据 {q.evidence_digest}</Typography></Box>
          {(candidateItems.find(item => item.item_id === q.item_id)?.content_blocks ?? []).filter(block => block.kind === 'image').map(block => block.kind === 'image' && <Typography variant="caption" component="div" key={block.instance_id}>图实例：{block.instance_id} · {block.branch === 'stem' ? '题干' : block.branch === 'answer' ? '答案' : '解析'} · {block.media_path}；scan index（0起）{block.scan_index ?? '—'}；body直属段号（1起）{block.body_paragraph_number ?? '—'}</Typography>)}
        </Box>)}
        {message && <Alert severity="warning">{message}</Alert>}
      </DialogContent>
      <DialogActions><Typography variant="caption">保留 {items.length - excluded.length} / {items.length} 项</Typography><Button disabled={revision.isPending} onClick={() => setOpen(false)}>取消</Button><Button variant="contained" disabled={revision.isPending || candidateQ.isFetching || candidateQ.isError || !candidateQ.data || candidateQ.data.diagnostics.diagnostic_digest !== token || items.length === 0 || excluded.length >= items.length || !title.trim() || token !== d.diagnostic_digest} onClick={() => revision.mutate()}>创建修订卷</Button></DialogActions>
    </Dialog>
  </Box>
}
