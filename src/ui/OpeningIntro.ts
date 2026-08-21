const INTRO_MINIMUM_MS = 5900
const INTRO_REDUCED_MOTION_MS = 900
const INTRO_EXIT_MS = 1250

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function headphoneIcon(): string {
  return `
    <svg viewBox="0 0 96 96" role="img" aria-label="Casque audio">
      <path d="M18 51V43C18 25.3 31.4 12 48 12s30 13.3 30 31v8" />
      <path d="M22 47h7c4.4 0 8 3.6 8 8v18c0 4.4-3.6 8-8 8h-7c-5.5 0-10-4.5-10-10V57c0-5.5 4.5-10 10-10Z" />
      <path d="M74 47h-7c-4.4 0-8 3.6-8 8v18c0 4.4 3.6 8 8 8h7c5.5 0 10-4.5 10-10V57c0-5.5-4.5-10-10-10Z" />
      <path d="M59 79c-3 3.3-6.7 5-11 5" />
    </svg>
  `
}

function animateIntoTarget(source: HTMLElement, target: HTMLElement, duration: number): Animation {
  const from = source.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const scale = Math.min(to.width / Math.max(from.width, 1), to.height / Math.max(from.height, 1))
  return source.animate([
    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0)' },
    { opacity: 1, offset: .76, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, filter: 'blur(0)' },
    { opacity: 0, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, filter: 'blur(2px)' },
  ], { duration, easing: 'cubic-bezier(.2,.82,.16,1)', fill: 'forwards' })
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
        <span>Avertissement</span>
        <strong>PHOTOSENSIBILITÉ</strong>
        <p>Ce jeu contient des lumières vacillantes et des contrastes intenses.</p>
      </div>

      <div class="opening-card opening-audio">
        <div class="opening-headphones">${headphoneIcon()}</div>
        <strong>UTILISEZ UN CASQUE</strong>
        <p>Pour une immersion optimale</p>
      </div>

      <div class="opening-card opening-credit">
        <span>Made by</span>
        <strong>teddyfresnes</strong>
      </div>

      <div class="opening-brand" aria-label="Backrooms Random Story">
        <img class="opening-brand-mark" src="/favicon.svg" alt="" />
        <div class="opening-brand-copy">
          <strong>Backrooms</strong>
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

    const animations: Animation[] = []
    const introMark = this.root.querySelector<HTMLElement>('.opening-brand-mark')
    const introCopy = this.root.querySelector<HTMLElement>('.opening-brand-copy')
    const menuMark = document.querySelector<HTMLElement>('.experience-ui .home-logo')
    const menuCopy = document.querySelector<HTMLElement>('.experience-ui .home-wordmark')
    if (introMark && menuMark) animations.push(animateIntoTarget(introMark, menuMark, INTRO_EXIT_MS))
    if (introCopy && menuCopy) animations.push(animateIntoTarget(introCopy, menuCopy, INTRO_EXIT_MS))

    if (animations.length) {
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
    } else {
      await wait(INTRO_EXIT_MS)
    }
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
