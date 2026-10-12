/** 试卷设置展开层：复用既有元数据写入口，不另建导出配置或业务状态。
 * 标题草稿仅属于当前卷；父级以 key={paperId} 隔离切卷，所有保存仍使预览失效。
 */
import { useState } from 'react'
import { Box, Button, MenuItem, Select, Stack, TextField } from '@mui/material'
import type { Paper } from '../api/types'
import type { PaperPatchBody } from '../api/papers'

export interface PaperSettingsProps {
  paper: Paper
  onUpdate: (patch: PaperPatchBody) => void
  targetSectionId: number | null
  onTargetSectionChange: (id: number | null) => void
  onOpenLibrary: () => void
}

export function PaperSettings({ paper, onUpdate, targetSectionId, onTargetSectionChange, onOpenLibrary }: PaperSettingsProps) {
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  return <Box component="details" sx={{ mb: 1 }} data-testid="paper-settings">
    <summary style={{ cursor: 'pointer' }}>试卷设置</summary>
    <Stack spacing={1} sx={{ mt: 1 }}>
      <TextField size="small" label="试卷标题" value={titleDraft ?? paper.title}
        onChange={e => setTitleDraft(e.target.value)}
        onBlur={() => {
          if (titleDraft != null && titleDraft.trim() && titleDraft !== paper.title) onUpdate({ title: titleDraft.trim() })
          setTitleDraft(null)
        }} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Select size="small" value={paper.template} inputProps={{ 'aria-label': '试卷模板' }} onChange={e => onUpdate({ template: e.target.value })}>
          {['考试', '测验', '作业'].map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </Select>
        <Select size="small" value={paper.answer_mode} inputProps={{ 'aria-label': '试卷答案模式' }} onChange={e => onUpdate({ answer_mode: e.target.value })}>
          {['学生版', '答案解析版', '仅答案'].map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
        </Select>
        <Select size="small" value={targetSectionId ?? ''} displayEmpty inputProps={{ 'aria-label': '加入目标' }}
          onChange={e => onTargetSectionChange(e.target.value === '' ? null : Number(e.target.value))}>
          <MenuItem value="">加入目标：卷末/未分组</MenuItem>
          {(paper.sections ?? []).map(s => <MenuItem key={s.id} value={s.id}>加入目标：{s.name}</MenuItem>)}
        </Select>
        <Button size="small" onClick={onOpenLibrary}>试卷管理</Button>
      </Stack>
    </Stack>
  </Box>
}
