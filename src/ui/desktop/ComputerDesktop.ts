import { ApartmentQuest } from '../../story/ApartmentQuest';
import { DESKTOP_DOCUMENTS, DESKTOP_MAIL } from './DesktopContent';
import { MinesGame } from './MinesGame';
import './computer-desktop.css';

type AppId = 'clock' | 'mail' | 'web' | 'files' | 'mines' | 'trash' | 'about';
const APPS: Record<AppId, { title: string; symbol: string }> = {
  clock: { title: 'Horloge', symbol: '◷' }, mail: { title: 'Courrier', symbol: '✉' },
  web: { title: 'Internet', symbol: '◎' }, files: { title: 'Mes documents', symbol: '▰' },
  mines: { title: 'Démineur', symbol: '✳' }, trash: { title: 'Corbeille', symbol: '▥' }, about: { title: 'À propos', symbol: '?' },
};
const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const button = (label: string, action: string, extra = '') => `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
interface DesktopWindow { element: HTMLElement; body: HTMLElement; minimized: boolean }

/** A local fictional operating system. No webview, external URLs or independent game loop. */
export class ComputerDesktop {
  readonly element = document.createElement('section');
  private readonly screen: HTMLElement;
  private readonly tasks: HTMLElement;
  private readonly startMenu: HTMLElement;
  private readonly windows = new Map<AppId, DesktopWindow>();
  private opened = false;
  private disposed = false;
  private layer = 1;
  private selectedMail?: string;
  private search = '';
  private page: 'home' | 'portal' | 'receipt' = 'home';
  private mineAttempt = 0;
  private mines = new MinesGame();
  private flagMode = false;
  private mineEligible = false;
  private drag?: { window: HTMLElement; id: number; dx: number; dy: number };

  constructor(container: HTMLElement, private readonly quest: ApartmentQuest,
    private readonly onOpen: () => void, private readonly onClose: () => void,
    private readonly playClick = () => {}) {
    this.element.className = 'computer-desktop'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Ordinateur de l’appartement'); this.element.tabIndex = -1;
    this.element.innerHTML = `<div class="pc-bezel"><div class="pc-screen">
      <nav class="pc-menubar" aria-label="Menu du bureau">${button('Fichier', 'start')}${button('Affichage', 'view')}${button('Aide', 'app', 'data-app="about"')}<span>VOSTOK 98</span>${button('×', 'leave', 'aria-label="Quitter le PC"')}</nav>
      <div class="pc-icons">${(['files', 'mail', 'web', 'mines', 'trash'] as AppId[]).map(id =>
        `<button type="button" class="pc-icon" data-action="app" data-app="${id}"><i class="pc-icon-${id}" aria-hidden="true">${APPS[id].symbol}</i><span>${id === 'files' ? 'Poste de travail' : APPS[id].title}</span></button>`).join('')}</div>
      <div class="pc-start-menu" hidden><strong>Vostok <b>98</b></strong><div>${(['mail', 'web', 'files', 'clock', 'mines', 'about'] as AppId[]).map(id => button(`<i aria-hidden="true">${APPS[id].symbol}</i>${APPS[id].title}`, 'app', `data-app="${id}"`)).join('')}${button('Quitter le PC', 'leave')}</div></div>
      <footer class="pc-taskbar">${button('<i class="pc-start-mark" aria-hidden="true">▦</i> Démarrer', 'start', 'class="pc-start" aria-expanded="false"')}<div class="pc-tasks"></div>${button('◖ 00:30', 'app', 'data-app="clock" class="pc-tray" aria-label="Ouvrir l’horloge, 00:30"')}</footer>
    </div><div class="pc-brand">SyncMaster 3 <span>●</span></div></div>`;
    this.screen = this.element.querySelector('.pc-screen')!;
    this.tasks = this.element.querySelector('.pc-tasks')!;
    this.startMenu = this.element.querySelector('.pc-start-menu')!;
    this.element.addEventListener('click', this.click);
    this.element.addEventListener('input', this.input);
    this.element.addEventListener('contextmenu', this.contextMenu);
    this.element.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('blur', this.stopDrag);
    window.addEventListener('keydown', this.key, true);
    container.append(this.element);
  }
  get isOpen(): boolean { return this.opened; }
  setPaused(paused: boolean): void {
    this.element.hidden = !this.opened || paused;
    this.element.inert = paused;
    this.stopDrag();
    if (this.opened && !paused) this.element.focus({ preventScroll: true });
  }
  open(): void {
    if (this.opened || this.disposed || this.quest.isComputerBlocked) return;
    this.opened = true; this.element.hidden = false; this.quest.useComputer();
    this.onOpen(); this.playClick();
    if (!this.windows.size) this.openApp('clock');
    this.element.focus({ preventScroll: true });
  }
  interrupt(): void {
    if(!this.opened)return;this.opened=false;this.element.hidden=true;this.stopDrag();this.toggleStart(false);
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false; this.element.hidden = true; this.stopDrag(); this.toggleStart(false); this.onClose();
  }
  private toggleStart(show = this.startMenu.hidden): void {
    this.startMenu.hidden = !show;
    this.element.querySelector('[data-action="start"].pc-start')!.setAttribute('aria-expanded', String(show));
  }
  private openApp(id: AppId): void {
    this.toggleStart(false);
    let entry = this.windows.get(id);
    if (!entry) {
      const element = document.createElement('section');
      element.className = `pc-window pc-${id}`; element.dataset.app = id;
      element.setAttribute('aria-label', APPS[id].title);
      element.innerHTML = `<header class="pc-titlebar"><strong>${APPS[id].symbol} ${APPS[id].title}</strong><div>${button('−', 'minimize', `data-app="${id}" aria-label="Réduire ${APPS[id].title}"`)}${button('□', 'maximize', `data-app="${id}" aria-label="Agrandir ${APPS[id].title}"`)}${button('×', 'close', `data-app="${id}" aria-label="Fermer ${APPS[id].title}"`)}</div></header><div class="pc-window-body"></div>`;
      this.screen.append(element); entry = { element, body: element.querySelector('.pc-window-body')!, minimized: false };
      this.windows.set(id, entry); this.renderApp(id);
    }
    entry.minimized = false; entry.element.hidden = false; this.activate(id);
    this.renderTasks();
  }
  private activate(id: AppId): void {
    for (const [key, entry] of this.windows) entry.element.classList.toggle('pc-active', key === id);
    this.windows.get(id)!.element.style.zIndex = String(++this.layer);
  }
  private renderTasks(): void {
    this.tasks.innerHTML = [...this.windows].map(([id, entry]) => button(APPS[id].title, 'app', `data-app="${id}" class="${entry.minimized ? '' : 'pc-task-open'}"`)).join('');
  }
  private renderApp(id: AppId): void {
    const body = this.windows.get(id)!.body;
    if (id === 'clock') body.innerHTML = `<div class="pc-lcd" role="img" aria-label="00:30">${['0', '0', ':', '3', '0'].map(digit => digit === ':' ? '<b class="pc-colon">:</b>' : `<span class="pc-digit">${'abcdefg'.split('').map(segment => `<i class="seg-${segment}${({ '0': 'abcdef', '3': 'abcdg' }[digit] ?? '').includes(segment) ? ' lit' : ''}"></i>`).join('')}</span>`).join('')}</div>`;
    if (id === 'mail') {
      body.innerHTML = `<div class="pc-mail-toolbar"><strong>Boîte de réception</strong><label><span class="pc-sr">Rechercher dans les mails</span><input type="search" data-search placeholder="Rechercher…" value="${escape(this.search)}" /></label></div><div class="pc-mail-layout"><div class="pc-mail-list" role="list" aria-label="Messages"></div><article class="pc-mail-reader"><p class="pc-mail-empty">Sélectionnez un message.</p></article></div><footer class="pc-status">alex.morin · ${DESKTOP_MAIL.length} messages · Connexion établie</footer>`;
      this.renderMailList(); if (this.selectedMail) this.readMail(this.selectedMail);
    }
    if (id === 'web') this.renderWeb();
    if (id === 'mines') this.renderMines();
    if (id === 'files' || id === 'trash') {
      const names = id === 'trash' ? ['demission-brouillon.txt'] : ['budget.txt', 'demain.txt'];
      body.innerHTML = `<div class="pc-file-bar">${id === 'trash' ? 'Corbeille' : 'C:\\Mes documents'}</div><div class="pc-file-list">${names.map(name => button(`▤ ${name}`, 'document', `data-file="${name}"`)).join('')}</div><pre class="pc-document">${escape(DESKTOP_DOCUMENTS[names[0]!]!)}</pre>`;
    }
    if (id === 'about') body.innerHTML = '<div class="pc-about"><strong>VOSTOK 98</strong><p>Cette copie est enregistrée au nom de<br>A. Morin</p><p>Mémoire disponible : pas assez.<br>Temps disponible : pas assez non plus.</p><small>Échap / P : pause · × en haut à droite : quitter le PC.</small></div>';
  }
  private renderMailList(): void {
    const list = this.windows.get('mail')?.body.querySelector('.pc-mail-list'); if (!list) return;
    const read = new Set(this.quest.snapshot().readMailIds), query = normalize(this.search);
    const matches = DESKTOP_MAIL.filter(mail => normalize(`${mail.from} ${mail.subject} ${mail.body}`).includes(query));
    list.innerHTML = matches.length ? matches.map(mail => `<button type="button" role="listitem" data-action="mail" data-id="${mail.id}" class="${read.has(mail.id) ? '' : 'pc-unread'} ${mail.id === this.selectedMail ? 'pc-selected-mail' : ''}" aria-pressed="${mail.id === this.selectedMail}"><span>${escape(mail.from)}</span><time>${mail.date}</time><strong>${escape(mail.subject)}</strong></button>`).join('') : '<p class="pc-no-results">Aucun message.</p>';
  }
  private readMail(id: string): void {
    const mail = DESKTOP_MAIL.find(entry => entry.id === id); if (!mail) return;
    this.selectedMail = id; this.quest.readMail(id); this.renderMailList();
    const reader = this.windows.get('mail')!.body.querySelector('.pc-mail-reader')!;
    reader.innerHTML = `<header><h2>${escape(mail.subject)}</h2><p>De : ${escape(mail.from)}</p><small>À : alex.morin · ${mail.date}</small></header><p class="pc-mail-copy">${escape(mail.body)}</p>${mail.portal ? button('Ouvrir mon espace locataire ↗', 'portal', 'class="pc-mail-link"') : ''}`;
    reader.scrollTop = 0;
  }
  private renderWeb(): void {
    const body = this.windows.get('web')!.body;
    const address = this.page === 'home' ? 'accueil.vostok.local' : 'regie.vostok.local/mon-compte';
    body.innerHTML = `<div class="pc-browser-toolbar">${button('Accueil', 'web-home')}${button('Favoris : Régie Vostok', 'portal')}<div class="pc-address">${address}</div></div><div class="pc-website">${this.page === 'home'
      ? `<header><small>LE WEB, EN PLUS LENT.</small><h2>Bonsoir, Alex.</h2></header><p>Tout le monde semble avoir quelque chose à vous vendre.</p><div class="pc-web-tiles">${button('Régie Vostok · Mon compte locataire', 'portal')}<aside><strong>Transit Express</strong><p>Votre fidélité mérite<br>un grand soulagement.</p></aside><aside><strong>Nuit Privée · 18+</strong><p>Un message vous attend.<br>Comme tous les soirs.</p></aside></div>`
      : `<header class="pc-regie-head"><strong>VOSTOK</strong><small>GESTION LOCATIVE</small></header><h2>Espace locataire</h2><p>A. Morin · Référence RV-041 · Dernier étage</p>${this.page === 'portal' ? `<div class="pc-account-card"><strong>Un prélèvement a été rejeté.</strong><p>Votre situation locative a été actualisée.</p>${button('Consulter le solde', 'check-account')}</div>`
        : '<div class="pc-account-card"><small>RESTE À RÉGLER</small><strong class="pc-debt">142,60 €</strong><dl><div><dt>Loyer</dt><dd>615,00 €</dd></div><div><dt>Charges</dt><dd>89,00 €</dd></div><div><dt>Montant reçu</dt><dd>−561,40 €</dd></div></dl><p>Régularisation attendue demain. Le service ne répond pas la nuit.</p></div><p class="pc-after-account">Rien de plus à faire à cette heure-ci. Une partie de Démineur, puis dormir.</p>'}`}</div>`;
  }
  private renderMines(): void {
    const body = this.windows.get('mines')!.body, game = this.mines;
    body.innerHTML = `<div class="pc-mine-tools"><output>${String(game.mineCount - game.flags.size).padStart(3, '0')}</output>${button(game.status === 'lost' ? '☹' : game.status === 'won' ? '☺' : '☻', 'restart-mines', 'aria-label="Nouvelle partie de Démineur"')}<label><input type="checkbox" data-flag-mode ${this.flagMode ? 'checked' : ''} /> Drapeau</label></div><div class="pc-mine-grid" role="group" aria-label="Grille du Démineur">${Array.from({ length: 81 }, (_, cell) => {
      const revealed = game.revealed.has(cell), count = revealed ? game.count(cell) : 0, mine = revealed && game.mines.has(cell);
      return button(mine ? '✳' : revealed ? count ? String(count) : '' : game.flags.has(cell) ? '⚑' : '', 'mine', `data-cell="${cell}" data-count="${count}" class="${revealed ? 'revealed' : ''}${mine ? ' mine' : ''}" aria-label="Case ${Math.floor(cell / 9) + 1}, ${cell % 9 + 1}${revealed ? mine ? ', mine' : `, ${count}` : ''}" ${game.status === 'lost' || game.status === 'won' ? 'disabled' : ''}`);
    }).join('')}</div><footer class="pc-status">${game.status === 'lost' ? 'Perdu. Encore une ?' : game.status === 'won' ? 'Gagné. Il est toujours 00:30.' : 'Clic : découvrir · clic droit : drapeau'}</footer>`;
  }
  private readonly input = (event: Event): void => {
    if ((event.target as HTMLElement).matches('[data-search]')) { this.search = (event.target as HTMLInputElement).value; this.renderMailList(); }
    if ((event.target as HTMLElement).matches('[data-flag-mode]')) this.flagMode = (event.target as HTMLInputElement).checked;
  };
  private readonly click = (event: MouseEvent): void => {
    if (!this.opened) return;
    const control = (event.target as Element).closest<HTMLElement>('[data-action]'); if (!control) return;
    this.playClick();
    const action = control.dataset.action, id = control.dataset.app as AppId;
    switch (action) {
      case 'leave': this.close(); break;
      case 'start': this.toggleStart(); break;
      case 'app': if (Object.hasOwn(APPS, id)) this.openApp(id); break;
      case 'close': this.windows.get(id)?.element.remove(); this.windows.delete(id); this.renderTasks(); break;
      case 'minimize': { const entry = this.windows.get(id); if (entry) { entry.minimized = true; entry.element.hidden = true; this.renderTasks(); } break; }
      case 'view': { const active = [...this.windows.values()].find(entry => entry.element.classList.contains('pc-active')); active?.element.classList.toggle('pc-maximized'); break; }
      case 'maximize': this.windows.get(id)?.element.classList.toggle('pc-maximized'); break;
      case 'mail': this.readMail(control.dataset.id!); break;
      case 'portal': this.page = 'portal'; this.openApp('web'); this.renderWeb(); break;
      case 'web-home': this.page = 'home'; this.renderWeb(); break;
      case 'check-account': this.page = 'receipt'; this.quest.checkAccount(); this.renderWeb(); break;
      case 'document': control.closest('.pc-window-body')!.querySelector('pre')!.textContent = DESKTOP_DOCUMENTS[control.dataset.file!] ?? ''; break;
      case 'restart-mines': this.mines = new MinesGame(`dernier-etage-${++this.mineAttempt}`); this.mineEligible = false; this.flagMode = false; this.renderMines(); break;
      case 'mine': {
        const cell = Number(control.dataset.cell);
        const previous = this.mines.status;
        if (!this.flagMode && previous === 'ready') this.mineEligible = this.quest.canFinishGame;
        if (this.flagMode) this.mines.flag(cell); else this.mines.reveal(cell);
        if (this.mineEligible && previous !== this.mines.status && (this.mines.status === 'won' || this.mines.status === 'lost')) {
          this.quest.finishGame(this.mines.status); this.mineEligible = false;
        }
        this.renderMines();
        break;
      }
    }
  };
  private readonly contextMenu = (event: MouseEvent): void => {
    const cell = (event.target as Element).closest<HTMLElement>('[data-cell]');
    if (!this.opened || !cell) return;
    event.preventDefault(); this.playClick(); this.mines.flag(Number(cell.dataset.cell)); this.renderMines();
  };
  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.opened) return;
    const windowElement = (event.target as Element).closest<HTMLElement>('.pc-window');
    if (windowElement && !(event.target as Element).closest('button')) this.playClick();
    if (windowElement) this.activate(windowElement.dataset.app as AppId);
    const bar = (event.target as Element).closest('.pc-titlebar');
    if (!bar || !windowElement || (event.target as Element).closest('button') || event.button !== 0 || windowElement.classList.contains('pc-maximized')) return;
    const rect = windowElement.getBoundingClientRect(), screen = this.screen.getBoundingClientRect();
    windowElement.style.transform = 'none'; windowElement.style.left = `${rect.left - screen.left}px`; windowElement.style.top = `${rect.top - screen.top}px`;
    this.drag = { window: windowElement, id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.preventDefault();
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id || !this.opened) return;
    const screen = this.screen.getBoundingClientRect(), window = this.drag.window;
    window.style.left = `${Math.max(0, Math.min(screen.width - Math.min(window.offsetWidth, screen.width), event.clientX - screen.left - this.drag.dx))}px`;
    window.style.top = `${Math.max(28, Math.min(screen.height - 78, event.clientY - screen.top - this.drag.dy))}px`;
  };
  private readonly pointerUp = (event: PointerEvent): void => { if (event.pointerId === this.drag?.id) this.stopDrag(); };
  private readonly stopDrag = (): void => { this.drag = undefined; };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.opened || this.element.hidden || event.key === 'F11' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!this.startMenu.hidden) this.toggleStart(false); else this.close(); }
    if (event.key === 'Tab') {
      const controls = [...this.element.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter(node => !node.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.element)) { event.preventDefault(); last?.focus(); }
      else if (!this.element.contains(document.activeElement) || (!event.shiftKey && (document.activeElement === last || document.activeElement === this.element))) { event.preventDefault(); first?.focus(); }
    }
    event.stopImmediatePropagation();
  };
  dispose(): void {
    this.disposed = true; this.opened = false; this.stopDrag();
    window.removeEventListener('keydown', this.key, true); window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp); window.removeEventListener('pointercancel', this.pointerUp);
    window.removeEventListener('blur', this.stopDrag);
    this.element.remove(); this.windows.clear();
  }
}
