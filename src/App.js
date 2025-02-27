// src/App.js
import React, { useRef, useState, useEffect } from "react";
import "./App.css"; // must include your Tailwind directives
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import FFT from 'fft.js'; // ✅ Correct

// For example, choose a chunk (fft) size
const FFT_SIZE = 2048;

function App() {
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  const identifierRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState("00:00");
  const [currentIdentifier, setCurrentIdentifier] = useState(null);

  const [audioData, setAudioData] = useState([]);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [blendMode, setBlendMode] = useState("none");
  const [shapeMultiplier, setShapeMultiplier] = useState(1.0);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerIntervalRef = useRef(null);

  const audioStorageRef = useRef(new Map());

  const streamRef = useRef(null); // store the actual audio stream

  const captureIntervalRef = useRef(null);
  const [colorSpectrum, setColorSpectrum] = useState("normal");

  useEffect(() => {
    // Initialize the canvas (fill black)
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = 512;
    canvas.height = 512;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (audioData.length > 0) {
      generateColorMap();
    }
  }, [audioData]);

  function generateUniqueIdentifier() {
    return Math.random().toString(36).substr(2, 9);
  }

  function updateTimer() {
    const elapsed = Date.now() - startTimeRef.current;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    setTimer(
      `${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`
    );
  }

  useEffect(() => {
    if (isRecording && analyserRef.current) {
      // captureFrame();
      startHighRateCapture();
    }
  }, [isRecording]);

  function startHighRateCapture() {
    if (!analyserRef.current) return;

    // We'll store the interval ID so we can clear it later
    captureIntervalRef.current = setInterval(() => {
      if (!isRecording) return; // sanity check
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      setAudioData((prev) => [...prev, [...dataArray]]);
    }, 1); // 1ms interval
  }

  // Not used
  function captureFrame() {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

    const loop = () => {
      // keep checking isRecording from state or a ref
      if (!isRecording) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      setAudioData((prev) => [...prev, [...dataArray]]);
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  async function startRecording() {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; // keep a reference so we can stop it later

      setRecordedChunks([]);
      setAudioData([]);

      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      analyserRef.current.fftSize = 2048;
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Set up MediaRecorder to record chunks
      mediaRecorderRef.current = null;
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setRecordedChunks((prev) => [...prev, e.data]);
        }
      };
      mediaRecorderRef.current.start(100);

      const newIdentifier = generateUniqueIdentifier();
      setCurrentIdentifier(newIdentifier);

      setIsRecording(true);
      startTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(updateTimer, 100);

      // Enforce a 3-second minimum before stop is allowed
      // (Implementation detail in the stop button if you want)
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Unable to access microphone. Please check permissions.");
    }
  }

  function applyNoiseFloor(audioData, threshold = 15) {
    // threshold in [0..255]
    // Return a new array with frames that are "loud enough"
    return audioData.map(frame => {
      const maxVal = Math.max(...frame);
      // If max amplitude in this frame is below threshold, zero it out
      // or skip it.
      if (maxVal < threshold) {
        // Option A: Make the entire frame zero (so it draws black)
        return frame.map(() => 0);

        // Option B: Return null or an empty array (to skip it entirely)
        // return null;
      }
      return frame;
    }).filter(Boolean); // remove null frames if you're skipping them
  }

  function generateColorMap() {
    if (!canvasRef.current) return;

    // 1) Prepare an offscreen canvas
    const mainCanvas = canvasRef.current;
    const mainCtx = mainCanvas.getContext("2d");
    const offscreen = document.createElement("canvas");
    const offCtx = offscreen.getContext("2d");
    offscreen.width = 512;
    offscreen.height = 512;

    // Fill black
    offCtx.fillStyle = "black";
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Standard logic
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));
    const pixelSize = offscreen.width / pixelsPerSide;

    // 1) Collect the dominant bin info (index + amplitude) for each frame
    const dominantIndices = new Array(totalFrames);
    const dominantAmps = new Array(totalFrames);

    audioData.forEach((frame, i) => {
      const domAmp = Math.max(...frame);
      const domIndex = frame.indexOf(domAmp);
      dominantIndices[i] = domIndex;
      dominantAmps[i] = domAmp;
    });

    // 2) Min/max
    const minBin = Math.min(...dominantIndices);
    const maxBin = Math.max(...dominantIndices);
    const binRange = Math.max(1, maxBin - minBin);

    // 3) Draw squares on the offscreen canvas
    audioData.forEach((frame, index) => {
      const domAmp = Math.max(...frame);
      const domIndex = frame.indexOf(domAmp);
    
      let fraction = (domIndex - minBin) / binRange;   // 0..1
      let alpha = domAmp / 255;
    
      if (colorSpectrum === "inverted") {
        fraction = 1 - fraction;      // flip frequency
        alpha = 1 - alpha;           // flip amplitude
      }
    
      // Convert fraction to wavelength
      const wavelength = 380 + fraction * (700 - 380);
      const [r, g, b] = wavelengthToRGB(wavelength);
    
      offCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;    

      // Position of this cell in the grid:
      const xBase = (index % pixelsPerSide) * pixelSize;
      const yBase = Math.floor(index / pixelsPerSide) * pixelSize;

      // Don’t mutate shapeMultiplier directly
      let localShapeMultiplier = shapeMultiplier;

      // If in additive mode, override it
      if (blendMode === "additive") {
        localShapeMultiplier = 1.5;
      }

      // Then use localShapeMultiplier for the shape size
      const shapeSize = pixelSize * localShapeMultiplier;

      // We'll center the shape so it overlaps around its cell:
      const centerOffset = (shapeSize - pixelSize) / 2;

      // For squares:
      if (blendMode === "circles") {
        offCtx.beginPath();
        offCtx.arc(
          xBase + pixelSize / 2,
          yBase + pixelSize / 2,
          (shapeSize / 2),
          0,
          2 * Math.PI
        );
        offCtx.fill();
      } else {
        // squares (with additive overlap if shapeMultiplier > 1)
        offCtx.fillRect(
          xBase - centerOffset,
          yBase - centerOffset,
          shapeSize,
          shapeSize
        );
      }
    });

    // 2) Now copy from offscreen to main canvas with a heavier blur
    switch (blendMode) {
      case "none":
        mainCtx.filter = "none";
        break;
      case "light":
        mainCtx.filter = "blur(128px)";
        break;
      case "heavy":
        mainCtx.filter = "blur(512px)";
        break;
      case "additive":
        mainCtx.globalCompositeOperation = "lighter";
        mainCtx.filter = "blur(512px)";
        break;
      default:
        mainCtx.filter = "blur(128px)";
    }
    mainCtx.drawImage(offscreen, 0, 0);
    mainCtx.filter = "none";
    mainCtx.globalCompositeOperation = "source-over";

    // Draw your ID text
    mainCtx.font = "12px monospace";
    mainCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
    mainCtx.fillText(`#${currentIdentifier}`, mainCanvas.width - 70, mainCanvas.height - 10);
  }

  function generateColorMapOLD5NoBlur() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));

    // Fill black background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pixelSize = canvas.width / pixelsPerSide;
    ctx.filter = "blur(2px)";

    // 1) Collect the dominant bin info (index + amplitude) for each frame
    const dominantIndices = new Array(totalFrames);
    const dominantAmps = new Array(totalFrames);

    audioData.forEach((frame, i) => {
      const domAmp = Math.max(...frame);                 // amplitude
      const domIndex = frame.indexOf(domAmp);            // which bin
      dominantIndices[i] = domIndex;
      dominantAmps[i] = domAmp;
    });

    // 2) Find overall min + max dominant bin index across all frames
    const minBin = Math.min(...dominantIndices);
    const maxBin = Math.max(...dominantIndices);
    // Avoid division-by-zero if minBin == maxBin
    const binRange = Math.max(1, maxBin - minBin);

    // 3) Second pass: map each frame's dominant bin to visible range 380..700
    audioData.forEach((frame, index) => {
      const domIndex = dominantIndices[index];
      const domAmp = dominantAmps[index];

      // fraction in [0..1] across the min->max range
      const fraction = (domIndex - minBin) / binRange;
      // map fraction to wavelength range
      const wavelength = 380 + fraction * (700 - 380);

      // convert wavelength -> approximate RGB
      const [r, g, b] = wavelengthToRGB(wavelength);

      // amplitude in [0..255] => alpha in [0..1]
      const alpha = domAmp / 255;

      // fill the pixel
      const x = (index % pixelsPerSide) * pixelSize;
      const y = Math.floor(index / pixelsPerSide) * pixelSize;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    });

    ctx.filter = "none";
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`#${currentIdentifier}`, canvas.width - 70, canvas.height - 10);
  }

  function generateColorMapOLD4() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));

    // Fill black background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pixelSize = canvas.width / pixelsPerSide;
    ctx.filter = "blur(2px)";

    audioData.forEach((frame, index) => {
      // 1) Find the loudest amplitude in this snapshot (the "dominant" bin)
      const dominantBinAmplitude = Math.max(...frame);
      const dominantBinIndex = frame.indexOf(dominantBinAmplitude);

      // 2) Map that bin index [0..(frame.length-1)] to a wavelength [380..700 nm]
      const fraction = dominantBinIndex / (frame.length - 1);
      const wavelength = 380 + fraction * (700 - 380);

      // 3) Convert that wavelength to an approximate RGB color
      const [r, g, b] = wavelengthToRGB(wavelength);

      // 4) Use amplitude for alpha (0–255 -> 0.0–1.0)
      const alpha = dominantBinAmplitude / 255;

      // Fill pixel with RGBA color
      const x = (index % pixelsPerSide) * pixelSize;
      const y = Math.floor(index / pixelsPerSide) * pixelSize;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    });

    ctx.filter = "none";
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`#${currentIdentifier}`, canvas.width - 70, canvas.height - 10);
  }

  function generateColorMapOLD3() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));

    // Fill black background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pixelSize = canvas.width / pixelsPerSide;
    ctx.filter = "blur(2px)";

    audioData.forEach((frame, index) => {
      const x = (index % pixelsPerSide) * pixelSize;
      const y = Math.floor(index / pixelsPerSide) * pixelSize;

      const avgFrequency = frame.reduce((sum, value) => sum + value, 0) / frame.length;
      const maxVolume = Math.max(...frame);

      // Map avgFrequency: 0..255 -> wavelength: 380..700
      const wavelength = 380 + (avgFrequency / 255) * (700 - 380);
      // Convert that to RGB
      const [r, g, b] = wavelengthToRGB(wavelength);

      // Optionally apply alpha from volume
      const alpha = maxVolume / 255; // or 1.0 if you prefer fully opaque

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    });

    // remove blur filter, add ID text
    ctx.filter = "none";
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`#${currentIdentifier}`, canvas.width - 70, canvas.height - 10);
  }

  function generateColorMapOLD2() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));

    // Fill black background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pixelSize = canvas.width / pixelsPerSide;
    ctx.filter = "blur(2px)";

    audioData.forEach((frame, index) => {
      const x = (index % pixelsPerSide) * pixelSize;
      const y = Math.floor(index / pixelsPerSide) * pixelSize;

      const avgFrequency = frame.reduce((sum, value) => sum + value, 0) / frame.length;
      const maxVolume = Math.max(...frame);

      // map avgFrequency => hue, maxVolume => lightness or something
      const hue = (avgFrequency / 255) * 360;        // 0-360
      const volumeRatio = maxVolume / 255;          // 0.0 - 1.0
      const saturation = 80;                        // 80%
      const lightness = 40 + volumeRatio * 50;      // 40% -> 90%

      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      const hexColor = rgbToHex(r, g, b);

      ctx.fillStyle = hexColor;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    });

    ctx.filter = "none";
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`#${currentIdentifier}`, canvas.width - 70, canvas.height - 10);
  }

  function hslToRgb(h, s, l) {
    // h, s, l in ranges [0..360], [0..100], [0..100]
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let rPrime, gPrime, bPrime;
    if (0 <= h && h < 60) { rPrime = c; gPrime = x; bPrime = 0; }
    else if (60 <= h && h < 120) { rPrime = x; gPrime = c; bPrime = 0; }
    else if (120 <= h && h < 180) { rPrime = 0; gPrime = c; bPrime = x; }
    else if (180 <= h && h < 240) { rPrime = 0; gPrime = x; bPrime = c; }
    else if (240 <= h && h < 300) { rPrime = x; gPrime = 0; bPrime = c; }
    else { rPrime = c; gPrime = 0; bPrime = x; }

    const r = Math.round((rPrime + m) * 255);
    const g = Math.round((gPrime + m) * 255);
    const b = Math.round((bPrime + m) * 255);

    return [r, g, b];
  }

  function rgbToHex(r, g, b) {
    // r, g, b each in [0..255]
    const toHex = (val) => val.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function wavelengthToRGB(wavelength) {
    // Wavelength in [380, 700], approximate
    // Based on algorithms by Dan Bruton and others.

    let R, G, B;
    let alpha = 1.0;

    // Factor for alpha ramp near the edges
    // (makes color less intense at near-UV or near-IR boundaries)
    let factor = 1.0;

    if (wavelength < 380 || wavelength > 700) {
      // Invisible or out-of-range
      return [0, 0, 0];
    }

    // Below is a simplified approximation of visible range

    if (wavelength >= 380 && wavelength < 440) {
      R = -(wavelength - 440) / (440 - 380);
      G = 0.0;
      B = 1.0;
    } else if (wavelength >= 440 && wavelength < 490) {
      R = 0.0;
      G = (wavelength - 440) / (490 - 440);
      B = 1.0;
    } else if (wavelength >= 490 && wavelength < 510) {
      R = 0.0;
      G = 1.0;
      B = -(wavelength - 510) / (510 - 490);
    } else if (wavelength >= 510 && wavelength < 580) {
      R = (wavelength - 510) / (580 - 510);
      G = 1.0;
      B = 0.0;
    } else if (wavelength >= 580 && wavelength < 645) {
      R = 1.0;
      G = -(wavelength - 645) / (645 - 580);
      B = 0.0;
    } else {
      // 645–700
      R = 1.0;
      G = 0.0;
      B = 0.0;
    }

    // Intensity factor for the edges
    if (wavelength < 420) {
      // ramp up from 380 to 420
      factor = 0.3 + 0.7 * (wavelength - 380) / (40);
    } else if (wavelength > 700 - 80) {
      // ramp down from 620 to 700
      factor = 0.3 + 0.7 * (700 - wavelength) / 80;
    }

    // Apply factor + gamma
    const gamma = 0.8;
    const R8 = Math.round(255 * Math.pow(R * factor, gamma));
    const G8 = Math.round(255 * Math.pow(G * factor, gamma));
    const B8 = Math.round(255 * Math.pow(B * factor, gamma));

    return [
      Math.max(R8, 0),
      Math.max(G8, 0),
      Math.max(B8, 0)
    ];
  }

  function generateColorMapOLD() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const totalFrames = audioData.length;
    const pixelsPerSide = Math.ceil(Math.sqrt(totalFrames));

    // Fill black
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pixelSize = canvas.width / pixelsPerSide;
    ctx.filter = "blur(2px)";

    audioData.forEach((frame, index) => {
      const x = (index % pixelsPerSide) * pixelSize;
      const y = Math.floor(index / pixelsPerSide) * pixelSize;
      const avgFrequency =
        frame.reduce((sum, value) => sum + value, 0) / frame.length;
      const maxVolume = Math.max(...frame);
      const brightness = Math.floor((avgFrequency / 255) * 255);
      const alpha = maxVolume / 255;

      ctx.fillStyle = `rgba(${brightness},${brightness},${brightness},${alpha})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    });

    ctx.filter = "none";
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(`#${currentIdentifier}`, canvas.width - 70, canvas.height - 10);
  }

  async function stopRecording() {
    // Optionally enforce minimum 3s
    if (Date.now() - startTimeRef.current < 3000) {
      return;
    }

    setIsRecording(false);
    clearInterval(timerIntervalRef.current);

    clearInterval(captureIntervalRef.current);
    captureIntervalRef.current = null;

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      await new Promise((resolve) => {
        mediaRecorderRef.current.onstop = () => {
          const audioBlob = new Blob(recordedChunks, { type: "audio/webm" });
          // store the audio blob in a Map
          audioStorageRef.current.set(currentIdentifier, audioBlob);
          resolve();
        };
      });
    }

    // Stop the audio tracks so the mic is actually released
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null; // clear out
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    generateColorMap();
  }

  function downloadImage() {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `voice-color-map-${currentIdentifier}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  }

  async function downloadRecordingAsMp3() {
    // 1) Bail if no current ID or Blob
    if (!currentIdentifier) return;
    const webmBlob = audioStorageRef.current.get(currentIdentifier);
    if (!webmBlob) {
      alert("No recording available to download.");
      return;
    }

    try {
      // 2) Convert WebM -> MP3 (using a separate helper function)
      const mp3Blob = await convertWebMToMP3(webmBlob);

      // 3) Create a temporary URL and trigger a download
      const url = URL.createObjectURL(mp3Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `recording-${currentIdentifier}.mp3`;
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Transcoding failed:", err);
      alert("Error transcoding the recording to MP3.");
    }
  }

  async function convertWebMToMP3(webmBlob) {
    // Create a new FFmpeg instance
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

    // Load the WASM files
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    // Write the .webm Blob to the in-memory filesystem
    const webmData = await fetchFile(webmBlob);
    await ffmpeg.writeFile('input.webm', webmData);

    // Convert to MP3
    await ffmpeg.exec(['-i', 'input.webm', 'output.mp3']);

    // Read out the MP3 file
    const mp3Data = await ffmpeg.readFile('output.mp3');
    const mp3Blob = new Blob([mp3Data.buffer], { type: 'audio/mpeg' });

    return mp3Blob;
  }

  // OLD WEBM version
  function downloadRecording() {
    if (!currentIdentifier) return;
    const storedBlob = audioStorageRef.current.get(currentIdentifier);
    if (!storedBlob) {
      alert("No recording available to download.");
      return;
    }
    // Create a URL for the Blob and click on a hidden link
    const url = URL.createObjectURL(storedBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `recording-${currentIdentifier}.webm`; // Or .mp3, etc., if re-encoded
    link.click();
    // Cleanup
    URL.revokeObjectURL(url);
  }


  async function handleFileUploadOfflineAnalysis(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear prior data
    setAudioData([]);

    const newId = generateUniqueIdentifier();
    setCurrentIdentifier(newId);

    // 1) Read file into an ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // 2) Decode into an AudioBuffer
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Save the file or Blob in the Map if you want to keep it for playback
    audioStorageRef.current.set(newId, file);

    // 3) We'll do an offline "instant" FFT on each chunk
    //    For simplicity, we only handle channel 0
    const floatData = audioBuffer.getChannelData(0);
    const totalSamples = floatData.length;

    // We'll accumulate results in a temporary array of arrays
    // that matches the shape of your current `audioData`: e.g. an array of frequency bins
    let allFrequencyFrames = [];

    // 4) Slide over the entire buffer in increments of `FFT_SIZE`
    //    If you want overlapping windows, you can adjust the step size
    for (let start = 0; start < totalSamples; start += FFT_SIZE) {
      // Extract a slice
      const slice = floatData.slice(start, start + FFT_SIZE);

      // If the last slice is shorter, pad it with zeros
      if (slice.length < FFT_SIZE) {
        const padded = new Float32Array(FFT_SIZE);
        padded.set(slice, 0);
        allFrequencyFrames.push(computeFFTMagnitudes(padded));
        console.log("Padded slice at", start);
        console.log("FFT magnitudes:", computeFFTMagnitudes(padded));
        break;
      } else {
        allFrequencyFrames.push(computeFFTMagnitudes(slice));
      }
    }

    // Suppose allFrequencyFrames is an array of arrays of magnitudes
    // Instead of .flat(), do:
    const merged = allFrequencyFrames.flatMap((frame) => Array.from(frame));

    // Now merged is a plain JS array of floats
    const minVal = merged.reduce((acc, val) => (val < acc ? val : acc), Infinity);
    const maxVal = merged.reduce((acc, val) => (val > acc ? val : acc), -Infinity);

    // Avoid division-by-zero if audio is completely silent
    const range = maxVal - minVal || 1;

    console.log("Min:", minVal, "Max:", maxVal, "Range:", range);

    // Now map each magnitude to [0..255]
    const normalizedFrames = allFrequencyFrames.map((frame) =>
      frame.map((m) => {
        const fraction = (m - minVal) / range;
        // fraction in [0..1]
        const scaled = fraction * 255;
        // clamp and round
        return Math.max(0, Math.min(255, Math.floor(scaled)));
      })
    );

    console.log("Normalized frames:", normalizedFrames.length);

    // Then store in state and generate the color map
    setAudioData(normalizedFrames);
    generateColorMap();

    // Cleanup
    audioCtx.close();
  }

  function computeFFTMagnitudes(timeDomainSamples) {
    // timeDomainSamples: Float32Array of length FFT_SIZE
    // Create an FFT instance
    const f = new FFT(FFT_SIZE);

    // Create complex arrays
    const input = f.createComplexArray();
    const output = f.createComplexArray();

    // Copy time domain samples into the 'input' as real values
    // (Imag is 0 for all)
    for (let i = 0; i < FFT_SIZE; i++) {
      input[2 * i] = timeDomainSamples[i];     // real
      input[2 * i + 1] = 0;                    // imag
    }

    // Perform the transform
    f.transform(output, input);

    // Convert complex FFT output into magnitudes
    // Typically only the first half (FFT_SIZE/2) is relevant
    const magnitudes = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const real = output[2 * i];
      const imag = output[2 * i + 1];
      magnitudes[i] = Math.sqrt(real * real + imag * imag);
    }

    return magnitudes;
  }

  function playStoredAudio() {
    if (!currentIdentifier) return;
    const storedBlob = audioStorageRef.current.get(currentIdentifier);
    if (!storedBlob) {
      alert("No audio available for this color map");
      return;
    }
    const audioUrl = URL.createObjectURL(storedBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  }

  // 1) The new upload button
  const uploadButton = !isRecording && (
    <label className="px-6 py-3 bg-sky-500 text-white rounded-lg cursor-pointer">
      <span>Upload Audio (Offline Analysis)</span>
      <input
        type="file"
        accept="audio/*"
        onChange={handleFileUploadOfflineAnalysis}
        className="hidden"
      />
    </label>
  );

  return (
    <div className="bg-gray-900 min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-8 text-center">
            Voice to Color Translator
          </h1>

          {/* Card-like container */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-xl">
            <div className="flex flex-col items-center gap-6">
              <div className="relative w-full">
                <canvas
                  ref={canvasRef}
                  className="w-full aspect-square rounded-lg gradient-canvas bg-black dropzone"
                />

                {/* Timer overlay */}
                {isRecording && (
                  <div className="absolute top-4 right-4 text-white text-xl font-mono bg-black/50 px-3 py-1 rounded-lg">
                    {timer}
                  </div>
                )}

                {/* Identifier overlay (after recording) */}
                {!isRecording && currentIdentifier && (
                  <div className="absolute bottom-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded-lg">
                    #{currentIdentifier}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-4 justify-center">
                {!isRecording && (
                  <div className="flex gap-4">
                    <button
                      onClick={startRecording}
                      className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <i className="bi bi-mic-fill" />
                      <span>Start Recording</span>
                    </button>
                    {uploadButton}
                  </div>
                )}

                {isRecording && (
                  <button
                    onClick={stopRecording}
                    className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-2 transition-colors recording-pulse"
                  >
                    <i className="bi bi-stop-fill" />
                    <span>Stop Recording</span>
                  </button>
                )}

                {!isRecording && currentIdentifier && (
                  <>
                    <button
                      onClick={downloadImage}
                      className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <i className="bi bi-download" />
                      <span>Download Image</span>
                    </button>
                    <button
                      onClick={playStoredAudio}
                      className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <i className="bi bi-play-fill" />
                      <span>Play Original Audio</span>
                    </button>
                    {/* NEW DOWNLOAD RECORDING BUTTON */}
                    <button
                      onClick={downloadRecordingAsMp3}
                      className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <i className="bi bi-cloud-download-fill" />
                      <span>Download Recording</span>
                    </button>
                  </>
                )}
              </div>

              {/* Now a new flex row to hold text & dropdown side by side */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between w-full gap-4">
                <div className="text-gray-300 text-center space-y-2">
                  <p>High frequencies = Lighter colors</p>
                  <p>Low frequencies = Darker colors</p>
                  <p>Silence = Black</p>
                  <p>Volume controls color intensity</p>
                  <p className="text-sm text-gray-400 mt-4">
                    Minimum recording time: 3 seconds
                  </p>
                  <p className="text-sm text-gray-400">
                    Drag &amp; drop a previous color map to play its original
                    audio
                  </p>
                </div>

                {/* A row with two dropdowns */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between w-full gap-4">
                  <div className="text-gray-300 text-center space-y-2">
                    {/* Info text */}
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="font-semibold">Select a Blend Mode</p>
                    <select
                      value={blendMode}
                      onChange={(e) => setBlendMode(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="none">No Blur</option>
                      <option value="light">Light Blur</option>
                      <option value="heavy">Heavy Blur</option>
                      <option value="circles">Circles</option>
                      <option value="additive">Additive Composite</option>
                    </select>

                    {/* Second dropdown for overlap */}
                    <p className="mt-4 font-semibold">Shape Overlap</p>
                    <select
                      value={shapeMultiplier}
                      onChange={(e) => setShapeMultiplier(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="1.0">No Overlap (1.0)</option>
                      <option value="1.5">Medium (1.5)</option>
                      <option value="2.0">Heavy (2.0)</option>
                    </select>
                    {/* Color spectrum invert */}
                    <p className="mt-4 font-semibold">Color Spectrum</p>
                    <select
                      value={colorSpectrum}
                      onChange={(e) => setColorSpectrum(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="normal">Normal</option>
                      <option value="inverted">Inverted</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;