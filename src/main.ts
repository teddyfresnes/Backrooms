const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application mount point not found.');

let activeLab: { dispose(): void } | null = null;

const showFatalError = (error: unknown): void => {
  app.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
};

const startIntegratedLab = async (): Promise<void> => {
  const { AnimationLab } = await import('./dev/AnimationLab');
  const lab = new AnimationLab(app);
  activeLab = lab;
  await lab.initialize();
};

requestAnimationFrame(() => void startIntegratedLab().catch(showFatalError));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeLab?.dispose();
    activeLab = null;
  });
}
