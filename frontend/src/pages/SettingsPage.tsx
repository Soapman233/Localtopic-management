/** P9 系统设置页（PRD P1-9）。
 *
 * 覆盖需求：DB 路径、默认导出目录 / 模板、KaTeX 与界面偏好。
 * 读写 ``outputs/webui/settings.json``（``GET/PUT /api/settings``）。
 *
 * B4-5 重构（内容优先的工具型极简）：
 * - 拆为两个 Tab：**外观 / 高级**，默认「外观」；
 * - 「外观」展示深色模式、主色（预设 + 自定义）与默认模板；
 * - 「高级」展示数据库位置、导出目录、公式渲染配置，**默认只读**；显式「编辑高级设置」后才可改；
 * - **保存按 Tab 分离**：外观只提交 `theme` / `default_template`，高级只提交**被修改的**字段；
 * - 删除「联调 / 副本」教师文案，保留数据库改动的**重启与路径有效性**提醒；
 * - **不静默迁移**用户已保存的主色（沿用其现值，仅在用户主动选择时改变）。
 *
 * ⚠️ 风险边界：只禁用输入不足以防止误提交——故保存范围由**代码显式限定**；
 * 「编辑高级设置」只是界面解锁，**不代表获得额外授权**，后端权限约束不变。
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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import EditIcon from '@mui/icons-material/Edit'
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

/**
 * 主色预设。**每一组都经过对比度门禁**（见 `tests/visual/contrast-pairs.json`）：
 * 白字压底色 ≥ 4.5:1，且作浅底文字（白卡片 / 页面底色）≥ 4.5:1。
 * 自定义主色仍允许输入，但保存前不强制校验（沿用历史行为，避免阻断老师）。
 */
