// Static self-hosted AudioWorklet. No eval/blob/network or persistent audio storage.
// Up to eight 100ms frames (800ms) may await main-thread acknowledgement before overflow.
const MAX_PENDING = 8;
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Float32Array(Math.round(sampleRate / 10)); this.at = 0; this.pending = 0;
    this.port.onmessage = () => { if (this.pending > 0) this.pending--; };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] ?? 0;
      this.frame[this.at++] = value / channels.length;
      if (this.at === this.frame.length) {
        if (this.pending >= MAX_PENDING) { this.port.postMessage({ type: 'overflow' }); return false; }
        this.pending++; this.port.postMessage({ samples: this.frame }, [this.frame.buffer]);
        this.frame = new Float32Array(Math.round(sampleRate / 10)); this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
