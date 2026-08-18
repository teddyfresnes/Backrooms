import { createRoot, type Root } from 'react-dom/client'
import { CharacterEditor, type WardrobeNavigationBridge } from './studio/editor/CharacterEditor'
import wardrobeCss from './studio/wardrobe.css?inline'

const TAG_NAME = 'backrooms-wardrobe'

class BackroomsWardrobeElement extends HTMLElement {
  private reactRoot: Root | null = null
  private mountPoint: HTMLDivElement | null = null
  private styleElement: HTMLStyleElement | null = null
  private readonly navigationBridge: WardrobeNavigationBridge = {}

  static get observedAttributes() { return ['active'] }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' })
    this.syncMountState()
  }

  disconnectedCallback() {
    this.unmountEditor()
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncMountState()
  }

  private syncMountState() {
    if (this.hasAttribute('active')) this.mountEditor()
    else this.unmountEditor()
  }

  private mountEditor() {
    const shadow = this.shadowRoot
    if (!shadow || this.reactRoot) return

    if (!this.styleElement) {
      const style = document.createElement('style')
      style.textContent = wardrobeCss
      shadow.append(style)
      this.styleElement = style
    }
    if (!this.mountPoint) {
      const mountPoint = document.createElement('div')
      mountPoint.id = 'wardrobe-root'
      shadow.append(mountPoint)
      this.mountPoint = mountPoint
    }

    this.reactRoot = createRoot(this.mountPoint)
    this.reactRoot.render(<CharacterEditor navigationBridge={this.navigationBridge} />)
    this.dispatchEvent(new CustomEvent('wardrobe-mounted', { bubbles: true, composed: true }))
  }


  navigateBack(): boolean {
    return this.navigationBridge.back?.() ?? false
  }

  resetNavigation(): void {
    this.navigationBridge.reset?.()
  }

  private unmountEditor() {
    if (!this.reactRoot) return
    this.reactRoot.unmount()
    this.reactRoot = null
    this.dispatchEvent(new CustomEvent('wardrobe-unmounted', { bubbles: true, composed: true }))
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, BackroomsWardrobeElement)

export { BackroomsWardrobeElement }