const PRIMARY_PRESETS: { hex: string; label: string }[] = [
  { hex: '#2F63EA', label: '蓝' },
  { hex: '#0E7490', label: '青' },
  { hex: '#15803D', label: '绿' },
  { hex: '#7C3AED', label: '紫' },
  { hex: '#9A3412', label: '棕' },
]

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
  const [tab, setTab] = useState<'appearance' | 'advanced'>('appearance')
  const [advancedEditing, setAdvancedEditing] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // 首次加载后回填表单。
  useEffect(() => {
    if (settingsQ.data && form === null) setForm(toForm(settingsQ.data))
  }, [settingsQ.data, form])

  /** 保存成功后统一回填并同步缓存。 */
  const onSaved = (res: SettingsData, text: string) => {
    setForm(toForm(res))
    setToast({ kind: 'success', text })
    qc.setQueryData(['settings'], res)
    qc.invalidateQueries({ queryKey: qk.settings() })
  }

  /** 外观保存：**只提交** theme 与 default_template，不含高级字段。 */
  const saveAppearanceMut = useMutation({
    mutationFn: (f: FormState) =>
      updateSettings({
        default_template: f.default_template,
        theme: { primary: f.theme_primary, dark: f.theme_dark },
      }),
    onSuccess: (res) => onSaved(res, '外观设置已保存'),
    onError: (err) => setToast({ kind: 'error', text: `保存失败：${(err as Error).message}` }),
  })

  /** 高级保存：**只提交被修改的**高级字段（diff 后 patch），不再全量 PUT。 */
  const saveAdvancedMut = useMutation({
    mutationFn: (patch: Partial<SettingsData>) => updateSettings(patch),
    onSuccess: (res) => {
      onSaved(res, '高级设置已保存')
      setAdvancedEditing(false)
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

  /** 计算高级字段的变更补丁（无变更返回空对象）。 */
  const buildAdvancedPatch = (): Partial<SettingsData> => {
    const saved = settingsQ.data
    const patch: Partial<SettingsData> = {}
    if (!saved) return patch
    if (form.db_path !== saved.db_path) patch.db_path = form.db_path
    if (form.export_dir !== saved.export_dir) patch.export_dir = form.export_dir
    const katexChanged =
      form.katex_throw_on_error !== Boolean(saved.katex?.throw_on_error) ||
      form.katex_strict !== Boolean(saved.katex?.strict)
    if (katexChanged) {
      patch.katex = { throw_on_error: form.katex_throw_on_error, strict: form.katex_strict }
    }
    return patch
  }

  const handleSaveAdvanced = () => {
    const patch = buildAdvancedPatch()
    if (Object.keys(patch).length === 0) {
      setToast({ kind: 'error', text: '没有检测到变更' })
      return
    }
    saveAdvancedMut.mutate(patch)
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h6" component="h1" gutterBottom>
        系统设置
      </Typography>

      <Tabs
        aria-label="设置分类"
        value={tab}
        onChange={(_e, v: 'appearance' | 'advanced') => setTab(v)}
        sx={{ mb: 2 }}
      >
        <Tab value="appearance" label="外观" id="settings-tab-appearance" aria-controls="settings-panel-appearance" />
        <Tab value="advanced" label="高级" id="settings-tab-advanced" aria-controls="settings-panel-advanced" />
      </Tabs>

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      {/* ── 外观 ─────────────────────────────────────────────── */}
      {tab === 'appearance' && (
        <Box role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance">
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" component="h2" gutterBottom>
              外观
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              保存后立即生效（主色与深色模式全局应用）。
            </Typography>

            <Typography variant="caption" color="text.secondary">
              主色
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {PRIMARY_PRESETS.map((p) => {
                const active = form.theme_primary.toUpperCase() === p.hex.toUpperCase()
                return (
                  <Button
                    key={p.hex}
                    size="small"
                    variant={active ? 'contained' : 'outlined'}
                    onClick={() => set('theme_primary', p.hex)}
                    aria-pressed={active}
                    aria-label={`主色 ${p.label}`}
                    sx={{ minWidth: 0, px: 1.5, bgcolor: active ? undefined : p.hex, color: active ? undefined : '#fff', '&:hover': { bgcolor: active ? undefined : p.hex, opacity: 0.9 } }}
                  >
                    {p.label}
                  </Button>
                )
              })}
              <input
                type="color"
                value={form.theme_primary}
                onChange={(e) => set('theme_primary', e.target.value)}
                aria-label="自定义主色"
                style={{ width: 48, height: 32, border: 'none', background: 'none' }}
              />
              <TextField
                size="small"
                value={form.theme_primary}
                onChange={(e) => set('theme_primary', e.target.value)}
                sx={{ width: 140 }}
              />
            </Stack>

            <FormControlLabel
              control={<Switch checked={form.theme_dark} onChange={(e) => set('theme_dark', e.target.checked)} />}
              label="深色模式"
            />

            <Box sx={{ mt: 1 }}>
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
          </Paper>

          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              disabled={saveAppearanceMut.isPending}
              onClick={() => form && saveAppearanceMut.mutate(form)}
            >
              保存外观设置
            </Button>
            <Button
              onClick={() => settingsQ.data && setForm(toForm(settingsQ.data))}
              disabled={saveAppearanceMut.isPending}
            >
              重置为已保存值
            </Button>
          </Stack>
        </Box>
      )}

      {/* ── 高级 ─────────────────────────────────────────────── */}
      {tab === 'advanced' && (
        <Box role="tabpanel" id="settings-panel-advanced" aria-labelledby="settings-tab-advanced">
          <Alert severity="info" sx={{ mb: 2 }}>
            高级设置默认<strong>只读</strong>，避免误改；如需修改请点击「编辑高级设置」。
          </Alert>

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
              InputProps={{ readOnly: !advancedEditing }}
            />
            <Alert severity="warning" sx={{ mt: 1 }}>
              修改数据库路径后需<strong>重启服务</strong>方可生效；指向不存在的库将无法检索 / 编辑。
            </Alert>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" component="h2" gutterBottom>
              导出目录
            </Typography>
            <TextField
              label="默认导出目录"
              size="small"
              fullWidth
              value={form.export_dir}
              onChange={(e) => set('export_dir', e.target.value)}
              InputProps={{ readOnly: !advancedEditing }}
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" component="h2" gutterBottom>
              公式渲染（KaTeX）
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              保存后立即生效：作用于试卷预览与导出中的公式渲染。
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={form.katex_throw_on_error}
                  disabled={!advancedEditing}
                  onChange={(e) => set('katex_throw_on_error', e.target.checked)}
                />
              }
              label="渲染失败时抛出错误（关闭则降级为红色源码）"
            />
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.katex_strict}
                    disabled={!advancedEditing}
                    onChange={(e) => set('katex_strict', e.target.checked)}
                  />
                }
                label="严格模式（对非标准 LaTeX 语法告警）"
              />
            </Box>
          </Paper>

          <Divider sx={{ mb: 2 }} />
          {!advancedEditing ? (
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setAdvancedEditing(true)}>
              编辑高级设置
            </Button>
          ) : (
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                disabled={saveAdvancedMut.isPending}
                onClick={handleSaveAdvanced}
              >
                保存高级设置
              </Button>
              <Button
                disabled={saveAdvancedMut.isPending}
                onClick={() => {
                  if (settingsQ.data) setForm(toForm(settingsQ.data))
                  setAdvancedEditing(false)
                }}
              >
                取消
              </Button>
            </Stack>
          )}
        </Box>
      )}
    </Box>
  )
}
