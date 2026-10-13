/**
 * 交互走查（真实浏览器 e2e，**断言用户可见结果**）。
 *
 * 背景：静态截图（`capture.mjs`）**看不出交互缺陷** —— 按钮点了没反应、切换后视图没变、
 * 抽屉打开但读屏读不到、删除没二次确认……这些只有「真的操作一遍并断言结果」才能发现。
 * 本脚本补上这一层：用 Playwright 真实浏览器走一遍关键交互路径，逐条断言。
 *
 * ⚠️ 断言口径：**只断言用户可见结果**（DOM 文本 / 属性 / 元素尺寸 / 可访问名），
 *    **不断言内部 state**（不读 zustand store、不读 react-query 缓存）——那测的是实现，不是体验。
 *
 * ⚠️ 写数据安全（**硬约束**）：涉及写入的路径（如「检索 → 加入题目」）**必须**打到
 *    以 `QB_DB_PATH=<副本>` 启动的后端。脚本会先查 `/api/health` 拿实际 db 路径，
 *    若指向真实的 `outputs/bank.db`，则**拒绝执行写路径**并记为 SKIP（绝不污染真实题库）。
 *
 * ⚠️ 主题路径（设置页改深色）通过**拦截 `/api/settings`**（GET/PUT 均返回内存态）来验证，
 *    **不写** `outputs/webui/settings.json`，保持整个脚本对磁盘只读。
 *
 * 用法：
 *   # 只读路径打真实服务；写路径须另起副本后端（见下）
 *   PLAYWRIGHT_MODULE=<file-url>/index.mjs \
 *     node frontend/tests/visual/interactions.mjs http://127.0.0.1:8720 \
 *       --write-base http://127.0.0.1:8731
 *
 *   # 副本后端启动示例（绝不改 outputs/bank.db）：
 *   cp outputs/bank.db .tmp_verify/bank_copy_interactions.db
 *   QB_DB_PATH=.tmp_verify/bank_copy_interactions.db <python> -c \
 *     "import uvicorn; from webui.app import app; uvicorn.run(app, host='127.0.0.1', port=8731)"
 *
 * 退出码：0 = 全部通过；1 = 存在失败或（写路径被安全跳过以外）的问题。
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8720'
const argOf = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const WRITE_BASE = argOf('--write-base') || BASE

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const results = []
/**
 * 记录一条结果。
 * kind: 'assert'（计入通过/失败）| 'skip'（安全跳过，不计入）| 'note'（信息性发现，不计入）
 */
const record = (name, ok, detail, kind = 'assert') => {
  results.push({ name, ok, detail, kind })
  const tag = kind === 'skip' ? 'SKIP' : kind === 'note' ? 'NOTE' : ok ? 'PASS' : 'FAIL'
  console.log(`${tag}  ${name}  ${detail ?? ''}`)
}

/** 新建独立 context（隔离 localStorage），预置一份存在的试卷避免空态。 */
async function newCtx(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => {
    localStorage.setItem('qb-paper-store', JSON.stringify({
      state: { currentPaperId: 1, targetSectionId: null }, version: 0,
    }))
  })
  return ctx
}

/** 取某试卷的题数（走真实接口，读的是**用户能看到的结果**的后端来源）。 */
async function paperItemCount(base, paperId) {
  const r = await fetch(`${base}/api/papers`)
  const j = await r.json()
  const list = Array.isArray(j?.data) ? j.data : []
  return list.find((p) => p.id === paperId)?.item_count ?? null
}

/**
 * 写路径安全闸门：确认目标后端的 db **不是**真实 `outputs/bank.db`。
 * 返回 { safe, db }。
 */
async function writeTargetSafety(url) {
  try {
    const r = await fetch(`${url}/api/health`)
    const j = await r.json()
    const db = String(j?.data?.db ?? '')
    const norm = db.replace(/\\/g, '/').toLowerCase()
    return { safe: db.length > 0 && !norm.endsWith('/outputs/bank.db'), db }
  } catch (e) {
    return { safe: false, db: '', error: String(e) }
  }
}

const browser = await chromium.launch()

