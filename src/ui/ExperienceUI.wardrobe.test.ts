import { describe, expect, it } from 'vitest'

const loadNodeFs = async () => {
  // @ts-expect-error Node typings are intentionally absent from production.
  return import('node:fs/promises')
}

describe('wardrobe shell integration', () => {
  it('embeds the complete wardrobe popup and developer tools in the current menu', async () => {
    const { readFile } = await loadNodeFs()
    const [ui, styles, developerStyles] = await Promise.all([
      readFile(new URL('./ExperienceUI.ts', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../wardrobe/developer.css', import.meta.url), 'utf8'),
    ])

    expect(ui).toContain("type MenuPage = 'home' | 'saves' | 'wardrobe' | 'settings';")
    expect(ui).toContain('data-page="wardrobe"')
    expect(ui).toContain('<backrooms-wardrobe data-ui="wardrobe-host"></backrooms-wardrobe>')
    expect(ui).toContain("wardrobeHost?.toggleAttribute('active', page === 'wardrobe');")
    expect(ui).toContain("void import('../wardrobe/BackroomsWardrobeElement');")

    expect(ui.match(/data-open-page="wardrobe"/g)).toHaveLength(2)
    expect(ui).toContain('<span>Garde-robe</span>')
    expect(ui).toContain('<span>Continuer</span>')
    expect(ui).toContain('<span>Nouvelle partie</span>')
    expect(ui).toContain('<h2 id="settings-title">Paramètres</h2>')
    expect(ui).toContain('data-settings-category="developer">Développeur</button>')
    expect(ui).toContain('data-settings-panel="developer"')
    expect(ui).toContain("this.developerCode.value === '1234'")
    expect(ui).toContain("void import('../wardrobe/BackroomsWardrobePreviewExporterElement')")
    expect(ui).toContain('backrooms-character-previews-${stamp}.zip')

    expect(styles).toContain(".experience-ui[data-menu-page='wardrobe'] .menu-panel")
    expect(styles).toContain('border: 1px solid var(--menu-border)')
    expect(styles).toContain('--accent: #daca73')
    expect(developerStyles).toContain('.experience-ui .developer-gate')
    expect(developerStyles).toContain('.experience-ui .developer-console')
    expect(developerStyles).toContain('.preview-export-renderer')
  })
})
