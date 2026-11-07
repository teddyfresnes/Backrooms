import './story-hud.css';

export type QuestTone = 'calm' | 'urgent' | 'hidden';

/**
 * Story overlays owned by the stairwell runtime: the current objective, a
 * keyboard tooltip, the jumpscare flash and the death card. Pure DOM, no loop:
 * the host advances it with its played time.
 */
export class StoryHud {
  private readonly root = document.createElement('div');
  private readonly quest = document.createElement('section');
  private readonly questText = document.createElement('p');
  private readonly hint = document.createElement('div');
  private readonly hintKey = document.createElement('kbd');
  private readonly hintText = document.createElement('span');
  private readonly holdBar = document.createElement('i');
  private readonly flash = document.createElement('div');
  private readonly fade = document.createElement('div');
  private readonly death = document.createElement('section');
  private readonly deathDetail = document.createElement('p');
  private hintRemaining = 0;
  private flashLevel = 0;
  private questKey = '';

  constructor(container: HTMLElement) {
    this.root.className = 'story-hud';
    this.quest.className = 'story-quest';
    this.quest.hidden = true;
    this.quest.setAttribute('aria-live', 'polite');
    const label = document.createElement('small');
    label.textContent = 'Objectif';
    this.quest.append(label, this.questText);
    this.hint.className = 'story-hint';
    this.hint.hidden = true;
    this.holdBar.className = 'story-hint-hold';
    this.holdBar.hidden = true;
    this.hint.append(this.hintKey, this.hintText, this.holdBar);
    this.flash.className = 'story-flash';
    this.fade.className = 'story-fade';
    this.death.className = 'story-death';
    this.death.hidden = true;
    const title = document.createElement('h2');
    title.textContent = 'Il t’a eu.';
    this.deathDetail.textContent = 'Retour dans le hall…';
    this.death.append(title, this.deathDetail);
    this.root.append(this.quest, this.hint, this.flash, this.fade, this.death);
    container.append(this.root);
  }

  setQuest(text: string | null, tone: QuestTone = 'calm'): void {
    const key = `${tone}:${text ?? ''}`;
    if (key === this.questKey) return;
    this.questKey = key;
    this.quest.hidden = !text;
    if (!text) return;
    this.questText.textContent = text;
    this.quest.dataset.tone = tone;
    // Restart the arrival animation on every new objective.
    this.quest.classList.remove('is-new');
    void this.quest.offsetWidth;
    this.quest.classList.add('is-new');
  }

  showHint(key: string, text: string, seconds: number, urgent = false): void {
    this.hintKey.textContent = key;
    this.hintText.textContent = text;
    this.hint.classList.toggle('is-urgent', urgent);
    this.hint.hidden = false;
    this.hintRemaining = seconds;
  }

  hideHint(): void { this.hintRemaining = 0; this.hint.hidden = true; this.setHold(null); }

  /** Fill of a hold-to-act prompt (0..1), or null to hide the bar. */
  setHold(progress: number | null): void {
    this.holdBar.hidden = progress === null;
    this.hint.classList.toggle('is-holding', progress !== null);
    if (progress !== null) this.holdBar.style.setProperty('--hold', Math.min(1, Math.max(0, progress)).toFixed(3));
  }
  get isHintVisible(): boolean { return !this.hint.hidden; }

  /** Red/white strobe of the jumpscare (0..1, decays by itself). */
  pulseFlash(level: number): void { this.flashLevel = Math.max(this.flashLevel, Math.min(1, level)); }

  /** Plain black over everything (0..1), e.g. the end of the fall before loading. */
  setFade(level: number): void { this.fade.style.opacity = Math.min(1, Math.max(0, level)).toFixed(3); }

  showDeath(visible: boolean, detail?: string): void {
    this.death.hidden = !visible;
    if (detail) this.deathDetail.textContent = detail;
  }

  setPlaying(playing: boolean): void { this.root.classList.toggle('is-paused', !playing); }

  update(delta: number): void {
    const dt = Math.max(0, Math.min(0.1, delta));
    if (this.hintRemaining > 0) {
      this.hintRemaining -= dt;
      if (this.hintRemaining <= 0) this.hint.hidden = true;
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.6);
    this.flash.style.opacity = this.flashLevel.toFixed(3);
  }

  dispose(): void { this.root.remove(); }
}