// ─────────────────────────────────────────────────────────────────────────── //
// 1. 检索 → 加入题目（**写路径**，必须副本库）
//    断言：点「加入」后，右栏/试卷题数**真的 +1**，且出现成功提示。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  const safety = await writeTargetSafety(WRITE_BASE)
  if (!safety.safe) {
    record(
      '检索 → 加入题目（题数 +1）',
      false,
      `安全跳过：写后端 db=${safety.db || '未知'} 指向真实题库或不可达。` +
        '请以 QB_DB_PATH=<副本> 另起后端并用 --write-base 指定。',
      'skip',
    )
  } else {
    const before = await paperItemCount(WRITE_BASE, 1)
    const ctx = await newCtx(browser, { width: 1366, height: 768 })
    const page = await ctx.newPage()
    await page.goto(`${WRITE_BASE}/#/search?keyword=浮力`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: '加入', exact: true }).first().click()
    // 等成功提示（用户可见的「加入成功」反馈）
    let toastOk = false
    try {
      await page.getByText(/已加入试卷/).first().waitFor({ state: 'visible', timeout: 8000 })
      toastOk = true
    } catch { /* 记入下方断言 */ }
    const after = await paperItemCount(WRITE_BASE, 1)
    const grew = before != null && after != null && after === before + 1
    record(
      '检索 → 加入题目（题数 +1）',
      grew && toastOk,
      `题数 ${before} → ${after}；成功提示=${toastOk ? '出现' : '未出现'}；写库=${safety.db}（副本，非 outputs/bank.db）`,
    )
    await ctx.close()
  }
} catch (e) {
  record('检索 → 加入题目（题数 +1）', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 2. 组卷页「排版 / 清单」切换
//    断言：切换后**视图真的变了**（排版视图的 A4 文档 `.lp-doc` 出现/消失），不是只有按钮高亮。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  const ctx = await newCtx(browser, { width: 1366, height: 768 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/builder`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const layoutBefore = await page.locator('.lp-doc').count()
  await page.getByTestId('view-list').click()
  await page.waitForTimeout(1200)
  const layoutAfterList = await page.locator('.lp-doc').count()
  const listHasSummary = (await page.locator('body').innerText()).includes('题数')

  await page.getByTestId('view-layout').click()
  await page.waitForTimeout(1200)
  const layoutAfterLayout = await page.locator('.lp-doc').count()

  const ok = layoutBefore >= 1 && layoutAfterList === 0 && listHasSummary && layoutAfterLayout >= 1
  record(
    '组卷页 排版/清单 切换（视图真的变）',
    ok,
    `排版(.lp-doc)=${layoutBefore} → 切清单后=${layoutAfterList}（清单含汇总=${listHasSummary}）→ 切回排版=${layoutAfterLayout}`,
  )
  await ctx.close()
} catch (e) {
  record('组卷页 排版/清单 切换（视图真的变）', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 3. 抽屉开合 + 可访问名（阶段 5 修过 role="dialog"）
//    a) 窄屏（1024×768）右栏「试卷面板」抽屉：可访问名应为「试卷」；
//    b) 全局「切换试卷」抽屉：可访问名应为「切换试卷」。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  // a) 窄屏右栏抽屉（1024 < 1200 → 右栏折叠为抽屉）
  const ctxA = await newCtx(browser, { width: 1024, height: 768 })
  const pageA = await ctxA.newPage()
  await pageA.goto(`${BASE}/#/builder`, { waitUntil: 'domcontentloaded' })
  await pageA.waitForTimeout(4000)
  await pageA.getByTestId('open-paper-panel').click()
  const panelDialog = pageA.getByRole('dialog', { name: '试卷', exact: true })
  let panelVisible = false
  try { await panelDialog.waitFor({ state: 'visible', timeout: 5000 }); panelVisible = true } catch { /* 断言见下 */ }
  // 关闭：用 Esc（模态 Drawer 的通用关闭手势）。**不用「关闭」按钮** ——
  // 实测该按钮位于抽屉顶部、被固定顶栏（zIndex 高于 Drawer）遮挡，鼠标点不到（见下方 NOTE）。
  await pageA.keyboard.press('Escape')
  await pageA.waitForTimeout(700)
  const panelClosed = (await pageA.getByRole('dialog', { name: '试卷', exact: true }).count()) === 0
  record(
    '窄屏(1024) 右栏抽屉：可访问名「试卷」+ Esc 可关',
    panelVisible && panelClosed,
    `打开可见=${panelVisible}，Esc 后消失=${panelClosed}`,
  )

  // NOTE（真实缺陷发现，非本任务失败项）：抽屉顶部「关闭」按钮被固定顶栏遮挡，鼠标不可点。
  // 判据：elementFromPoint(按钮中心) 命中的不是按钮自身，而是顶栏的「试卷列表」按钮。
  await pageA.getByTestId('open-paper-panel').click()
  await pageA.waitForTimeout(700)
  const hit = await pageA.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '关闭')
    if (!b) return null
    const r = b.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { y: Math.round(r.y), selfHit: top === b, coveredBy: top ? (top.textContent || '').trim().slice(0, 12) : null }
  })
  if (hit && !hit.selfHit) {
    record(
      '发现：窄屏右栏抽屉「关闭」按钮被顶栏遮挡（鼠标不可点）',
      false,
      `按钮 y=${hit.y}，命中元素为顶栏「${hit.coveredBy}」；用户仍可用 Esc / 点击遮罩关闭。`,
      'note',
    )
  }
  await ctxA.close()

  // b) 全局切换试卷抽屉
  const ctxB = await newCtx(browser, { width: 1366, height: 768 })
  const pageB = await ctxB.newPage()
  await pageB.goto(`${BASE}/#/builder`, { waitUntil: 'domcontentloaded' })
  await pageB.waitForTimeout(3500)
  await pageB.getByRole('button', { name: '试卷列表' }).click()
  const switchDialog = pageB.getByRole('dialog', { name: '切换试卷', exact: true })
  let switchVisible = false
  try { await switchDialog.waitFor({ state: 'visible', timeout: 5000 }); switchVisible = true } catch { /* 断言见下 */ }
  await pageB.keyboard.press('Escape')
  await pageB.waitForTimeout(700)
  const switchClosed = (await pageB.getByRole('dialog', { name: '切换试卷', exact: true }).count()) === 0
  record(
    '全局「切换试卷」抽屉：可访问名正确 + Esc 可关',
    switchVisible && switchClosed,
    `打开可见=${switchVisible}，Esc 后消失=${switchClosed}`,
  )
  await ctxB.close()
} catch (e) {
  record('抽屉开合 + 可访问名', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 4. 筛选栏开合（<1440）
//    断言：收起筛选栏后，题目列表**真的变宽**（用元素实际宽度，不是按钮状态）。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  const ctx = await newCtx(browser, { width: 1366, height: 768 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/builder`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const cardW = () => page.locator('.MuiCard-root').first().evaluate((el) => el.getBoundingClientRect().width)
  const w1 = await cardW()
  await page.getByTestId('toggle-filters').click()
  await page.waitForTimeout(700)
  const w2 = await cardW()
  const grew = w2 - w1 > 100
  record(
    '筛选栏开合（题卡变宽）',
    grew,
    `题卡宽度 ${w1.toFixed(1)}px → ${w2.toFixed(1)}px（+${(w2 - w1).toFixed(1)}px）`,
  )
  await ctx.close()
} catch (e) {
  record('筛选栏开合（题卡变宽）', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 5. 分页
//    断言：翻到第 2 页后**内容变化**（首张题卡文本不同）。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  const ctx = await newCtx(browser, { width: 1366, height: 768 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/search?keyword=浮力`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const firstText = () => page.locator('.MuiCard-root').first().innerText()
  const t1 = (await firstText()).replace(/\s+/g, ' ').trim()
  await page.getByRole('button', { name: 'Go to page 2' }).click()
  await page.waitForTimeout(2500)
  const t2 = (await firstText()).replace(/\s+/g, ' ').trim()
  const changed = t1.length > 0 && t2.length > 0 && t1 !== t2
  record(
    '分页（翻页后内容变化）',
    changed,
    changed ? `第 1 页首卡 ≠ 第 2 页首卡` : `两页首卡相同：${t1.slice(0, 30)}`,
  )
  await ctx.close()
} catch (e) {
  record('分页（翻页后内容变化）', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 6. 设置页改主题（三态：跟随系统 / 浅色 / 深色）
//    断言：把主题显式选为「深色」并保存后，**body 背景色真的变了**（浅 → 深）。
//    实现：拦截 GET/PUT `/api/settings`（内存态），不写任何设置文件。
// ─────────────────────────────────────────────────────────────────────────── //
try {
  // 取一份真实设置作为模板（只读）
  const baseSettings = (await (await fetch(`${BASE}/api/settings`)).json()).data
  let dark = false
  const ctx = await newCtx(browser, { width: 1366, height: 768 })
  await ctx.route('**/api/settings', async (route) => {
    const req = route.request()
    if (req.method() === 'PUT') {
      const patch = req.postDataJSON() || {}
      if (patch.theme && typeof patch.theme.dark === 'boolean') dark = patch.theme.dark
      const merged = { ...baseSettings, ...patch, theme: { ...baseSettings.theme, ...(patch.theme || {}) } }
      await route.fulfill({ json: { code: 0, data: merged, message: 'ok' } })
    } else {
      const data = { ...baseSettings, theme: { ...baseSettings.theme, dark } }
      await route.fulfill({ json: { code: 0, data, message: 'ok' } })
    }
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // §4.5 第 7 条：设置页主题由「深色模式」开关改为**三态**（跟随系统 / 浅色 / 深色）。
  // 这里显式选「深色」再保存，断言 body 背景真的变深。
  await page.getByLabel('深色', { exact: true }).click()
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.waitForTimeout(1200)
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // 浅色底 #F5F6F8 = rgb(245,246,248)；深色底 #121212 = rgb(18,18,18)
  const ok = bgLight !== bgDark && bgDark === 'rgb(18, 18, 18)'
  record(
    '设置页改深色（body 背景真的变）',
    ok,
    `body 背景 ${bgLight} → ${bgDark}`,
  )
  await ctx.close()
} catch (e) {
  record('设置页改深色（body 背景真的变）', false, `异常：${e.message}`)
}

// ─────────────────────────────────────────────────────────────────────────── //
// 7. 删除二次确认（阶段 0 修过的 P0）
//    断言：点「删除」**先出确认框**（显示将删除的题数），点「取消」后**没删**（试卷仍在）。
//    （只走到「取消」，不真正删除，故对真实服务也只读。）
// ─────────────────────────────────────────────────────────────────────────── //
try {
  const ctx = await newCtx(browser, { width: 1366, height: 768 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/builder`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  // 切到「清单」视图（「试卷管理」入口在清单视图的 PaperPanel 里）
  await page.getByTestId('view-list').click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '试卷管理' }).click()
  const manageDrawer = page.getByRole('dialog', { name: '试卷管理', exact: true })
  await manageDrawer.waitFor({ state: 'visible', timeout: 5000 })
  // ⚠️ 必须 exact 匹配：试卷行本身也是 role=button（可访问名含「删除」），子串匹配会命中整行而非删除按钮。
  const delBtn = manageDrawer.getByRole('button', { name: '删除', exact: true })
  const delBtnsBefore = await delBtn.count()
  const firstNameBefore = await manageDrawer.locator('.MuiListItemText-primary').first().innerText()

  await delBtn.first().click()
  const confirm = page.getByRole('dialog', { name: '删除试卷确认', exact: true })
  let confirmShown = false
  try { await confirm.waitFor({ state: 'visible', timeout: 5000 }); confirmShown = true } catch { /* 断言见下 */ }
  const confirmText = confirmShown ? (await confirm.innerText()) : ''
  const showsImpact = /道题/.test(confirmText)

  // 取消 → 不应删除
  await confirm.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(800)
  const confirmGone = (await page.getByRole('dialog', { name: '删除试卷确认', exact: true }).count()) === 0
  const delBtnsAfter = await delBtn.count()
  const firstNameAfter = await manageDrawer.locator('.MuiListItemText-primary').first().innerText()
  const notDeleted = delBtnsBefore === delBtnsAfter && firstNameBefore === firstNameAfter

  record(
    '删除先确认、取消不删（P0）',
    confirmShown && showsImpact && confirmGone && notDeleted,
    `确认框出现=${confirmShown}（含题数=${showsImpact}），取消后关闭=${confirmGone}，试卷仍在=${notDeleted}`,
  )
  await ctx.close()
} catch (e) {
  record('删除先确认、取消不删（P0）', false, `异常：${e.message}`)
}

await browser.close()

const failed = results.filter((r) => !r.ok && r.kind === 'assert')
const skipped = results.filter((r) => r.kind === 'skip')
const notes = results.filter((r) => r.kind === 'note')
const counted = results.length - skipped.length - notes.length
console.log(`\n===== 汇总：${counted - failed.length}/${counted} 通过` +
  (skipped.length ? `（${skipped.length} 项安全跳过）` : '') +
  (notes.length ? `（${notes.length} 项发现，不计入）` : '') + ' =====')
if (notes.length) {
  console.log('发现的缺陷（需人工确认，不计入失败）：')
  notes.forEach((r) => console.log(`  ! ${r.name} —— ${r.detail}`))
}
if (failed.length) {
  console.log('失败项：')
  failed.forEach((r) => console.log(`  ✗ ${r.name} —— ${r.detail}`))
}
process.exit(failed.length ? 1 : 0)
