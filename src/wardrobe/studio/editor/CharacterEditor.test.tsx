// @vitest-environment happy-dom
import { act, type PropsWithChildren } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterEditor } from './CharacterEditor'
import { CHARACTER_OPTIONS } from './characterOptions'
import { useCharacterState } from '../state/CharacterState'
import { makeDefaultCharacter } from '../state/defaults'

const viewport = vi.hoisted(() => ({ current: null as null | {
  modelKey: number; externalLoading: boolean; onCharacterReady: (revision: number) => void
} }))
vi.mock('../viewport/EditorViewport', () => ({
  EditorViewport: (props: NonNullable<typeof viewport.current>) => { viewport.current = props; return null },
}))
vi.mock('../assets/AssetLibrary', () => ({
  AssetLibrary: ({ children }: PropsWithChildren) => children,
  useAssetLibrary: () => ({ loading: false, error: null, manifest: null, bySlot: () => [], find: () => null }),
}))
vi.mock('./PresetThumbnailGenerator', () => ({ PresetThumbnailGenerator: () => null }))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
})

async function mount() {
  // React's DOM test renderer requires this marker when act is used without a
  // testing-library wrapper. The canvas itself is replaced by a deferred load.
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useCharacterState.setState({ config: makeDefaultCharacter() })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(() => root.render(<CharacterEditor />))
  return host
}

async function choose(host: HTMLElement, label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Choisir ${label}"]`)!
  expect(button.disabled).toBe(false)
  await act(() => button.click())
  return { ...viewport.current! }
}

describe('wardrobe selection while a character is loading', () => {
  it('accepts rapid preset replacements and only the latest readiness clears the loading state', async () => {
    const host = await mount()
    const first = await choose(host, CHARACTER_OPTIONS[1].label)
    const second = await choose(host, CHARACTER_OPTIONS[2].label)
    const last = await choose(host, CHARACTER_OPTIONS[0].label)
    expect(first.modelKey).toBeLessThan(second.modelKey)
    expect(second.modelKey).toBeLessThan(last.modelKey)
    expect(useCharacterState.getState().config.name).toBe(CHARACTER_OPTIONS[0].label)
    expect(host.querySelector('.character-choice-grid button.selected')?.getAttribute('aria-label'))
      .toBe(`Choisir ${CHARACTER_OPTIONS[0].label}`)
    await act(() => { second.onCharacterReady(second.modelKey); first.onCharacterReady(first.modelKey) })
    expect(viewport.current!.externalLoading).toBe(true)
    await act(() => last.onCharacterReady(last.modelKey))
    expect(viewport.current!.externalLoading).toBe(false)
  })

  it('lets the custom character supersede a built-in load and vice versa', async () => {
    const custom = { ...makeDefaultCharacter(), id: 'custom', name: 'Mon personnage' }
    localStorage.setItem('backrooms/wardrobe/custom-character/v1', JSON.stringify({ config: custom, sourcePresetId: null }))
    const host = await mount()
    const first = await choose(host, CHARACTER_OPTIONS[1].label)
    const last = await choose(host, custom.name)
    expect(useCharacterState.getState().config.id).toBe('custom')
    await act(() => first.onCharacterReady(first.modelKey))
    expect(viewport.current!.externalLoading).toBe(true)
    await act(() => last.onCharacterReady(last.modelKey))
    expect(viewport.current!.externalLoading).toBe(false)
    const next = await choose(host, CHARACTER_OPTIONS[2].label)
    await act(() => last.onCharacterReady(last.modelKey))
    expect(viewport.current!.externalLoading).toBe(true)
    await act(() => next.onCharacterReady(next.modelKey))
    expect(viewport.current!.externalLoading).toBe(false)
  })
})
