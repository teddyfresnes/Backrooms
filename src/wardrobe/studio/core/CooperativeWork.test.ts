import { afterEach, describe, expect, it, vi } from 'vitest'
import { CooperativeWork, runWork, textLines } from './CooperativeWork'

afterEach(() => vi.restoreAllMocks())

describe('interruptible wardrobe work', () => {
  it('lets a new input supersede a busy calculation before it can commit', async () => {
    let current = true, clock = 0, chunks = 0, committed = false
    vi.spyOn(performance, 'now').mockImplementation(() => clock += 5)
    const input = new Promise<void>(resolve => setTimeout(() => { current = false; resolve() }, 0))
    function* prepare() {
      for (let i = 0; i < 100; i++) { chunks++; yield }
      committed = true
      return 123
    }
    await expect(runWork(prepare(), new CooperativeWork(() => current))).rejects.toMatchObject({ name: 'AbortError' })
    await input
    expect(chunks).toBeLessThan(100)
    expect(committed).toBe(false)
  })

  it('rejects obsolete work before starting and keeps line parsing equivalent for CRLF/final lines', async () => {
    let started = false
    function* prepare() { started = true; yield; return 1 }
    await expect(runWork(prepare(), new CooperativeWork(() => false))).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBe(false)
    expect([...textLines('one\r\n\nthree')].map(line => line.trim())).toEqual(['one', '', 'three'])
  })
})
