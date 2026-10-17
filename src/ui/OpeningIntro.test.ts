// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => ({ prepare: vi.fn(), unlock: vi.fn(), playIntroCue: vi.fn(), stopIntroCue: vi.fn() }))
vi.mock('../audio/SiteAudio', () => ({ siteAudio: audio }))
import { OpeningIntro } from './OpeningIntro'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
let frames: Map<number, FrameRequestCallback>, nextFrame: number, now: number
const step = (delta = 50) => {
  now += delta
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(now))
}
let intro: OpeningIntro

beforeEach(() => {
  vi.resetAllMocks()
  frames = new Map(); nextFrame = 0; now = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  audio.prepare.mockResolvedValue(undefined)
  audio.unlock.mockResolvedValue(true)
})
afterEach(() => { intro?.dispose(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('opening labels and sound share one prepared timeline', () => {
  it('waits for the scene and decoded sounds, then shows every cue despite a long blocked frame', async () => {
    const scene = deferred(), buffers = deferred()
    audio.prepare.mockReturnValue(buffers.promise)
    intro = new OpeningIntro(scene.promise)
    const button = document.querySelector<HTMLButtonElement>('.opening-start')!
    button.click()
    await settle()
    expect(audio.unlock).toHaveBeenCalledOnce()
    expect(document.querySelector('.is-current')).toBeNull()
    scene.resolve(); await settle(); step(6000)
    expect(audio.playIntroCue).not.toHaveBeenCalled()
    buffers.resolve(); await settle(); step()
    expect(document.querySelector('.opening-warning.is-current')).not.toBeNull()
    expect(audio.playIntroCue.mock.calls).toEqual([['warning']])
    step(6000)
    expect(document.querySelector('.opening-warning.is-current')).not.toBeNull()
    let finished = false
    void intro.minimumDuration.then(() => { finished = true })
    for (let i = 0; i < 150; i++) step()
    await settle()
    expect(audio.playIntroCue.mock.calls).toEqual([['warning'], ['headphones'], ['credit'], ['title']])
    expect(document.querySelectorAll('.is-current')).toHaveLength(1)
    expect(document.querySelector('.opening-brand.is-current')).not.toBeNull()
    expect(finished).toBe(true)
  })

  it('retains the launch gesture if the browser refused audio, and retries on a real click', async () => {
    audio.unlock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    intro = new OpeningIntro()
    const button = document.querySelector<HTMLButtonElement>('.opening-start')!
    button.click(); await settle(); step()
    expect(button.disabled).toBe(false)
    expect(audio.playIntroCue).not.toHaveBeenCalled()
    button.click(); await settle(); step()
    expect(audio.playIntroCue).toHaveBeenCalledWith('warning')
  })

  it('pauses in a hidden tab and cancels all delayed work when disposed during loading', async () => {
    intro = new OpeningIntro()
    document.querySelector<HTMLButtonElement>('.opening-start')!.click()
    await settle(); step()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    for (let i = 0; i < 100; i++) step(1000)
    expect(audio.playIntroCue).toHaveBeenCalledTimes(1)
    hidden.mockReturnValue(false); step()
    expect(audio.playIntroCue.mock.calls).toEqual([['warning'], ['warning']])
    intro.dispose()
    const buffers = deferred()
    audio.prepare.mockReturnValue(buffers.promise)
    intro = new OpeningIntro()
    document.querySelector<HTMLButtonElement>('.opening-start')!.click()
    intro.dispose(); buffers.resolve(); await settle(); step()
    expect(document.querySelector('.opening-intro')).toBeNull()
    expect(frames.size).toBe(0)
  })

  it('keeps the reduced-motion title readable without playing invisible label sounds', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    intro = new OpeningIntro()
    document.querySelector<HTMLButtonElement>('.opening-start')!.click()
    await settle(); step()
    for (let i = 0; i < 20; i++) step()
    await intro.minimumDuration
    expect(audio.playIntroCue.mock.calls).toEqual([['title']])
  })
})
