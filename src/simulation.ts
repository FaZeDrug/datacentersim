/**
 * Authored incident-training rules, not an engineering or thermodynamics model.
 * All time belongs to the caller: no timers, randomness, networking, or DOM here.
 */
export type Equipment = {
  id: string;
  name: string;
  kind: 'rack' | 'cooling' | 'power' | 'vent';
  x: number;
  z: number;
  width: number;
  depth: number;
};

export const EQUIPMENT: Equipment[] = [
  ...[-8, -3, 3, 8].flatMap((x, column) =>
    [-8, -3, 2].map((z, row): Equipment => ({
      id: `rack-${'abcd'[column]}${row + 1}`,
      name: `Rack ${'ABCD'[column]}${row + 1}`,
      kind: 'rack', x, z, width: 1.6, depth: 2.2,
    })),
  ),
  { id: 'cooling', name: 'Cooling unit C-01', kind: 'cooling', x: -11, z: -13, width: 3, depth: 2 },
  { id: 'power', name: 'Power distribution P-01', kind: 'power', x: 11, z: -13, width: 2.4, depth: 2 },
  { id: 'vent', name: 'B2 floor air intake', kind: 'vent', x: -3, z: 0, width: 1.6, depth: 1 },
];

export type SimEvent = {
  id: number;
  time: number;
  kind: 'info' | 'warning' | 'success' | 'danger';
  text: string;
};

export type SimState = {
  status: 'ready' | 'running' | 'won' | 'lost';
  mode: 'guided' | 'challenge';
  elapsed: number;
  timeLimit: number;
  temperature: number;
  cpu: number;
  powerLoad: number;
  battery: number;
  serviceHealth: number;
  coolingBoosted: boolean;
  ventCleared: boolean;
  breakerTripped: boolean;
  workloadMigrated: boolean;
  inspected: string[];
  mistakes: number;
  score: number;
  events: SimEvent[];
  failureReason: string | null;
  stableFor: number;
};

export type SimAction = { id: string; label: string; description: string; disabled: boolean };

const STABLE_TEMPERATURE = 32;
const STABLE_SECONDS = 5;
const THERMAL_LIMIT = 62;
const BATTERY_DRAIN = 0.75;
const EPSILON = 1e-8;
const MEANINGFUL_EVIDENCE = new Set(['rack-b2', 'cooling', 'power', 'vent']);

function event(state: SimState, kind: SimEvent['kind'], text: string, time = state.elapsed): void {
  state.events.push({ id: state.events.length + 1, time, kind, text });
}

function projectedLoad(state: SimState): number {
  return (state.workloadMigrated ? 55 : 86) + (state.coolingBoosted ? 24 : 0);
}

function updateReadings(state: SimState): void {
  state.cpu = state.workloadMigrated ? 34 : 91;
  state.powerLoad = state.breakerTripped ? 0 : projectedLoad(state);
}

function updateScore(state: SimState): void {
  const evidence = state.inspected.filter((id) => MEANINGFUL_EVIDENCE.has(id)).length;
  const progress = evidence * 25 + Number(state.workloadMigrated) * 100 + Number(state.ventCleared) * 200;
  const completion = state.status === 'won' ? 1000 + state.serviceHealth * 5 - state.elapsed * 2 : 0;
  state.score = Math.max(0, Math.round(progress + completion - state.mistakes * 150));
}

export function createSimulation(mode: SimState['mode'] = 'guided'): SimState {
  return {
    status: 'ready', mode, elapsed: 0, timeLimit: mode === 'challenge' ? 240 : 360,
    temperature: 39, cpu: 91, powerLoad: 86, battery: 100, serviceHealth: 100,
    coolingBoosted: false, ventCleared: false, breakerTripped: false,
    workloadMigrated: false, inspected: [], mistakes: 0, score: 0,
    events: [], failureReason: null, stableFor: 0,
  };
}

export function startSimulation(state: SimState): void {
  if (state.status !== 'ready') return;
  state.status = 'running';
  event(state, 'warning', 'Thermal alert: Rack B2 is at 39°C and rising. Investigate the local cooling path.');
  event(state, 'info', 'Training rules active. Keep service online, clear the root cause, and stabilize below 32°C.');
}

/** A piecewise-constant rate lets the simulation integrate identically at any frame rate. */
function temperatureRate(state: SimState): number {
  if (state.breakerTripped) return state.workloadMigrated ? 0.18 : 0.28;
  if (state.ventCleared) return -(state.workloadMigrated ? 0.48 : 0.32) - (state.coolingBoosted ? 0.18 : 0);
  return (state.workloadMigrated ? 0.07 : 0.15) - (state.coolingBoosted ? 0.04 : 0);
}

