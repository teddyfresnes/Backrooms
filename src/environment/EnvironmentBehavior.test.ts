import { describe, expect, it } from 'vitest';
import { EnvironmentStateStore, TelephoneSequence, SurveillanceBehavior, apparitionFrame, type PhoneCue } from './EnvironmentBehavior';

const advancePhone = (phone: TelephoneSequence, seconds: number, direction = { x: 0, z: -1 }): PhoneCue[] => {
  const cues: PhoneCue[] = [];
  for (let t = 0; t < seconds - .001; t += .05) cues.push(...phone.update(.05, direction, 2.62));
  return cues;
};
describe('environmental encounter states', () => {
  it('reveals the walking ghost between two full blackouts and never on a later light', () => {
    expect(apparitionFrame(.2)).toMatchObject({ visible: false, level: 0 });
    expect(apparitionFrame(.4)).toMatchObject({ visible: true });
    expect(apparitionFrame(.8).progress).toBeGreaterThan(apparitionFrame(.4).progress);
    expect(apparitionFrame(1)).toMatchObject({ visible: false, level: 0 });
    expect(apparitionFrame(1.4).visible).toBe(false);
    expect(apparitionFrame(3)).toMatchObject({ visible: false, level: 1 });
  });
  it('ignores natural mouse movements and times ten seconds from the end of the spoken warning', () => {
    const phone = new TelephoneSequence();
    expect(phone.answer()).toEqual(['breath']);
    const pre = advancePhone(phone, 6.65);
    expect(pre).toContain('warning'); expect(pre).toContain('decision');
    const calm = advancePhone(phone, 9.5, { x: .3, z: -.95 });
    expect(calm).not.toContain('turned'); expect(calm).not.toContain('step');
    const end = advancePhone(phone, 1.4);
    expect(end).toContain('step'); expect(end).toContain('hangup'); expect(end).not.toContain('turned');
    expect(phone.answer()).toEqual([]); expect(advancePhone(phone, 30)).toEqual([]);
  });
  it('requires a sustained large horizontal turn after the warning, and interrupts a fled call', () => {
    const phone = new TelephoneSequence(); phone.answer(); advancePhone(phone, 6.65);
    expect(advancePhone(phone, .05, { x: 0, z: 1 })).not.toContain('turned');
    expect(advancePhone(phone, .15, { x: 0, z: 1 })).toContain('turned');
    const fled = new TelephoneSequence(); fled.answer(); advancePhone(fled, 1);
    expect(fled.interrupt()).toEqual(['interrupt']); expect(advancePhone(fled, 30)).toEqual([]);
  });
  it('bounds servo rotation and freezes until the player is far and looking away', () => {
    const camera = new SurveillanceBehavior(), input = { distance: 10, yaw: 1, pitch: -.3, visible: true, detected: true };
    expect(camera.update(.1, input).moving).toBe(true); expect(camera.yaw).toBeLessThanOrEqual(.0321);
    const yaw = camera.yaw;
    expect(camera.update(.1, { ...input, distance: 2 }).click).toBe(true);
    expect(camera.update(.1, { ...input, distance: 2 }).click).toBe(false);
    for (let i = 0; i < 60; i++) camera.update(.1, input);
    expect(camera.yaw).toBe(yaw);
    expect(camera.update(.1, { ...input, visible: false }).moving).toBe(true);
  });
  it('persists sparse state beyond cache eviction and keeps independent sessions isolated', () => {
    const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    const first = new EnvironmentStateStore('session-a', storage);
    for (let i = 0; i < 2048; i++) first.write(`event-${i}`, { consumed: true, chairMoved: i === 0 });
    expect(first.cachedCount).toBeLessThanOrEqual(128);
    expect(first.read('event-0')).toMatchObject({ consumed: true, chairMoved: true });
    expect(new EnvironmentStateStore('session-a', storage).read('event-0').chairMoved).toBe(true);
    expect(new EnvironmentStateStore('session-b', storage).read('event-0').consumed).not.toBe(true);
  });
});
