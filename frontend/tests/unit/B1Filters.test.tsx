/** 回程URL保持仅作用于显式挂载；筛选键仍更新且未知query不进入API参数。 */
import { expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useQuestionFilters } from '../../src/hooks/useQuestionFilters'
function Probe({ preserve = false }: { preserve?: boolean }) {
  const f=useQuestionFilters({pageSize:15,preserveLocation:preserve})
  const location=useLocation()
  return <><pre data-testid="location">{JSON.stringify(location)}</pre><pre data-testid="query">{JSON.stringify(f.queryParams)}</pre>
    <button onClick={()=>f.setFilters({keyword:'new'})}>修改</button><button onClick={f.reset}>清空</button></>
}
function mount(preserve:boolean){render(<MemoryRouter initialEntries={[{pathname:'/builder',search:'?keyword=old&source=preview&debug=1&debug=2',state:{marker:'keep'}}]}><Probe preserve={preserve}/></MemoryRouter>)}
it('默认false保留原清未知query/state策略以及重复debug', async()=>{
  mount(false)
  await waitFor(()=>expect(JSON.parse(screen.getByTestId('location').textContent||'{}').state).toBeNull())
  const location=JSON.parse(screen.getByTestId('location').textContent||'{}')
  expect(location.search).toBe('?keyword=old&debug=1&debug=2')
})
it('true在防抖后保留source/debug重复/剩余state，修改清空仍只更新筛选', async()=>{
  mount(true)
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,650))})
  let location=JSON.parse(screen.getByTestId('location').textContent||'{}')
  expect(new URLSearchParams(location.search).get('source')).toBe('preview')
  expect(location.state).toEqual({marker:'keep'})
  expect(JSON.parse(screen.getByTestId('query').textContent||'{}')).not.toHaveProperty('source')
  fireEvent.click(screen.getByRole('button',{name:'修改'}))
  await waitFor(()=>expect(new URLSearchParams(JSON.parse(screen.getByTestId('location').textContent||'{}').search).get('keyword')).toBe('new'))
  fireEvent.click(screen.getByRole('button',{name:'清空'}))
  await waitFor(()=>expect(new URLSearchParams(JSON.parse(screen.getByTestId('location').textContent||'{}').search).has('keyword')).toBe(false))
  location=JSON.parse(screen.getByTestId('location').textContent||'{}')
  expect(new URLSearchParams(location.search).getAll('debug')).toEqual(['1','2'])
  expect(new URLSearchParams(location.search).get('source')).toBe('preview')
  expect(location.state).toEqual({marker:'keep'})
})
