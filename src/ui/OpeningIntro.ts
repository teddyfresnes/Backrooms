import { siteAudio, type IntroCue } from '../audio/SiteAudio'

const INTRO_REDUCED_MOTION_MS = 900
const INTRO_EXIT_MS = 900
const PHASES: readonly { cue: IntroCue; selector: string; duration: number }[] = [
  { cue: 'warning', selector: '.opening-warning', duration: 1300 },
  { cue: 'headphones', selector: '.opening-audio', duration: 1900 },
  { cue: 'credit', selector: '.opening-credit', duration: 1500 },
  { cue: 'title', selector: '.opening-brand', duration: 1200 },
]

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
  private frame?: number
  private resolveMinimum = (): void => undefined
  private minimumResolved = false
  private disposed = false
  private starting = false

  constructor(environmentReady: Promise<void> = Promise.resolve()) {
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

      <button class="opening-start" type="button">JOUER</button>
    `
    document.documentElement.classList.add('opening-intro-active')
    document.body.append(this.root)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.minimumDuration = new Promise((resolve) => {
      this.resolveMinimum = () => {
        if (this.minimumResolved) return
        this.minimumResolved = true
        resolve()
      }
    })
    const preparation = Promise.all([environmentReady, siteAudio.prepare(), document.fonts?.ready])
    // The launch gesture resumes audio immediately, but no label/cue starts
    // until loading, decoding and fonts are ready. CSS no longer has a second,
    // independent wall-clock timeline that can skip the readable label frames.
    void preparation.catch(() => undefined)
    const start = async (): Promise<void> => {
      if (this.disposed || this.starting) return
      this.starting = true
      const button = this.root.querySelector<HTMLButtonElement>('.opening-start')!
      button.disabled = true
      button.textContent = 'CHARGEMENT…'
      this.root.setAttribute('aria-busy', 'true')
      try {
        const [unlocked] = await Promise.all([siteAudio.unlock(), preparation])
        if (this.disposed) return
        if (!unlocked) {
          this.starting = false
          button.disabled = false
          button.textContent = 'ACTIVER LE SON'
          this.root.removeAttribute('aria-busy')
          return
        }
        this.root.removeAttribute('aria-busy')
        this.root.classList.add('is-running')
        this.runTimeline(reducedMotion)
      } catch {
        if (this.disposed) return
        this.starting = false
        button.disabled = false
        button.textContent = 'RÉESSAYER'
        this.root.removeAttribute('aria-busy')
      }
    }
    this.root.querySelector<HTMLButtonElement>('.opening-start')?.addEventListener('click', () => { void start() })
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
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    siteAudio.stopIntroCue()
    this.resolveMinimum()
    this.root.remove()
    document.documentElement.classList.remove('opening-intro-active')
  }

  private runTimeline(reducedMotion: boolean): void {
    const phases = reducedMotion ? [{ ...PHASES[3], duration: INTRO_REDUCED_MOTION_MS }] : PHASES
    let index = 0
    let elapsed = 0
    let previous: number | undefined
    let active: HTMLElement | null = null
    let wasHidden = false
    const tick = (now: number): void => {
      if (this.disposed) return
      if (document.hidden) {
        if (!wasHidden) siteAudio.stopIntroCue()
        wasHidden = true
        previous = now
      } else {
        // A blocked frame or a hidden tab must never consume a whole card.
        const delta = previous === undefined || wasHidden ? 0 : Math.min(50, Math.max(0, now - previous))
        previous = now
        if (!active || wasHidden) {
          active = this.root.querySelector<HTMLElement>(phases[index].selector)!
          active.classList.add('is-current')
          active.setAttribute('aria-hidden', 'false')
          siteAudio.playIntroCue(phases[index].cue)
          elapsed = 0
          wasHidden = false
        }
        elapsed += delta
        if (elapsed >= phases[index].duration) {
          if (index === phases.length - 1) {
            this.frame = undefined
            this.resolveMinimum()
            return
          }
          active.classList.remove('is-current')
          active.setAttribute('aria-hidden', 'true')
          active = null
          index++
          elapsed = 0
        }
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }
}
