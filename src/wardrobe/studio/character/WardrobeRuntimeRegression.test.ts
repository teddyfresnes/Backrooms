import { describe, expect, it } from 'vitest'

const loadNodeFs = async () => {
  // @ts-expect-error Node typings are intentionally absent from production.
  return import('node:fs/promises')
}

describe('wardrobe runtime regressions', () => {
  it('keeps the mouth backing behind the lips and hides it for closed expressions', async () => {
    const { readFile } = await loadNodeFs()
    const runtime = await readFile(new URL('../makehuman/MakeHumanRuntime.ts', import.meta.url), 'utf8')

    expect(runtime).toContain('center.z += .054')
    expect(runtime).toContain("cavity.visible = opening >= .1")
    expect(runtime).toContain("updateMouthInterior(instance, expression)")
    expect(runtime).toContain("updateMouthInterior(instance, 'neutral')")
  })
})
