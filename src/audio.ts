/** Small gesture-unlocked synthesizer. No network or external audio required. */
export class FacilityAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private ambient: HTMLAudioElement | null = null;
  private alarm: HTMLAudioElement | null = null;
  private running = false;
  private enabled = true;

  setSources(sources: { ambient?: string; alarm?: string }) {
    this.ambient?.pause();
    this.alarm?.pause();
    if (sources.ambient) {
      this.ambient = new Audio(sources.ambient);
      this.ambient.loop = true;
      this.ambient.volume = 0.16;
    }
    if (sources.alarm) {
      this.alarm = new Audio(sources.alarm);
      this.alarm.volume = 0.22;
    }
    this.syncAmbient();
  }

  private syncAmbient() {
    if (this.running && this.enabled) void this.ambient?.play().catch(() => {});
    else this.ambient?.pause();
  }

  unlock() {
    if (!this.context) {
      const Audio = window.AudioContext;
      if (!Audio) return;
      this.context = new Audio();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.16 : 0;
      this.master.connect(this.context.destination);
      this.hum = this.context.createOscillator();
      const gain = this.context.createGain();
      this.humGain = gain;
      gain.gain.value = this.running ? 0.1 : 0;
      this.hum.type = 'sine';
      this.hum.frequency.value = 72;
      this.hum.connect(gain).connect(this.master);
      this.hum.start();
    }
    void this.context.resume().catch(() => {});
    this.syncAmbient();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context) this.master.gain.setTargetAtTime(enabled ? 0.16 : 0, this.context.currentTime, 0.05);
    if (!enabled) this.alarm?.pause();
    this.syncAmbient();
  }

  setRunning(running: boolean, emergency = false) {
    this.running = running;
    this.syncAmbient();
    if (!running) this.alarm?.pause();
    if (!this.hum || !this.context) return;
    this.humGain?.gain.setTargetAtTime(running ? 0.1 : 0, this.context.currentTime, 0.2);
    this.hum.frequency.setTargetAtTime(running ? (emergency ? 52 : 72) : 48, this.context.currentTime, 0.6);
  }

  cue(kind: 'click' | 'inspect' | 'success' | 'warning' | 'danger') {
    if (!this.context || !this.master || !this.enabled) return;
    if (this.alarm && (kind === 'warning' || kind === 'danger')) {
      this.alarm.currentTime = 0;
      void this.alarm.play().catch(() => {});
    }
    const notes = { click: [440], inspect: [520, 780], success: [523, 659, 784], warning: [330, 277], danger: [196, 196] }[kind];
    const time = this.context.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const envelope = this.context!.createGain();
      const at = time + index * 0.12;
      oscillator.type = kind === 'danger' ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(0.45, at + 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.23);
      oscillator.connect(envelope).connect(this.master!);
      oscillator.start(at);
      oscillator.stop(at + 0.24);
    });
  }

  dispose() {
    this.ambient?.pause();
    this.alarm?.pause();
    this.hum?.stop();
    void this.context?.close();
  }
}
