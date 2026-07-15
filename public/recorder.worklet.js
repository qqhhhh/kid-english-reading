class KidReadingRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.pendingLength = 0;
    this.batchSize = 2048;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "flush") return;
      this.flush();
      this.port.postMessage({ type: "flushed" });
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input?.length) return true;

    this.pending.push(new Float32Array(input));
    this.pendingLength += input.length;
    if (this.pendingLength >= this.batchSize) this.flush();
    return true;
  }

  flush() {
    if (this.pendingLength === 0) return;
    const samples = new Float32Array(this.pendingLength);
    let offset = 0;
    for (const chunk of this.pending) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingLength = 0;
    this.port.postMessage({ type: "audio", samples: samples.buffer }, [samples.buffer]);
  }
}

registerProcessor("kid-reading-recorder", KidReadingRecorderProcessor);
