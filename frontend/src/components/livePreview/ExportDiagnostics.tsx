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
import {
  describeIssueSource,
  describeIssueTechnical,
  describeRevisionIssues,
  describeTechnicalInfo,
  isDebugMode,
} from '../../lib/glossary'

export function IssueDetails({ issue }: { issue: ExportIssue }) {
  // P0-1：主导出流只给老师能懂的摘要 + 来源文件；原始技术字段（scan index / 快照摘要 /
  // 实例 id / 受影响模式）一律走 debug 开关，**默认不渲染**，维护者可开 `?debug=1` 查看。
  const debug = isDebugMode()
  return <Box sx={{ mb: 0.75 }} data-issue-kind={issue.kind}>
    <Typography variant="body2">
      {issue.severity === 'blocker' ? '【阻断】' : '【提示】'}{issue.summary}：{issue.message}
    </Typography>
    <Typography variant="caption" component="div" color="text.secondary">
      {describeIssueSource(issue.source)}；建议：{issue.suggested_action}
    </Typography>
    {debug && <Box component="details" sx={{ mt: 0.5 }}>
      <summary style={{ cursor: 'pointer' }}>{describeTechnicalInfo()}</summary>
      <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {describeIssueTechnical(issue)}
      </Typography>
    </Box>}
  </Box>
}

export function ExportDiagnosticsPanel({ paperId, data, onRevised, readOnly = false }: { paperId: number; data: ExportPayload; onRevised?: (id: number) => void; readOnly?: boolean }) {
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
  // P0-1：原始诊断 JSON / 摘要等只在 debug 下暴露给维护者。
  const debug = isDebugMode()
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
      {d.export_allowed ? '当前模式内容检查通过' : '当前模式内容被阻断'}：{d.blocker_count} 个阻断条目；{d.warning_count} 条提示。{describeRevisionIssues()}仍需逐项核对。
    </Alert>
    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
      {/* 复制原始诊断 JSON 是维护者工具，默认不暴露给老师。 */}
      {debug && <Button size="small" onClick={copy}>复制完整诊断JSON</Button>}
      {/* 只读模式（§3.2）：辅助预览页不提供修订卷创建，写操作统一留在导出抽屉。 */}
      {!readOnly && <Button size="small" variant="outlined" onClick={() => { setExcluded([...d.revision_proposal.exclude_item_ids]); setTitle(`${String(data.paper.title ?? '未命名试卷')}（修订）`); setToken(d.diagnostic_digest); setMessage(''); setOpen(true) }}>查看{describeRevisionIssues()}</Button>}
    </Stack>
    {message && <Alert severity="info" sx={{ mt: 1 }}>{message}</Alert>}
    <Box component="details" sx={{ mt: 1 }}><summary>逐条问题与来源（{d.issues.length}）</summary>{d.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}</Box>
    {d.duplicate_groups.map(g => <Typography variant="caption" display="block" key={g.question_id}>第 {g.seqs.join(' / ')} 题内容重复（可能是有意重复，可保留）。{debug ? `（qid ${g.question_id}；items ${g.item_ids.join(' / ')}）` : ''}</Typography>)}
    {/* 完整诊断 JSON 含 snapshot_digest / scan index 等原始字段，仅 debug 可见。 */}
    {debug && <Box component="details"><summary>{describeTechnicalInfo()}</summary><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{JSON.stringify(d, null, 2)}</Box></Box>}
    {/* 修订卷创建 Dialog：只读模式（辅助预览页）下**整体不渲染**，避免"仅隐藏标题仍可创建修订卷"。 */}
    {!readOnly && (
    <Dialog open={open} onClose={() => !revision.isPending && setOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle>{describeRevisionIssues()} · 原卷 #{paperId} 保留</DialogTitle>
      <DialogContent>
        <Alert severity="info">{d.revision_proposal.message} 默认仅建议移除已确认答案区条目。勾选代表移除；其余题目沿用本卷当前版本。新卷需要重新预览。</Alert>
        <TextField fullWidth size="small" label="修订卷标题" value={title} onChange={e => setTitle(e.target.value)} sx={{ my: 1 }} inputProps={{ maxLength: 200 }} />
        {candidateQ.isFetching && <Alert severity="info">正在核对候选的全部分支与源证据…</Alert>}
        {candidateQ.isError && <Alert severity="error" action={<Button onClick={() => candidateQ.refetch()}>重试</Button>}>候选内容加载失败：{(candidateQ.error as Error).message}</Alert>}
        {items.map(q => <Box key={q.item_id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1, mb: 1 }}>
          <FormControlLabel control={<Checkbox checked={excluded.includes(q.item_id)} onChange={e => setExcluded(current => e.target.checked ? [...current, q.item_id] : current.filter(id => id !== q.item_id))} />} label={`${excluded.includes(q.item_id) ? '移除' : '保留'} · 第 ${q.seq} 题 · ${q.score ?? '未设'}分${debug ? ` · item ${q.item_id} · qid ${q.question_id} · v${q.question_version}` : ''}`} />
          <Typography variant="body2">{q.text?.slice(0, 180) || q.issues[0]?.summary || '内容待核对'}</Typography>
          {q.issues.map((issue, i) => <IssueDetails key={i} issue={issue} />)}
          <Typography variant="caption" component="div">状态：{q.content_status === 'ready' ? '当前模式合格' : '当前模式阻断'}</Typography>
          {/* 快照摘要 / 源证据是原始字段，仅 debug 可见。 */}
          {debug && <Box component="details"><summary style={{ cursor: 'pointer' }}>{describeTechnicalInfo()}</summary><Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>锁定快照 {q.snapshot_digest}；源证据 {q.evidence_digest}</Typography></Box>}
          {debug && (candidateItems.find(item => item.item_id === q.item_id)?.content_blocks ?? []).filter(block => block.kind === 'image').map(block => block.kind === 'image' && <Typography variant="caption" component="div" key={block.instance_id}>图实例：{block.instance_id} · {block.branch === 'stem' ? '题干' : block.branch === 'answer' ? '答案' : '解析'} · {block.media_path}；scan index（0起）{block.scan_index ?? '—'}；body直属段号（1起）{block.body_paragraph_number ?? '—'}</Typography>)}
        </Box>)}
        {message && <Alert severity="warning">{message}</Alert>}
      </DialogContent>
      <DialogActions><Typography variant="caption">保留 {items.length - excluded.length} / {items.length} 项</Typography><Button disabled={revision.isPending} onClick={() => setOpen(false)}>取消</Button><Button variant="contained" disabled={revision.isPending || candidateQ.isFetching || candidateQ.isError || !candidateQ.data || candidateQ.data.diagnostics.diagnostic_digest !== token || items.length === 0 || excluded.length >= items.length || !title.trim() || token !== d.diagnostic_digest} onClick={() => revision.mutate()}>创建修订卷</Button></DialogActions>
    </Dialog>
    )}
  </Box>
}
