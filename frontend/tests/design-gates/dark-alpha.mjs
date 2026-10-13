import assert from 'node:assert/strict'
import { browser } from '../../scripts/gate-common.mjs'
import { inspectText } from '../../scripts/gate-dark.mjs'
const b = await browser()
try {
  const p = await b.newPage()
  await p.setContent('<body style="background:white"><div style="background:rgba(0,0,0,.5)"><span style="background:rgba(255,255,255,.5);color:rgba(0,0,0,.5)">多层透明文字</span></div><div style="background:black;opacity:.5;color:rgba(255,255,255,.5)">祖先透明组合</div><span style="display:none">隐藏</span><button disabled>禁用</button></body>')
  const result = await p.evaluate(inspectText), first = result.items.find(i => i.text === '多层透明文字'), second = result.items.find(i => i.text === '祖先透明组合')
  assert.ok(first && second); assert.deepEqual(first.background, [191.25,191.25,191.25,1]); assert.deepEqual(first.foreground,[95.625,95.625,95.625,1]); assert.deepEqual(second.background,[127.5,127.5,127.5,1]); assert.deepEqual(second.foreground,[191.25,191.25,191.25,1]); assert.ok(result.excluded.hidden && result.excluded.disabled)
  await p.setContent('<body style="background:white"><div style="background:linear-gradient(white,black);color:black">不能忽略渐变</div></body>')
  const bad = await p.evaluate(inspectText); assert.equal(bad.unsupported.length,1); assert.equal(bad.checked,0)
  console.log(JSON.stringify({ gate:'G-d/alpha-engine', checked:7, result:'PASS', first, second, unsupported:bad.unsupported, exclusions:result.excluded },null,2))
} finally { await b.close() }
