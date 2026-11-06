// @vitest-environment happy-dom
import { act, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterModel } from './CharacterModel'
import { makeDefaultCharacter } from '../state/defaults'
import type { CharacterConfig } from '../core/types'

const runtime = vi.hoisted(() => ({
  base: Promise.resolve({}),
  create: vi.fn(() => ({ root: {}, irisMaterial: { color: { set: vi.fn() } } })),
  requests: [] as { config: CharacterConfig; current: () => boolean; finish: () => void }[],
  wardrobe: null as null | { bodyRevision: number; config: CharacterConfig; onReady: () => void },
}))
vi.mock('../makehuman/TargetLoader', () => ({ loadMakeHumanBase: () => runtime.base }))
vi.mock('../makehuman/MakeHumanRuntime', () => ({
  createMakeHumanInstance: runtime.create,
  disposeMakeHumanMouth: vi.fn(),
  morphMakeHuman: (_instance: unknown, config: CharacterConfig, current: () => boolean, _expression: string, commit: () => void) =>
    new Promise<number>(resolve => runtime.requests.push({ config, current, finish: () => { if (current()) commit(); resolve(1) } })),
}))
vi.mock('@react-three/drei', () => ({ useTexture: () => null }))
vi.mock('../assets/AssetLibrary', () => ({ useAssetLibrary: () => ({ manifest: null }) }))
vi.mock('./SkinSurface', () => ({ applySkinSurface: vi.fn() }))
vi.mock('./IdleAnimation', () => ({
  captureAnimatedPose: () => new Map(), recalibrateAfterMorph: async () => {},
  IdleAnimation: ({ onReady }: { onReady: () => void }) => { useEffect(onReady, [onReady]); return null },
}))
vi.mock('./WardrobeManager', () => ({
  WardrobeManager: (props: NonNullable<typeof runtime.wardrobe>) => { runtime.wardrobe = props; return null },
}))

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  if (root) await act(() => root!.unmount())
  root = undefined
  runtime.requests = []; runtime.wardrobe = null; runtime.create.mockClear()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

async function render(config: CharacterConfig, revision: number, ready: () => void, expression: 'neutral' | 'happy' = 'neutral') {
  await act(() => root!.render(<Suspense><CharacterModel config={config} revision={revision} expression={expression} onReady={ready} /></Suspense>))
  await act(() => vi.advanceTimersByTimeAsync(40))
}

async function finishLatest() {
  const request = runtime.requests.at(-1)!
  await act(() => request.finish())
}

describe('reused wardrobe runtime', () => {
  it('keeps one body and accepts readiness only from the current completed selection', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    root = createRoot(document.body.appendChild(document.createElement('div')))
    const a = makeDefaultCharacter(), b = structuredClone(a), c = structuredClone(a)
    b.body.shoulders = .7; c.body.shoulders = .3
    const readyA = vi.fn(), readyB = vi.fn(), readyC = vi.fn()
    await render(a, 0, readyA)
    await finishLatest()
    await act(() => runtime.wardrobe!.onReady())
    expect(readyA).toHaveBeenCalledOnce()
    const oldWardrobeReady = runtime.wardrobe!.onReady

    await render(b, 1, readyB)
    const stale = runtime.requests.at(-1)!
    expect(runtime.wardrobe!.config).toBe(a)
    await render(c, 2, readyC)
    expect(stale.current()).toBe(false)
    await act(() => { stale.finish(); oldWardrobeReady() })
    expect(readyB).not.toHaveBeenCalled()
    expect(readyC).not.toHaveBeenCalled()
    await finishLatest()
    expect(runtime.wardrobe!.config).toBe(c)
    await act(() => runtime.wardrobe!.onReady())
    expect(readyC).toHaveBeenCalledOnce()
    expect(runtime.create).toHaveBeenCalledOnce()

    // A facial-expression request may cancel a body edit before it completes;
    // clothes must still be fitted to that new body's proportions afterwards.
    const bodyRevision = runtime.wardrobe!.bodyRevision
    const edited = { ...c, body: { ...c.body, height: .6 } }
    await render(edited, 2, readyC)
    const pendingEdit = runtime.requests.at(-1)!
    await render(edited, 2, readyC, 'happy')
    expect(pendingEdit.current()).toBe(false)
    await finishLatest()
    expect(runtime.wardrobe!.bodyRevision).toBeGreaterThan(bodyRevision)
    expect(runtime.create).toHaveBeenCalledOnce()
  })
})
