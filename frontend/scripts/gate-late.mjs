import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
let target = 'knowledge', probe = false
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--probe' && args[++i] === 'late') probe = true
    else if (args[i] === '--probe-target' && ['knowledge', 'export'].includes(args[i + 1])) target = args[++i]
    else throw new Error('用法: gate-late.mjs [--probe late] [--probe-target knowledge|export]')
  }
  const vitest = path.join(frontend, 'node_modules/vitest/vitest.mjs')
  if (!fs.existsSync(vitest)) throw new Error('缺少本项目Vitest；请安装已有依赖')
  let temporary
  const env = { ...process.env, QB_LATE_COPY_MAP: '' }
  try {
    if (probe) {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-late-'))
      const relative = target === 'knowledge' ? 'src/pages/KnowledgeReviewPage.tsx' : 'src/hooks/useExportGate.ts'
      const source = path.join(frontend, relative)
      const original = fs.readFileSync(source, 'utf8')
      const needle = target === 'knowledge' ? 'if (seq !== batchSeq.current) return' : 'if (!accepts(ticket)) return'
      const first = original.indexOf(needle)
      if (first < 0) throw new Error('生产请求身份守卫未命中，无法构造单点反证: ' + relative)
      const replacement = '/* G-e 反证：移除一处真实请求身份守卫 */'
      const changed = original.slice(0, first) + replacement + original.slice(first + needle.length)
      const copy = path.join(temporary, path.basename(source))
      fs.writeFileSync(copy, changed)
      env.QB_LATE_COPY_MAP = JSON.stringify({ [source.replaceAll('\\', '/')]: copy })
      console.log('G-e probe path=' + relative + ' replacements=1 before=' + needle + ' after=' + replacement)
    }
    console.log('G-e checks=18 threshold=current-target-only modules=KnowledgeReviewPage/useExportGate writes=fetch-intercepted')
    const run = spawnSync(process.execPath, [vitest, 'run', '--config', 'tests/design-gates/late.config.ts'], {
      cwd: frontend, env, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    })
    process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '')
    if (run.error || run.signal || run.status === null) throw run.error ?? new Error('Vitest环境异常: ' + run.signal)
    const output = (run.stdout ?? '') + (run.stderr ?? '')
    const checksRan = /Tests[^\n]*[1-3] (passed|failed)/.test(output)
    if (!checksRan || /Failed Suites|Transform failed|Cannot find module|G-e 环境/.test(output)) {
      console.error('G-e 无法判定：测试加载或API环境异常'); process.exitCode = 2
    } else {
      process.exitCode = run.status === 0 ? 0 : 1
      console.log('G-e result=' + (process.exitCode === 0 ? 'PASS' : 'FAIL') + ' exit=' + process.exitCode)
    }
  } finally {
    if (temporary) {
      for (const name of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, name))
      fs.rmdirSync(temporary)
    }
  }
} catch (error) { console.error('G-e environment/input exit=2 reason=' + error.message); process.exitCode = 2 }
