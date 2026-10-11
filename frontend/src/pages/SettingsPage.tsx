/** P9 系统设置页（PRD P1-9）。
 *
 * 覆盖需求：DB 路径、默认导出目录 / 模板、KaTeX 与界面偏好。
 * 读写 ``outputs/webui/settings.json``（``GET/PUT /api/settings``）。
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { getSettings, updateSettings } from '../api/settings'
import { TEMPLATES } from '../api/types'
import type { SettingsData } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { qk } from '../api/queryKeys'

interface FormState {
  db_path: string
  export_dir: string
  default_template: string
  katex_throw_on_error: boolean
  katex_strict: boolean
  theme_primary: string
  theme_dark: boolean
}

function toForm(s: SettingsData): FormState {
  return {
    db_path: s.db_path ?? '',
    export_dir: s.export_dir ?? '',
    default_template: s.default_template ?? '考试',
    katex_throw_on_error: Boolean(s.katex?.throw_on_error),
    katex_strict: Boolean(s.katex?.strict),
    // P5-2：默认主色同步为文字安全值 #2F63EA（原 #3370FF 白字仅 4.28:1，未达 AA）。
    theme_primary: String(s.theme?.primary ?? '#2F63EA'),
    theme_dark: Boolean(s.theme?.dark),
  }
}

/** P9 系统设置页。 */
export default function SettingsPage() {
  const qc = useQueryClient()
  const settingsQ = useQuery({ queryKey: qk.settings(), queryFn: () => getSettings() })
  const [form, setForm] = useState<FormState | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // 首次加载后回填表单。
  useEffect(() => {
    if (settingsQ.data && form === null) setForm(toForm(settingsQ.data))
  }, [settingsQ.data, form])

  const saveMut = useMutation({
    mutationFn: (f: FormState) =>
      updateSettings({
        db_path: f.db_path,
        export_dir: f.export_dir,
        default_template: f.default_template,
        katex: { throw_on_error: f.katex_throw_on_error, strict: f.katex_strict },
        theme: { primary: f.theme_primary, dark: f.theme_dark },
      }),
    onSuccess: (res) => {
      setForm(toForm(res))
      setToast({ kind: 'success', text: '设置已保存' })
      qc.setQueryData(['settings'], res)
      qc.invalidateQueries({ queryKey: qk.settings() })
    },
    onError: (err) => setToast({ kind: 'error', text: `保存失败：${(err as Error).message}` }),
  })

  if (settingsQ.isError) {
    return (
      <Box>
        <Typography variant="h6" component="h1" gutterBottom>系统设置</Typography>
        <ErrorState
          error={settingsQ.error}
          title="加载设置失败"
          onRetry={() => settingsQ.refetch()}
        />
      </Box>
    )
  }
  if (settingsQ.isLoading || form === null) {
    return (
      <Box>
        <Typography variant="h6" component="h1" gutterBottom>
          系统设置
        </Typography>
        <LoadingState label="正在加载设置…" />
      </Box>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f))

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h6" component="h1" gutterBottom>
        系统设置
      </Typography>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      {/* 数据库 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" component="h2" gutterBottom>
          数据库
        </Typography>
        <TextField
          label="数据库路径（bank.db）"
          size="small"
          fullWidth
          value={form.db_path}
          onChange={(e) => set('db_path', e.target.value)}
        />
        <Alert severity="warning" sx={{ mt: 1 }}>
          修改数据库路径后需<strong>重启服务</strong>方可生效；指向不存在的库将无法检索 / 编辑。
          涉及写入的联调请使用副本，避免污染真实题库。
        </Alert>
      </Paper>

      {/* 导出 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" component="h2" gutterBottom>
          导出
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="默认导出目录"
            size="small"
            fullWidth
            value={form.export_dir}
            onChange={(e) => set('export_dir', e.target.value)}
          />
          <Box>
            <Typography variant="caption" color="text.secondary">
              默认模板
            </Typography>
            <Select
              size="small"
              value={form.default_template}
              onChange={(e) => set('default_template', e.target.value)}
              sx={{ display: 'block', minWidth: 200 }}
            >
              {TEMPLATES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </Select>
            {/* P0-2：默认模板已被「新建试卷」消费（组卷页 / 检索页建卷时读取），不再是空配置。 */}
            <Typography variant="caption" color="text.secondary">
              新建试卷时默认套用的模板。
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* 公式渲染（KaTeX） */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" component="h2" gutterBottom>
          公式渲染（KaTeX）
        </Typography>
        {/* P0-2：这两个开关已真正生效——保存后经 main.tsx 的 syncFrom 镜像到 settingsStore，
            由 KatexFormula 渲染时读取；「默认模板」同理被建卷流程消费。不再是「点了没用」的假开关。 */}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          保存后立即生效：作用于试卷预览与导出中的公式渲染。
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={form.katex_throw_on_error}
              onChange={(e) => set('katex_throw_on_error', e.target.checked)}
            />
          }
          label="渲染失败时抛出错误（关闭则降级为红色源码）"
        />
        <Box>
          <FormControlLabel
            control={
              <Switch checked={form.katex_strict} onChange={(e) => set('katex_strict', e.target.checked)} />
            }
            label="严格模式（对非标准 LaTeX 语法告警）"
          />
        </Box>
      </Paper>

      {/* 界面偏好 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" component="h2" gutterBottom>
          界面偏好
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="caption" color="text.secondary">
              主色
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <input
                type="color"
                value={form.theme_primary}
                onChange={(e) => set('theme_primary', e.target.value)}
                style={{ width: 48, height: 32, border: 'none', background: 'none' }}
              />
              <TextField
                size="small"
                value={form.theme_primary}
                onChange={(e) => set('theme_primary', e.target.value)}
                sx={{ width: 140 }}
              />
            </Stack>
          </Box>
          <FormControlLabel
            control={<Switch checked={form.theme_dark} onChange={(e) => set('theme_dark', e.target.checked)} />}
            label="深色模式"
          />
        </Stack>
      </Paper>

      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" spacing={2} alignItems="center">
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saveMut.isPending}
          onClick={() => form && saveMut.mutate(form)}
        >
          保存设置
        </Button>
        <Button
          onClick={() => settingsQ.data && setForm(toForm(settingsQ.data))}
          disabled={saveMut.isPending}
        >
          重置为已保存值
        </Button>
      </Stack>
    </Box>
  )
}
