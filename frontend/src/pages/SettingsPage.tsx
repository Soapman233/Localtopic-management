/** P9 系统设置页（PRD P1-9）。
 *
 * 覆盖需求：DB 路径、默认导出目录 / 模板、KaTeX 与界面偏好。
 * 读写 ``outputs/webui/settings.json``（``GET/PUT /api/settings``）。
 *
 * 渐进披露（方案 §3.9）：日常会用到的设置（数据库路径、导出目录、默认模板、
 * 外观、局域网访问）默认可见可改；仅「公式渲染（KaTeX）」属高级项，
 * **默认只读**，需显式点「编辑高级设置」解锁后才可修改。
 *
 * 布局约定（设计规范 §4 P0）
 * -------------------------
 * - 页主标题走 `PageHeader`（`level="page"` → 唯一 h1），**不手写 h1**；
 * - 「常用 / 高级」两组用 `SectionCard` 分组卡片承载；卡片内部再分小节时用
 *   `variant="plain"`（仅标题行 + 分隔线），避免「卡片套卡片」；
 * - 内容限宽由 `App.tsx` 按路由统一处理（/settings → 1100px 居中），页面内不再自加 maxWidth。
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
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
import LanAccessPanel from '../components/LanAccessPanel'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import { qk } from '../api/queryKeys'
import { PRIMARY_MIN_CONTRAST, contrastRatio, tokens } from '../theme'
import { GLOSSARY, describePrimaryContrast } from '../lib/glossary'
import { useThemeModeStore } from '../store/themeStore'
import { effectiveDark, systemPrefersDark, type ThemeMode } from '../lib/themeMode'

interface FormState {
  db_path: string
  export_dir: string
  default_template: string
  katex_throw_on_error: boolean
  katex_strict: boolean
  theme_primary: string
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
  }
}

/** P9 系统设置页。 */
export default function SettingsPage() {
  const qc = useQueryClient()
  const settingsQ = useQuery({ queryKey: qk.settings(), queryFn: () => getSettings() })
  const [form, setForm] = useState<FormState | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  // 高级项（公式渲染）默认只读，需显式解锁才可编辑。
  const [advancedEditing, setAdvancedEditing] = useState(false)

  // §4.5 第 7 条：主题三态（跟随系统 / 浅色 / 深色）来自 store（localStorage），
  // 默认「跟随系统」；用户显式选择后立即生效、并跨会话记住。
  const themeMode = useThemeModeStore((s) => s.mode)
  const setThemeMode = useThemeModeStore((s) => s.setMode)

  /**
   * 主色对比度（R02 = ③）：**与 `buildTheme` 的收敛口径保持一致**——
   * 浅色看页面底 `tokens.bg`、深色看纸面 `#1E1E1E`，两者都 ≥ 4.5:1 才算达标。
   * ⚠️ 口径必须同源：若这里换个背景算，就会出现「设置页说达标、界面其实没达标」的分裂。
   * 放在早退（加载/错误）之前，故对 `form` 为 null 做了兜底。
   */
  const primaryContrast = useMemo(() => {
    const c = form?.theme_primary ?? tokens.primary
    const light = contrastRatio(c, tokens.bg)
    const dark = contrastRatio(c, tokens.paperDark)
    return { light, dark, ok: Math.min(light, dark) >= PRIMARY_MIN_CONTRAST }
  }, [form?.theme_primary])

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
        // §4.5 第 7 条：后端只接受布尔 `dark`（无法表达第三态）。这里把三态**收敛**成
        // 一个等价布尔写回，保持旧契约与旧消费方可用；真正的三态由 localStorage 承载。
        // 「跟随系统」时写当前系统深浅，使后端值与界面一致。
        theme: { primary: f.theme_primary, dark: effectiveDark(themeMode, systemPrefersDark()) },
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
        <PageHeader title="系统设置" level="page" />
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
        <PageHeader title="系统设置" level="page" />
        <LoadingState label="正在加载设置…" />
      </Box>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f))

  return (
    <Box>
      <PageHeader title="系统设置" level="page" />

      {toast && (
        <Alert severity={toast.kind} sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}

      {/* ── 常用（默认可见可改） ───────────────────────────────────── */}
      <SectionCard title="常用" sx={{ mb: 2 }}>
        <Stack spacing={2.5}>
          {/* 数据库 */}
          <SectionCard title="数据库" variant="plain" level="subsection">
            <TextField
              label="数据库路径（bank.db）"
              size="small"
              fullWidth
              value={form.db_path}
              onChange={(e) => set('db_path', e.target.value)}
            />
            <Alert severity="warning" sx={{ mt: 1 }}>
              修改数据库路径后需<strong>重启服务</strong>方可生效；指向不存在的库将无法检索 / 编辑。
            </Alert>
          </SectionCard>

          {/* 导出 */}
          <SectionCard title="导出" variant="plain" level="subsection">
            <Stack spacing={2}>
              <TextField
                label="默认导出目录"
                size="small"
                fullWidth
                value={form.export_dir}
                onChange={(e) => set('export_dir', e.target.value)}
              />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  默认模板
                </Typography>
                {/* ⚠️ 移动端修复：根节点**不要**写 display:block + minWidth，
                    否则 MUI Select 根从 inline-flex 变 block，内部 content-box 的
                    .MuiSelect-select 会「先撑满父宽、再加自身 padding」而横向溢出。
                    用 fullWidth（根保持 inline-flex + width:100%）即可自适应窄屏。 */}
                <Select
                  size="small"
                  fullWidth
                  value={form.default_template}
                  onChange={(e) => set('default_template', e.target.value)}
                  sx={{ mt: 0.5 }}
                >
                  {TEMPLATES.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </Select>
                {/* P0-2：默认模板已被「新建试卷」消费（组卷页 / 检索页建卷时读取），不再是空配置。 */}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  新建试卷时默认套用的模板。
                </Typography>
              </Box>
            </Stack>
          </SectionCard>

          {/* 外观 */}
          <SectionCard title="外观" variant="plain" level="subsection">
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  主色
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <input
                    type="color"
                    aria-label="主色"
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
                {/* R02 = ③：**标注当前主色是否达标**，并给一键切到推荐值的动作。
                    规范 §5.2 把「门禁测不到运行期存值」列为已知盲区，这里就是那个盲区的补丁。 */}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
                  <Typography
                    variant="caption"
                    color={primaryContrast.ok ? 'text.secondary' : 'warning.main'}
                  >
                    {describePrimaryContrast(
                      primaryContrast.light,
                      primaryContrast.dark,
                      primaryContrast.ok,
                      PRIMARY_MIN_CONTRAST,
                    )}
                  </Typography>
                  {!primaryContrast.ok && (
                    <Button
                      size="small"
                      onClick={() => set('theme_primary', tokens.primary)}
                      sx={{ minWidth: 0, px: 0.75, fontSize: 12, flexShrink: 0 }}
                    >
                      {GLOSSARY.primaryUseRecommended}
                    </Button>
                  )}
                </Stack>
              </Box>
              {/* §4.5 第 7 条：主题三态。默认「跟随系统」——客户端没有地址栏作参照，
                  深色不一致会更刺眼；用户显式选过浅色 / 深色则以用户为准。 */}
              <FormControl component="fieldset">
                <FormLabel id="theme-mode-label" sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {GLOSSARY.themeModeLabel}
                </FormLabel>
                <RadioGroup
                  row
                  aria-labelledby="theme-mode-label"
                  value={themeMode}
                  onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                >
                  <FormControlLabel
                    value="system"
                    control={<Radio size="small" />}
                    label={GLOSSARY.themeModeSystem}
                  />
                  <FormControlLabel
                    value="light"
                    control={<Radio size="small" />}
                    label={GLOSSARY.themeModeLight}
                  />
                  <FormControlLabel
                    value="dark"
                    control={<Radio size="small" />}
                    label={GLOSSARY.themeModeDark}
                  />
                </RadioGroup>
              </FormControl>
            </Stack>
          </SectionCard>
        </Stack>
      </SectionCard>

      {/* 局域网访问（方案 A）：手机 / 其他设备访问，属常用项，始终可用。
          该组件自带卡片外框（Paper），故作为独立卡片紧邻「常用」组，避免卡片套卡片。 */}
      <LanAccessPanel />

      {/* ── 高级（默认只读，显式解锁） ─────────────────────────────── */}
      <SectionCard
        title="高级"
        meta="默认只读"
        actions={
          <Button
            size="small"
            variant={advancedEditing ? 'text' : 'outlined'}
            aria-pressed={advancedEditing}
            onClick={() => setAdvancedEditing((v) => !v)}
          >
            {advancedEditing ? '完成' : '编辑高级设置'}
          </Button>
        }
        sx={{ mb: 2 }}
      >
        <Typography variant="caption" color="text.secondary" display="block">
          高级设置默认只读，避免误改影响公式渲染；点「编辑高级设置」后可修改。
        </Typography>
        <SectionCard title="公式渲染（KaTeX）" variant="plain" level="subsection" sx={{ mt: 1.5 }}>
          {/* P0-2：这两个开关已真正生效——保存后经 main.tsx 的 syncFrom 镜像到 settingsStore，
              由 KatexFormula 渲染时读取；「默认模板」同理被建卷流程消费。不再是「点了没用」的假开关。 */}
          <Box>
            <FormControlLabel
              disabled={!advancedEditing}
              control={
                <Switch
                  checked={form.katex_throw_on_error}
                  onChange={(e) => set('katex_throw_on_error', e.target.checked)}
                />
              }
              label="渲染失败时抛出错误（关闭则降级为红色源码）"
            />
          </Box>
          <Box>
            <FormControlLabel
              disabled={!advancedEditing}
              control={
                <Switch checked={form.katex_strict} onChange={(e) => set('katex_strict', e.target.checked)} />
              }
              label="严格模式（对非标准 LaTeX 语法告警）"
            />
          </Box>
          {advancedEditing && (
            <Alert severity="info" sx={{ mt: 1 }}>
              保存后立即生效：作用于试卷预览与导出中的公式渲染。
            </Alert>
          )}
        </SectionCard>
      </SectionCard>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
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
