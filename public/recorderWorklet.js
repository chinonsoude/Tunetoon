class RecorderWorklet extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      // Make a copy so it's not reused/detached
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage(copy);
    }
    return true;
  }
}
registerProcessor('recorder-worklet', RecorderWorklet);