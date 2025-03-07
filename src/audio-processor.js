class AudioProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0]; // First input channel
        if (input.length > 0) {
            const samples = input[0]; // Extract samples from first channel
            this.port.postMessage(samples); // Send samples to the main thread
        }
        return true; // Keep processor alive
    }
}

registerProcessor("audio-processor", AudioProcessor);
