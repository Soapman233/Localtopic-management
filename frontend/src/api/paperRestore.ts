/**
 * 删除试卷后的「撤销」实现：依据删除前快照**重建一份同内容副本**（R3 可独立测试）。
 *
 * 后端无「恢复已删试卷」接口（`DELETE` 不可逆），故撤销采用重建副本：
 * 依原试卷元数据、大题顺序、题目顺序 / 分值 / 大题归属逐条重建。撤销后得到一张
 * **新的**试卷（id 不同），题目本身仍在题库中、不丢失。
 */
import { addQuestions, addSection, createPaper } from './papers'
import type { Paper } from './types'

/** 重建同内容副本，返回新试卷。 */
export async function recreatePaperCopy(full: Paper): Promise<Paper> {
  let cur = await createPaper({
    title: full.title,
    template: full.template,
    answer_mode: full.answer_mode,
    subject: full.subject ?? undefined,
    stage: full.stage ?? undefined,
    grade: full.grade ?? undefined,
  })
  // 1) 重建大题（按原 seq 顺序），并记录「旧大题 id → 新大题 id」。
  const secMap = new Map<number, number>()
  const knownIds = new Set(cur.sections.map((s) => s.id))
  for (const s of [...full.sections].sort((a, b) => a.seq - b.seq)) {
    cur = await addSection(cur.id, { name: s.name, position: s.seq, description: s.description ?? undefined })
    const added = cur.sections.find((x) => !knownIds.has(x.id))
    if (added) {
      secMap.set(s.id, added.id)
      knownIds.add(added.id)
    }
  }
  // 2) 重建题目（按原 seq 升序、以 position=原 seq 插入，复现原全卷顺序）。
  for (const it of [...full.items].sort((a, b) => a.seq - b.seq)) {
    cur = await addQuestions(cur.id, {
      question_ids: [it.question_id],
      section_id: it.section_id != null ? secMap.get(it.section_id) ?? undefined : undefined,
      position: it.seq,
      score: it.score ?? undefined,
    })
  }
  return cur
}
