import { createRoot, type Root } from 'react-dom/client'
import {
  PresetPreviewExporter,
  type PreviewExportProgress,
} from './studio/editor/PresetPreviewExporter'

const TAG_NAME = 'backrooms-wardrobe-preview-exporter'

class BackroomsWardrobePreviewExporterElement extends HTMLElement {
  private reactRoot: Root | null = null

  static get observedAttributes() { return ['active'] }

  connectedCallback() {
    this.syncMountState()
  }

  disconnectedCallback() {
    this.unmountExporter()
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncMountState()
  }

  private syncMountState() {
    if (this.hasAttribute('active')) this.mountExporter()
    else this.unmountExporter()
  }

  private mountExporter() {
    if (this.reactRoot) return
    this.reactRoot = createRoot(this)
    this.reactRoot.render(
      <PresetPreviewExporter
        active
        onProgress={this.handleProgress}
        onComplete={this.handleComplete}
        onError={this.handleError}
      />,
    )
  }

  private readonly handleProgress = (progress: PreviewExportProgress) => {
    this.dispatchEvent(new CustomEvent('wardrobe-preview-progress', {
      bubbles: true,
      composed: true,
      detail: progress,
    }))
  }

  private readonly handleComplete = (zip: Blob) => {
    this.dispatchEvent(new CustomEvent('wardrobe-preview-complete', {
      bubbles: true,
      composed: true,
      detail: zip,
    }))
  }

  private readonly handleError = (message: string) => {
    this.dispatchEvent(new CustomEvent('wardrobe-preview-error', {
      bubbles: true,
      composed: true,
      detail: message,
    }))
  }

  private unmountExporter() {
    if (!this.reactRoot) return
    this.reactRoot.unmount()
    this.reactRoot = null
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, BackroomsWardrobePreviewExporterElement)
}

export { BackroomsWardrobePreviewExporterElement }
