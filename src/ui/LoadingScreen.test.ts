// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { LoadingScreen, loadingMaze } from './LoadingScreen';
it('reports real completed work monotonically and reaches 100 only on readiness', () => {
  const view=new LoadingScreen('Textures');
  view.setProgress(.327,'Décompression');
  expect(view.element.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('32');
  expect(view.element.textContent).toContain('32 %'); expect(view.element.textContent).toContain('Décompression');
  view.setProgress(.1); view.setProgress(NaN);
  expect(view.element.textContent).toContain('32 %');
  view.setProgress(1); expect(view.element.textContent).toContain('100 %');
  expect(view.element.querySelectorAll('canvas')).toHaveLength(0);
  // Compositor-only motion: no SMIL, one shared CSS keyframe rule.
  expect(view.element.querySelector('animateMotion')).toBeNull();
  new LoadingScreen('Again');
  expect(document.querySelectorAll('#loading-runner-keyframes')).toHaveLength(1);
  expect(document.getElementById('loading-runner-keyframes')!.textContent).toMatch(/^@keyframes loading-run\{0\.000%\{transform:translate\(10\.8px,10\.8px\)\}/);
  expect((view.element.querySelector('.loading-screen-hint') as HTMLElement).hidden).toBe(true);
});
it('walks a closed route through all 72 adjacent maze cells without crossing walls', () => {
  const maze=loadingMaze(), points=maze.route.slice(1).split('L').map(p=>p.split(',').map(Number));
  const walls=[...maze.walls.matchAll(/M(\d+) (\d+)([vh])(\d+)/g)];
  expect(points[0]).toEqual(points.at(-1)); expect(new Set(points.map(p=>p.join(','))).size).toBe(72);
  for(let i=1;i<points.length;i++){
    const [ax,ay]=points[i-1]!,[bx,by]=points[i]!;
    expect(Math.abs(ax!-bx!)+Math.abs(ay!-by!)).toBe(12);
    for(const [,x,y,dir,length] of walls){
      const wx=Number(x),wy=Number(y),n=Number(length);
      const crossing=dir==='v' ? ay===by&&Math.min(ax!,bx!)<wx&&Math.max(ax!,bx!)>wx&&ay!>wy&&ay!<wy+n
        : ax===bx&&Math.min(ay!,by!)<wy&&Math.max(ay!,by!)>wy&&ax!>wx&&ax!<wx+n;
      expect(crossing).toBe(false);
    }
  }
});
