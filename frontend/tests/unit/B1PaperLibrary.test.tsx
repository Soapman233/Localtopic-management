/** 统一管理真实组件验证：整卷确认、取消、失败、权限、当前卷清理及副本门禁。 */
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import PaperLibraryDrawer from '../../src/components/PaperLibraryDrawer'
import { usePaperStore } from '../../src/store/paperStore'
import { useUiStore } from '../../src/store/uiStore'
import { renderPage } from './pages/pageTestUtils'
import type { Paper } from '../../src/api/types'
const mocks = vi.hoisted(() => ({ list:vi.fn(), get:vi.fn(), remove:vi.fn(), create:vi.fn(), rebuild:vi.fn(), allowed:true }))
vi.mock('../../src/api/papers', () => ({ listPapers:mocks.list, getPaper:mocks.get, deletePaper:mocks.remove, createPaper:mocks.create }))
vi.mock('../../src/api/paperRestore', () => ({ recreatePaperCopy:mocks.rebuild }))
vi.mock('../../src/hooks/usePermission', () => ({ usePermission:()=>mocks.allowed }))
const full = { id:4,title:'完整卷',template:'考试',answer_mode:'学生版',items:[{id:1},{id:2}],sections:[] } as unknown as Paper
const select = vi.fn()
function open() { return renderPage(<PaperLibraryDrawer open onClose={vi.fn()} onSelectPaper={select} />) }
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed=true
  mocks.list.mockResolvedValue([{...full,item_count:99}]); mocks.get.mockResolvedValue(full)
  mocks.remove.mockResolvedValue({}); mocks.create.mockResolvedValue({...full,id:8}); mocks.rebuild.mockResolvedValue({...full,id:9})
  usePaperStore.setState({currentPaperId:4,targetSectionId:17}); useUiStore.setState({previewFresh:{4:true,9:true}})
})
it('确认题数来自整卷而非过时列表，取消零删除', async () => {
  open(); fireEvent.click(await screen.findByRole('button',{name:'删除试卷完整卷'}))
  expect(await screen.findByText('2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'取消'})); expect(mocks.remove).not.toHaveBeenCalled()
})
it('整卷读取失败不出现可提交确认', async () => {
  mocks.get.mockRejectedValue(new Error('断网')); open()
  fireEvent.click(await screen.findByRole('button',{name:'删除试卷完整卷'}))
  expect(await screen.findByText('读取整卷失败：断网')).toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'确认删除'})).toBeNull(); expect(mocks.remove).not.toHaveBeenCalled()
})
it('确认期间题数变化更新影响并要求重新确认', async () => {
  mocks.get.mockResolvedValueOnce(full).mockResolvedValue({...full,items:[{id:1}]})
  open(); fireEvent.click(await screen.findByRole('button',{name:'删除试卷完整卷'}))
  fireEvent.click(await screen.findByRole('button',{name:'确认删除'}))
  expect(await screen.findByText('试卷题数已变化，请核对最新题数后再次确认。')).toBeInTheDocument()
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'确认删除'}))
  await waitFor(()=>expect(mocks.remove).toHaveBeenCalledWith(4,true))
})
it('删除当前卷清选择和目标；重建新ID重新锁定导出', async () => {
  open(); fireEvent.click(await screen.findByRole('button',{name:'删除试卷完整卷'}))
  fireEvent.click(await screen.findByRole('button',{name:'确认删除'}))
  await waitFor(()=>expect(usePaperStore.getState().currentPaperId).toBeNull())
  expect(usePaperStore.getState().targetSectionId).toBeNull()
  fireEvent.click(await screen.findByRole('button',{name:'重建副本'}))
  await waitFor(()=>expect(select).toHaveBeenCalledWith(9))
  expect(useUiStore.getState().previewFresh[9]).toBe(false)
})
it('删除完成时若已切换其他卷不会清掉新选择', async () => {
  let finish!: (value: unknown)=>void
  mocks.remove.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  open(); fireEvent.click(await screen.findByRole('button',{name:'删除试卷完整卷'}))
  fireEvent.click(await screen.findByRole('button',{name:'确认删除'}))
  await waitFor(()=>expect(mocks.remove).toHaveBeenCalled())
  usePaperStore.setState({currentPaperId:7,targetSectionId:23}); finish({})
  await screen.findByRole('button',{name:'重建副本'})
  expect(usePaperStore.getState().currentPaperId).toBe(7); expect(usePaperStore.getState().targetSectionId).toBe(23)
})
it('权限不足不新建不读删除整卷', async () => {
  mocks.allowed=false; open()
  const remove=await screen.findByRole('button',{name:'删除试卷完整卷'})
  expect(remove).toBeDisabled(); fireEvent.click(remove)
  expect(screen.getByRole('button',{name:'新建'})).toBeDisabled()
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
})
