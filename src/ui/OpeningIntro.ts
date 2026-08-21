const INTRO_MINIMUM_MS = 5900
const INTRO_REDUCED_MOTION_MS = 900
const INTRO_EXIT_MS = 900

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function photosensitivityIcon(): string {
  return `
    <svg viewBox="0 0 64 64" role="img" aria-label="Avertissement photosensibilité">
      <path d="M32 8 57 53H7L32 8Z" />
      <path d="M32 23v15" />
      <path d="M32 46h.01" />
    </svg>
  `
}

function headphoneIcon(): string {
  return `
    <svg viewBox="0 0 64 64" role="img" aria-label="Casque audio">
      <path d="M13 35v-5c0-12 8.2-21 19-21s19 9 19 21v5" />
      <rect x="9" y="31" width="11" height="21" rx="5.5" />
      <rect x="44" y="31" width="11" height="21" rx="5.5" />
      <path d="M20 36h4v12h-4M44 36h-4v12h4" />
      <g class="opening-audio-meter" aria-hidden="true">
        <path d="M27 42v4" />
        <path d="M32 39v10" />
        <path d="M37 42v4" />
      </g>
    </svg>
  `
}

export class OpeningIntro {
  readonly minimumDuration: Promise<void>
  private readonly root: HTMLElement
  private disposed = false

  constructor() {
    this.root = document.createElement('section')
    this.root.className = 'opening-intro'
    this.root.setAttribute('aria-label', 'Introduction de Backrooms Random Story')
    this.root.innerHTML = `
      <div class="opening-curtain" aria-hidden="true"></div>
      <div class="opening-scan" aria-hidden="true"></div>

      <div class="opening-card opening-warning">
        <div class="opening-illustration">${photosensitivityIcon()}</div>
        <div class="opening-card-copy">
          <span>Avertissement</span>
          <strong>PHOTOSENSIBILITÉ</strong>
          <p>Ce jeu contient des lumières vacillantes et des contrastes intenses.</p>
        </div>
      </div>

      <div class="opening-card opening-audio">
        <div class="opening-illustration opening-headphones">${headphoneIcon()}</div>
        <div class="opening-card-copy">
          <span>Audio recommandé</span>
          <strong>UTILISEZ UN CASQUE</strong>
          <p>Pour une immersion optimale</p>
        </div>
      </div>

      <div class="opening-card opening-credit">
        <div class="opening-card-copy">
          <span>Made by</span>
          <strong>teddyfresnes</strong>
        </div>
      </div>

      <div class="opening-brand" aria-label="Backrooms Random Story">
        <img class="opening-brand-mark" src="/favicon.svg" alt="" />
        <div class="opening-brand-copy">
          <strong data-text="Backrooms">Backrooms</strong>
          <small>Random story</small>
        </div>
      </div>
    `
    document.documentElement.classList.add('opening-intro-active')
    document.body.append(this.root)
    requestAnimationFrame(() => this.root.classList.add('is-running'))

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.minimumDuration = wait(reducedMotion ? INTRO_REDUCED_MOTION_MS : INTRO_MINIMUM_MS)
  }

  async finish(): Promise<void> {
    await this.minimumDuration
    if (this.disposed) return
    this.root.classList.add('is-leaving')

    const revealTimer = window.setTimeout(() => {
      if (!this.disposed) document.documentElement.classList.remove('opening-intro-active')
    }, 160)

    await wait(INTRO_EXIT_MS)
    window.clearTimeout(revealTimer)
    if (this.disposed) return
    this.root.remove()
    document.documentElement.classList.remove('opening-intro-active')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.root.remove()
    document.documentElement.classList.remove('opening-intro-active')
  }
}
