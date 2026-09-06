import { describe, expect, it } from 'vitest';
import { EQUIPMENT, applyAction, createSimulation, getActions, getObjective, getPostmortem, inspectEquipment, startSimulation, tickSimulation, type SimState } from '../src/simulation';

function running(mode: SimState['mode'] = 'guided'): SimState {
  const state = createSimulation(mode);
  startSimulation(state);
  return state;
}

function act(state: SimState, id: string, action: string): void {
  expect(applyAction(state, id, action).ok).toBe(true);
}

describe('authored facility and incident lifecycle', () => {
  it('exports a unique 12-rack layout and the three incident systems', () => {
    expect(EQUIPMENT).toHaveLength(15);
    expect(new Set(EQUIPMENT.map((item) => item.id)).size).toBe(15);
    expect(EQUIPMENT.filter((item) => item.kind === 'rack')).toHaveLength(12);
    expect(EQUIPMENT.find((item) => item.id === 'rack-b2')).toMatchObject({ x: -3, z: -3, width: 1.6, depth: 2.2 });
  });

  it('supports evidence, safe mitigation, root-cause repair and an automatic win', () => {
    const state = running();
    expect(getObjective(state).targetId).toBe('rack-b2');
    inspectEquipment(state, 'rack-b2');
    expect(getObjective(state).targetId).toBe('cooling');
    tickSimulation(state, 20);
    inspectEquipment(state, 'cooling');
    act(state, 'rack-b2', 'migrate');
    expect(state.cpu).toBe(34);
    expect(state.powerLoad).toBe(55);
    inspectEquipment(state, 'vent');
    act(state, 'vent', 'clear');
    tickSimulation(state, 60);
    expect(state.status).toBe('won');
    expect(state.elapsed).toBeLessThan(60);
    expect(state.temperature).toBeLessThan(32);
    expect(state.stableFor).toBe(5);
    expect(state.mistakes).toBe(0);
    expect(state.score).toBeGreaterThan(1000);
    expect(getPostmortem(state).summary).toContain('without causing');
  });

  it('allows a direct root-cause fix without artificial inspection gates', () => {
    const state = running();
    act(state, 'vent', 'clear');
    tickSimulation(state, 100);
    expect(state.status).toBe('won');
    expect(state.inspected).toEqual([]);
    expect(state.workloadMigrated).toBe(false);
  });

  it('makes high-load cooling boost trigger a recoverable power cascade', () => {
    const state = running();
    act(state, 'cooling', 'boost');
    expect(state.breakerTripped).toBe(true);
    expect(state.powerLoad).toBe(0);
    expect(state.mistakes).toBe(1);
    tickSimulation(state, 20);
    expect(state.battery).toBe(85);
    expect(getActions(state, 'power')[0].disabled).toBe(true);
    expect(applyAction(state, 'power', 'reset').ok).toBe(false);
    act(state, 'rack-b2', 'migrate');
    expect(getObjective(state).targetId).toBe('power');
    act(state, 'power', 'reset');
    expect(state.powerLoad).toBe(79);
    expect(state.breakerTripped).toBe(false);
    act(state, 'vent', 'clear');
    tickSimulation(state, 80);
    expect(state.status).toBe('won');
    expect(getPostmortem(state).summary).toContain('recovered');
  });

  it('does not trip cooling with sufficient headroom', () => {
    const state = running();
    act(state, 'rack-b2', 'migrate');
    act(state, 'cooling', 'boost');
    expect(state.powerLoad).toBe(79);
    expect(state.breakerTripped).toBe(false);
    tickSimulation(state, 30);
    expect(state.status).toBe('running');
    expect(state.temperature).toBeGreaterThan(39);
    expect(state.ventCleared).toBe(false);
  });

  it('loses when the operator ignores the incident', () => {
    const state = running();
    tickSimulation(state, 1000);
    expect(state.status).toBe('lost');
    expect(state.elapsed).toBeLessThan(240);
    expect(state.serviceHealth).toBeCloseTo(0);
    expect(state.failureReason).toContain('service health');
    expect(state.events.some((entry) => entry.text.includes('45°C'))).toBe(true);
  });

  it('cannot win by migrating workload and waiting out the clock', () => {
    const state = running('challenge');
    act(state, 'rack-b2', 'migrate');
    tickSimulation(state, 1000);
    expect(state.status).toBe('lost');
    expect(state.ventCleared).toBe(false);
  });

  it('expires if cooling remains too slow to stabilize before the deadline', () => {
    const state = running('challenge');
    state.timeLimit = 10;
    act(state, 'vent', 'clear');
    tickSimulation(state, 100);
    expect(state.status).toBe('lost');
    expect(state.elapsed).toBe(10);
    expect(state.failureReason).toContain('window expired');
  });

  it('supports a fresh retry without sharing arrays or hidden clock state', () => {
    const first = running('challenge');
    act(first, 'cooling', 'boost');
    inspectEquipment(first, 'power');
    tickSimulation(first, 800);
    const second = createSimulation();
    expect(second).toMatchObject({ status: 'ready', timeLimit: 360, score: 0, mistakes: 0, elapsed: 0, temperature: 39 });
    expect(second.events).toEqual([]);
    expect(second.inspected).toEqual([]);
    expect(first.events.length).toBeGreaterThan(0);
  });
});