/** Integral of max(temperature - threshold, 0) for a linear temperature segment. */
function heatExposure(temperature: number, rate: number, threshold: number, seconds: number): number {
  const initial = temperature - threshold;
  if (Math.abs(rate) < EPSILON) return Math.max(0, initial) * seconds;
  if (rate > 0) {
    const start = Math.max(0, -initial / rate);
    if (start >= seconds) return 0;
    const duration = seconds - start;
    return Math.max(0, initial + rate * start) * duration + 0.5 * rate * duration * duration;
  }
  if (initial <= 0) return 0;
  const duration = Math.min(seconds, -initial / rate);
  return initial * duration + 0.5 * rate * duration * duration;
}

function serviceDamage(state: SimState, rate: number, seconds: number): number {
  return heatExposure(state.temperature, rate, 44, seconds) * 0.12
    + (state.breakerTripped ? seconds * 0.12 : 0);
}

export function tickSimulation(state: SimState, dt: number): void {
  if (state.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  const rate = temperatureRate(state);
  const before = state.elapsed;
  const temperatureBefore = state.temperature;
  const batteryBefore = state.battery;
  let seconds = Math.min(dt, Math.max(0, state.timeLimit - before));
  let outcome: 'won' | 'lost' | null = dt >= state.timeLimit - before ? 'lost' : null;
  let reason: string | null = outcome ? 'Incident window expired before the facility stabilized.' : null;

  function failAt(at: number, why: string): void {
    if (at >= 0 && at <= seconds + EPSILON) {
      seconds = Math.min(seconds, at);
      outcome = 'lost';
      reason = why;
    }
  }

  if (rate > 0) failAt((THERMAL_LIMIT - state.temperature) / rate, 'Rack B2 reached its thermal shutdown threshold.');
  if (state.breakerTripped) failAt(state.battery / BATTERY_DRAIN, 'Backup power ran out before the cooling circuit was restored.');
  if (serviceDamage(state, rate, seconds) >= state.serviceHealth) {
    let low = 0;
    let high = seconds;
    for (let i = 0; i < 48; i++) {
      const middle = (low + high) / 2;
      if (serviceDamage(state, rate, middle) >= state.serviceHealth) high = middle;
      else low = middle;
    }
    failAt(high, 'Sustained heat and power loss exhausted service health.');
  }

  const eligible = state.ventCleared && !state.breakerTripped;
  const reachesSafeTemperature = state.temperature <= STABLE_TEMPERATURE + EPSILON
    ? 0 : rate < 0 ? (state.temperature - STABLE_TEMPERATURE) / -rate : Infinity;
  const winsAt = eligible ? reachesSafeTemperature + Math.max(0, STABLE_SECONDS - state.stableFor) : Infinity;
  if (winsAt <= seconds + EPSILON && (outcome !== 'lost' || winsAt < seconds - EPSILON)) {
    seconds = Math.min(seconds, winsAt);
    outcome = 'won';
    reason = null;
  }

  state.temperature = Math.max(24, temperatureBefore + rate * seconds);
  state.serviceHealth = Math.max(0, state.serviceHealth - serviceDamage({ ...state, temperature: temperatureBefore }, rate, seconds));
  state.battery = Math.min(100, Math.max(0, batteryBefore + (state.breakerTripped ? -BATTERY_DRAIN : 0.25) * seconds));
  state.elapsed = before + seconds;
  state.stableFor = eligible ? Math.min(STABLE_SECONDS, state.stableFor + Math.max(0, seconds - reachesSafeTemperature)) : 0;

  const pending: { time: number; kind: SimEvent['kind']; text: string }[] = [];
  for (const threshold of [45, 55]) {
    const text = threshold === 45
      ? 'Rack B2 crossed 45°C. Service health is degrading; reduce the heat source.'
      : 'Rack B2 crossed 55°C. Thermal shutdown is approaching.';
    if (rate > 0 && temperatureBefore < threshold && state.temperature >= threshold && !state.events.some((e) => e.text === text)) {
      pending.push({ time: before + (threshold - temperatureBefore) / rate, kind: threshold === 45 ? 'warning' : 'danger', text });
    }
  }
  if (state.breakerTripped && batteryBefore > 30 && state.battery <= 30) {
    const text = 'Backup battery below 30%. Restore the cooling circuit while reducing load.';
    if (!state.events.some((e) => e.text === text)) pending.push({ time: before + (batteryBefore - 30) / BATTERY_DRAIN, kind: 'danger', text });
  }
  pending.sort((a, b) => a.time - b.time).forEach((e) => event(state, e.kind, e.text, e.time));

  if (outcome) {
    state.status = outcome;
    state.failureReason = reason;
    event(state, outcome === 'won' ? 'success' : 'danger', outcome === 'won'
      ? 'Incident contained. Airflow restored and Rack B2 stable below 32°C for five seconds.'
      : reason!);
  }
  updateScore(state);
}

export function inspectEquipment(state: SimState, id: string): string[] {
  const equipment = EQUIPMENT.find((item) => item.id === id);
  if (!equipment) return ['Equipment not found.'];
  const firstInspection = !state.inspected.includes(id);
  if (state.status === 'running' && firstInspection) {
    state.inspected.push(id);
    event(state, 'info', `Inspected ${equipment.name}. Sensor evidence added to the incident log.`);
    updateScore(state);
  }
  if (id === 'rack-b2') return [
    `Inlet temperature: ${state.temperature.toFixed(1)}°C. CPU load: ${state.cpu}%.`,
    state.workloadMigrated ? 'Workload has moved to healthy racks. Local heat generation is reduced.' : 'Local workload is high. Migration can reduce both heat and electrical demand.',
    state.ventCleared ? 'Cool air is reaching this rack again.' : 'The neighboring racks are much cooler. Check the floor air intake serving B2.',
  ];
  if (id === 'vent') return [
    state.ventCleared ? 'The floor air intake is clear. Supply airflow is restored.' : 'A loose packing sheet is blocking the perforated intake beneath B2.',
    state.ventCleared ? 'Keep this supply route unobstructed.' : 'This obstruction is the root cause. Clear it to restore the cold-air path.',
  ];
  if (id === 'cooling') return [
    state.breakerTripped ? 'Cooling power is disconnected. The backup supply is keeping services alive.' : 'The cooling unit is operating; the obstruction is downstream in the floor supply path.',
    `Cooling boost adds 24 percentage points of circuit load. Present demand: ${projectedLoad(state)}% of capacity.`,
    state.coolingBoosted ? 'Boost is selected. It takes effect only while the cooling circuit has power.' : 'Check power headroom before selecting boost. A stronger fan cannot remove a physical obstruction.',
  ];
  if (id === 'power') return [
    state.breakerTripped ? `Circuit breaker tripped. Backup battery: ${state.battery.toFixed(0)}%.` : `Circuit operating at ${state.powerLoad}% of capacity.`,
    `Demand after a reset would be ${projectedLoad(state)}%. The circuit capacity is 100%.`,
    state.workloadMigrated ? 'Workload migration has created enough headroom for boosted cooling.' : 'Migrating B2 workload reduces demand by 31 percentage points.',
  ];
  return [`${equipment.name}: inlet temperature 25.0°C, CPU load 42%.`, 'No local fault detected. The active thermal incident is at Rack B2.'];
}

export function getActions(state: SimState, id: string): SimAction[] {
  const inactive = state.status !== 'running';
  if (id === 'rack-b2') return [{ id: 'migrate', label: state.workloadMigrated ? 'Workload migrated' : 'Migrate workload', description: 'Move B2 jobs to healthy racks, reducing local heat and electrical demand.', disabled: inactive || state.workloadMigrated }];
  if (id === 'vent') return [{ id: 'clear', label: state.ventCleared ? 'Airflow restored' : 'Clear air intake', description: 'Remove the packing sheet obstructing B2’s cold-air supply.', disabled: inactive || state.ventCleared }];
  if (id === 'cooling') return [{ id: 'boost', label: state.coolingBoosted ? 'Boost selected' : 'Boost cooling', description: 'Increase fan output. Adds 24% circuit load; overload will trip the breaker.', disabled: inactive || state.coolingBoosted || state.breakerTripped }];
  if (id === 'power') return [{ id: 'reset', label: state.breakerTripped ? 'Reset breaker' : 'Circuit online', description: state.breakerTripped && projectedLoad(state) > 100 ? 'Reduce demand before resetting: migrate the B2 workload.' : 'Restore power to the cooling circuit once demand is below 100%.', disabled: inactive || !state.breakerTripped || projectedLoad(state) > 100 }];
  return [];
}

export function applyAction(state: SimState, id: string, actionId: string): { ok: boolean; message: string } {
  if (state.status !== 'running') return { ok: false, message: 'Start an active shift to operate equipment.' };
  const action = getActions(state, id).find((candidate) => candidate.id === actionId);
  if (!action || action.disabled) return { ok: false, message: action?.description ?? 'That action is not available on this equipment.' };
  let message: string;
  let kind: SimEvent['kind'] = 'success';
  if (actionId === 'migrate') {
    state.workloadMigrated = true;
    message = 'B2 workload migrated. CPU drops to 34%; circuit demand drops by 31 percentage points.';
  } else if (actionId === 'clear') {
    state.ventCleared = true;
    message = 'Obstruction removed. B2’s cold-air path is clear. Restore power if needed, then watch the temperature fall.';
  } else if (actionId === 'boost') {
    state.coolingBoosted = true;
    if (projectedLoad(state) > 100) {
      state.breakerTripped = true;
      state.stableFor = 0;
      state.mistakes += 1;
      kind = 'danger';
      message = 'Cascade: cooling boost pushed demand to 110%. Breaker tripped; backup battery is draining. Reduce workload before resetting.';
    } else message = 'Cooling boost enabled within circuit capacity. The physical air intake still needs to stay clear.';
  } else {
    state.breakerTripped = false;
    message = 'Breaker reset. Cooling power restored with safe electrical headroom.';
  }
  updateReadings(state);
  event(state, kind, message);
  updateScore(state);
  return { ok: true, message };
}

export function getObjective(state: SimState): { title: string; detail: string; targetId: string | null } {
  if (state.status === 'ready') return { title: 'Your night shift starts here', detail: 'Enter the facility, inspect alerts, and keep service online.', targetId: 'rack-b2' };
  if (state.status === 'won') return { title: 'Incident contained', detail: 'Review the timeline and your operator score.', targetId: null };
  if (state.status === 'lost') return { title: 'Service interrupted', detail: state.failureReason ?? 'Review the incident and try a different response.', targetId: null };
  if (state.mode === 'challenge') return { title: state.breakerTripped ? 'Contain heat and power failures' : 'Contain the B2 thermal incident', detail: 'Use the equipment evidence. Restore airflow and power, then hold below 32°C for five seconds.', targetId: 'rack-b2' };
  if (state.breakerTripped && !state.workloadMigrated) return { title: 'Reduce electrical demand', detail: 'Return to Rack B2 and migrate its workload before resetting the breaker.', targetId: 'rack-b2' };
  if (state.breakerTripped) return { title: 'Restore the cooling circuit', detail: 'Electrical demand is safe. Reset the breaker at power distribution P-01.', targetId: 'power' };
  if (state.ventCleared) return { title: 'Let the facility stabilize', detail: `Airflow is clear. Hold below 32°C for five seconds (${Math.floor(state.stableFor)}/5).`, targetId: null };
  if (!state.inspected.includes('rack-b2')) return { title: 'Investigate Rack B2', detail: 'Follow the amber marker. Inspect the rack to compare workload and temperature.', targetId: 'rack-b2' };
  if (!state.inspected.includes('cooling')) return { title: 'Trace the cooling path', detail: 'Inspect cooling unit C-01. Read its power requirements before changing its output.', targetId: 'cooling' };
  return { title: 'Restore B2’s airflow', detail: 'Inspect the floor intake beside B2 and remove the obstruction. Migration also reduces stress.', targetId: 'vent' };
}

export function getPostmortem(state: SimState): { title: string; summary: string; lessons: string[] } {
  const cascaded = state.events.some((entry) => entry.text.startsWith('Cascade:'));
  const summary = state.status === 'won'
    ? `You contained the incident in ${Math.ceil(state.elapsed)} seconds with ${Math.round(state.serviceHealth)}% service health remaining. ${cascaded ? 'The initial cooling intervention caused a power cascade, which you recovered from.' : 'You restored the air supply without causing a secondary power failure.'}`
    : state.status === 'lost'
      ? state.failureReason ?? 'The facility could not stabilize within the incident window.'
      : 'The incident is still in progress. Final assessment appears when the shift ends.';
  return {
    title: state.status === 'won' ? 'Root cause resolved' : state.status === 'lost' ? 'Incident review' : 'Live investigation',
    summary,
    lessons: [
      'Root cause: a packing sheet obstructed the floor intake serving Rack B2. More fan power alone could not clear it.',
      cascaded ? 'Secondary failure: boosted cooling exceeded circuit capacity. Migrate workload to create headroom before resetting power.' : 'Check electrical headroom before increasing cooling output; thermal and power systems are connected.',
      state.workloadMigrated ? 'Workload migration reduced both local heat generation and circuit demand.' : 'Workload migration is an available containment action while you investigate the physical fault.',
      'These are handcrafted training rules, not a validated engineering model or a real facility operating procedure.',
    ],
  };
}