describe('simulation integrity', () => {
  it('makes repeated inspections, repaired actions, and invalid commands inert', () => {
    const state = running();
    inspectEquipment(state, 'vent');
    act(state, 'vent', 'clear');
    const expected = structuredClone(state);
    inspectEquipment(state, 'vent');
    inspectEquipment(state, 'unknown-device');
    expect(applyAction(state, 'vent', 'clear').ok).toBe(false);
    expect(applyAction(state, 'rack-a1', 'migrate').ok).toBe(false);
    expect(applyAction(state, 'power', 'clear').ok).toBe(false);
    expect(applyAction(state, 'rack-b2', '__proto__').ok).toBe(false);
    startSimulation(state);
    expect(state).toEqual(expected);
  });

  it('does not award score for inspecting unrelated racks', () => {
    const state = running();
    inspectEquipment(state, 'rack-a1');
    expect(state.score).toBe(0);
  });

  it('ignores invalid deltas and does not advance before starting', () => {
    const state = createSimulation();
    const ready = structuredClone(state);
    tickSimulation(state, 2);
    expect(state).toEqual(ready);
    startSimulation(state);
    const active = structuredClone(state);
    for (const dt of [NaN, Infinity, -Infinity, -1, 0]) tickSimulation(state, dt);
    expect(state).toEqual(active);
  });

  it.each(['win', 'lose'])('freezes all gameplay mutations after a %s', (outcome) => {
    const state = running();
    if (outcome === 'win') act(state, 'vent', 'clear');
    tickSimulation(state, 1000);
    const finished = structuredClone(state);
    tickSimulation(state, 1000);
    inspectEquipment(state, 'power');
    applyAction(state, 'cooling', 'boost');
    startSimulation(state);
    expect(state).toEqual(finished);
  });

  it('integrates heat, battery, damage, and end time consistently across tick sizes', () => {
    const one = running();
    const many = running();
    act(one, 'cooling', 'boost');
    act(many, 'cooling', 'boost');
    tickSimulation(one, 120);
    for (let i = 0; i < 1200; i++) tickSimulation(many, 0.1);
    expect(one.status).toBe(many.status);
    for (const key of ['elapsed', 'temperature', 'battery', 'serviceHealth', 'stableFor'] as const) {
      expect(one[key]).toBeCloseTo(many[key], 7);
    }
    expect(one.score).toBe(many.score);
    expect(one.events.map((entry) => entry.text)).toEqual(many.events.map((entry) => entry.text));
    one.events.forEach((entry, index) => expect(entry.time).toBeCloseTo(many.events[index].time, 7));
  });

  it('integrates the stability timer consistently across tick sizes', () => {
    const one = running();
    const many = running();
    act(one, 'vent', 'clear');
    act(many, 'vent', 'clear');
    tickSimulation(one, 100);
    for (let i = 0; i < 1000; i++) tickSimulation(many, 0.1);
    expect(one.status).toBe('won');
    expect(many.status).toBe('won');
    expect(one.elapsed).toBeCloseTo(many.elapsed, 7);
    expect(one.temperature).toBeCloseTo(many.temperature, 7);
    expect(one.stableFor).toBeCloseTo(many.stableFor, 7);
    expect(one.score).toBe(many.score);
  });
});
