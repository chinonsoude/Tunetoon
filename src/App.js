// src/App.js
import React, { useRef, useState, useEffect } from "react";
import { Routes, Route, useLocation, Link } from 'react-router-dom';
import "./App.css"; // must include your Tailwind directives
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import FFT from 'fft.js'; // ✅ Correct
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBHOQDsZVqpWbbEsTlbBqdOMtrvYl3Q8yQ",
  authDomain: "tunetoon-d77f5.firebaseapp.com",
  projectId: "tunetoon-d77f5",
  storageBucket: "tunetoon-d77f5.firebasestorage.app",
  messagingSenderId: "707469378953",
  appId: "1:707469378953:web:2c85454fa607a491ee4d58",
  measurementId: "G-65M27VT5N2"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const analytics = getAnalytics(firebaseApp);
const auth = getAuth(firebaseApp);
function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = "/";
    } catch (err) {
      console.error(err);
      setError("Invalid login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-6 rounded-lg w-full max-w-sm">
        <h2 className="text-white text-xl mb-4">Login</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded"
        />
        {error && <p className="text-red-400 mb-2">{error}</p>}
        <button
          onClick={handleLogin}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded"
        >
          Login
        </button>
      </div>
    </div>
  );
}

// For example, choose a chunk (fft) size
const FFT_SIZE = 2048;
const HOP_SIZE = 32;  // For the generate HQ audio map


function ProtectedRoute({ user, children }) {
  if (!user) {
    return <LoginPage />;
  }
  return children;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return null;

  return (
    <Routes>
      <Route path="/play" element={<PlayPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <HomePage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function HomePage() {
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
  const [isProcessingHQ, setIsProcessingHQ] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerIntervalRef = useRef(null);

  const audioStorageRef = useRef(new Map());

  const hqMediaRecorderRef = useRef(null);
  const hqRecordedChunksRef = useRef([]);

  const streamRef = useRef(null); // store the actual audio stream

  const captureIntervalRef = useRef(null);
  const [colorSpectrum, setColorSpectrum] = useState("normal");
  const [frequencyRangeMode, setFrequencyRangeMode] = useState("voice");
  const [pixelMosaicMode, setPixelMosaicMode] = useState(false);
  const [stainedGlassMode, setStainedGlassMode] = useState(false);

  const [isHQRecording, setIsHQRecording] = useState(false);
  const highQualityDataRef = useRef([]);
  const recorderNodeRef = useRef(null);
  const hqAudioContextRef = useRef(null);
  const hqStreamRef = useRef(null);
  const [recordingDoc, setRecordingDoc] = useState(null);
  const { purchased, qrCodeUrl, playUrl, qrToken } = recordingDoc || {};

  const handleLogout = async () => {
    try {
      await signOut(auth);
      window.location.reload();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  function generateLookupToken() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  function buildPublicPlayUrl(token) {
    return `${window.location.origin}/play?token=${encodeURIComponent(token)}`;
  }

  useEffect(() => {
    if (!currentIdentifier) return; // Prevents calling doc() with a null ID
    const unsub = onSnapshot(doc(db, 'recordings', currentIdentifier), (snap) => {
      if (snap.exists()) {
        setRecordingDoc(snap.data());
      }
    });
    return () => unsub();
  }, [currentIdentifier]);

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

  async function startHighQualityRecording() {
    try {
      // 1) Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 }, // or 2 if you want stereo
      });

      // 2) Create an AudioContext; optionally pass { sampleRate: 44100 }
      const audioCtx = new AudioContext({ sampleRate: 44100 });
      hqAudioContextRef.current = audioCtx;
      hqStreamRef.current = stream;

      hqMediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm; codecs=opus'
      });

      hqRecordedChunksRef.current = [];
      hqMediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          hqRecordedChunksRef.current.push(e.data);
        }
      };

      // Start recording in small chunks (e.g. 100 ms)
      hqMediaRecorderRef.current.start(100);

      // 3) Resume it (important for iOS/Safari)
      await audioCtx.resume();

      // 3) Add our AudioWorklet
      // Adjust the path so it points to your file
      await audioCtx.audioWorklet.addModule('/recorderWorklet.js');

      // 4) Create an instance of the AudioWorkletNode
      const recorderNode = new AudioWorkletNode(audioCtx, 'recorder-worklet');
      recorderNodeRef.current = recorderNode;

      // ** Clear existing data so we start fresh **
      highQualityDataRef.current = [];
      setAudioData([]);  // if you want to clear any leftover frames in the UI
      setCurrentIdentifier(generateUniqueIdentifier());

      // 5) Listen for messages from the processor
      recorderNode.port.onmessage = (event) => {
        // event.data is a Float32Array of samples
        // Append these to our array
        highQualityDataRef.current.push(...event.data);
      };

      // 6) Create a MediaStreamAudioSourceNode from the stream
      const source = audioCtx.createMediaStreamSource(stream);

      // 7) Connect the source -> recorderNode -> destination (optional)
      source.connect(recorderNode);
      // If you want to hear it while recording:
      recorderNode.connect(audioCtx.destination);

      // Clear and set state
      highQualityDataRef.current = [];
      setIsHQRecording(true);

    } catch (err) {
      console.error("Error capturing HQ audio:", err);
      alert("Could not access mic for HQ recording.");
    }
  }

  function generateColorMap() {
    if (!canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const mainCtx = mainCanvas.getContext("2d");

    mainCanvas.width = 512;
    mainCanvas.height = 512;

    const width = mainCanvas.width;
    const height = mainCanvas.height;

    // Clear canvas
    mainCtx.fillStyle = "black";
    mainCtx.fillRect(0, 0, width, height);

    if (!audioData.length) return;

    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const fftSize = analyserRef.current?.fftSize || 2048;
    const binHz = sampleRate / fftSize;

    // Log-spaced bands (voice-oriented)
    const bandEdges = [80, 160, 320, 640, 1280, 2560, 4000];

    let peakEnergy = 1;

    const ema = 0.28; // slightly more reactive

    let prevHue = 180;

    let prevEnergy = 0;

    // ---- Adaptive Frequency Window (smoothed) ----
    let adaptiveMinBin = 0;
    let adaptiveMaxBin = fftSize / 2;
    const rangeEma = 0.15; // smoothing factor

    // ---- Blend Mode Setup ----
    if (blendMode === "additive") {
      mainCtx.globalCompositeOperation = "lighter";
    } else {
      mainCtx.globalCompositeOperation = "source-over";
    }

    audioData.forEach((frame, index) => {
      // ===== SOFTENED STAINED GLASS MODE =====
      if (stainedGlassMode) {
        const sampleRate = audioContextRef.current?.sampleRate || 44100;
        const fftSize = analyserRef.current?.fftSize || 2048;
        const binHz = sampleRate / fftSize;

        const bandEdges = [80, 160, 320, 640, 1280, 2560, 4000];

        // Compute 6 band energies
        const bands = new Array(6).fill(0);
        for (let b = 0; b < 6; b++) {
          const startBin = Math.floor(bandEdges[b] / binHz);
          const endBin = Math.floor(bandEdges[b + 1] / binHz);
          for (let i = startBin; i <= endBin && i < frame.length; i++) {
            bands[b] += frame[i];
          }
        }

        const totalEnergy = bands.reduce((a, b) => a + b, 0);
        if (totalEnergy < 5) return;

        const sum = bands.reduce((a, b) => a + b, 0) || 1;
        const norm = bands.map(v => v / sum);

        // Use spectral centroid instead of dominant band
        let centroid = 0;
        for (let i = 0; i < 6; i++) centroid += i * norm[i];
        const centroidNorm = centroid / 5;

        // Moderate grid snap
        const timeNorm = index / audioData.length;
        let x = timeNorm * width;
        const gridSize = 20 * shapeMultiplier;
        x = Math.round(x / gridSize) * gridSize;

        let y = (1 - centroidNorm) * height;
        y = Math.round(y / gridSize) * gridSize;

        // Softer quantization
        const hueSteps = 10;   // more hue variation
        const slSteps = 5;     // smoother saturation/lightness

        let hue = centroidNorm * 360;
        hue = Math.round(hue / (360 / hueSteps)) * (360 / hueSteps);

        let saturation = 75;
        saturation = Math.round(saturation / (100 / slSteps)) * (100 / slSteps);

        let lightness = 45 + (norm[2] * 20);
        lightness = Math.round(lightness / (100 / slSteps)) * (100 / slSteps);

        const [r, g, b] = hslToRgb(hue, saturation, lightness);

        mainCtx.globalCompositeOperation = "source-over";
        mainCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;

        const radius = gridSize * 0.6;

        mainCtx.beginPath();
        mainCtx.arc(x, y, radius, 0, 2 * Math.PI);
        mainCtx.fill();

        return;
      }

      // ---- Compute 6-band energies ----
      const bands = new Array(6).fill(0);

      for (let b = 0; b < 6; b++) {
        const startBin = Math.floor(bandEdges[b] / binHz);
        const endBin = Math.floor(bandEdges[b + 1] / binHz);

        for (let i = startBin; i <= endBin && i < frame.length; i++) {
          bands[b] += frame[i];
        }
      }

      const totalEnergy = bands.reduce((a, b) => a + b, 0);
      peakEnergy = Math.max(peakEnergy, totalEnergy);

      if (totalEnergy < 5) {
        prevEnergy = totalEnergy;
        return; // silence gate
      }

      // ---- Transient detection ----
      const isTransient = totalEnergy > prevEnergy * 1.45;

      prevEnergy = totalEnergy;

      const sum = bands.reduce((a, b) => a + b, 0) || 1;
      const norm = bands.map(v => v / sum);

      // ---- Spectral centroid ----
      let centroid = 0;
      for (let i = 0; i < 6; i++) {
        centroid += i * norm[i];
      }
      const centroidNorm = centroid / 5;

      // ---- Spectral spread ----
      let variance = 0;
      for (let i = 0; i < 6; i++) {
        variance += norm[i] * Math.pow(i - centroid, 2);
      }
      const spread = Math.min(1, variance / 2.5);

      // ---- Energy normalization (log scaled) ----
      const energyNorm = Math.log1p(totalEnergy) / Math.log1p(peakEnergy);

      // ---- Position ----
      const timeNorm = index / audioData.length;
      let x = timeNorm * width;

      // Add slight generative vertical jitter based on spread
      const jitter = (spread - 0.5) * 20;
      let y = (1 - centroidNorm) * height + jitter;

      // ---- Pixel Mosaic Snap ----
      if (pixelMosaicMode) {
        const gridSize = 16 * shapeMultiplier;
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
      }

      // ---- 6 Band Anchor Points (dynamic harmonic placement) ----
      for (let b = 0; b < 6; b++) {
        const bandStrength = norm[b];
        if (bandStrength < 0.05) continue;

        // Compute weighted bin center inside this band
        const startBin = Math.floor(bandEdges[b] / binHz);
        const endBin = Math.floor(bandEdges[b + 1] / binHz);

        let weightedBin = 0;
        let binTotal = 0;

        for (let i = startBin; i <= endBin && i < frame.length; i++) {
          weightedBin += i * frame[i];
          binTotal += frame[i];
        }

        const binCenter = binTotal ? weightedBin / binTotal : startBin;

        // ---- Frequency Range Mode Switch ----
        let minBin, maxBin;

        if (frequencyRangeMode === "voice") {
          minBin = Math.floor(80 / binHz);
          maxBin = Math.floor(6000 / binHz);
        } else if (frequencyRangeMode === "music") {
          minBin = Math.floor(20 / binHz);
          maxBin = Math.floor(12000 / binHz);
        } else {
          // Adaptive mode
          let activeMin = frame.length;
          let activeMax = 0;
          const threshold = 10;

          for (let i = 0; i < frame.length; i++) {
            if (frame[i] > threshold) {
              activeMin = Math.min(activeMin, i);
              activeMax = Math.max(activeMax, i);
            }
          }

          if (activeMin >= activeMax) {
            activeMin = 0;
            activeMax = frame.length - 1;
          }

          adaptiveMinBin = adaptiveMinBin + (activeMin - adaptiveMinBin) * rangeEma;
          adaptiveMaxBin = adaptiveMaxBin + (activeMax - adaptiveMaxBin) * rangeEma;

          minBin = adaptiveMinBin;
          maxBin = adaptiveMaxBin;
        }

        const clampedBin = Math.max(minBin, Math.min(maxBin, binCenter));
        const binNorm = (clampedBin - minBin) / (maxBin - minBin || 1);
        const bandY = (1 - binNorm) * height;

        // Color each band distinctly across spectrum
        const bandHue = (b / 5) * 360;

        // ---- Strong Stained Glass Mode (band anchor) ----
        let bandHueToUse = bandHue;
        let bandSatToUse = 80;
        let bandLightToUse = 45;

        if (stainedGlassMode) {
          const hueSteps = 6;
          const slSteps = 3;

          bandHueToUse = Math.round(bandHueToUse / (360 / hueSteps)) * (360 / hueSteps);
          bandSatToUse = Math.round(bandSatToUse / (100 / slSteps)) * (100 / slSteps);
          bandLightToUse = Math.round(bandLightToUse / (100 / slSteps)) * (100 / slSteps);
        }

        let [br, bg, bb] = hslToRgb(bandHueToUse, bandSatToUse, bandLightToUse);

        const bandAlpha = bandStrength * 0.6;
        const bandRadius = 1 + bandStrength * 4;

        mainCtx.fillStyle = `rgba(${br}, ${bg}, ${bb}, ${bandAlpha})`;

        mainCtx.beginPath();
        mainCtx.arc(x, bandY, bandRadius, 0, 2 * Math.PI);
        mainCtx.fill();
      }

      // ---- Expanded Hue Mapping (full 360° palette) ----
      // Centroid drives primary hue
      let hueTarget = centroidNorm * 360;

      // Add spread-based hue modulation for more generative variation
      hueTarget += spread * 90;

      hueTarget = hueTarget % 360;

      prevHue = prevHue + (hueTarget - prevHue) * ema;

      // ---- Richer Saturation ----
      const saturation = Math.min(100, (0.6 + spread * 0.8) * 100);

      // Cap lightness so color never approaches white
      const lightness = (0.12 + energyNorm * 0.38) * 100;

      // Properly restore colorSpectrum inversion (hue inversion)
      if (colorSpectrum === "inverted") {
        // Invert hue 180 degrees
        prevHue = (prevHue + 180) % 360;
      }

      // ---- Strong Stained Glass Mode (centroid) ----
      let hueToUse = prevHue;
      let satToUse = saturation;
      let lightToUse = lightness;

      if (stainedGlassMode) {
        const hueSteps = 6;       // fewer hues
        const slSteps = 3;        // very blocky sat/light

        hueToUse = Math.round(hueToUse / (360 / hueSteps)) * (360 / hueSteps);
        satToUse = Math.round(satToUse / (100 / slSteps)) * (100 / slSteps);
        lightToUse = Math.round(lightToUse / (100 / slSteps)) * (100 / slSteps);
      }

      let [r, g, b] = hslToRgb(hueToUse, satToUse, lightToUse);

      // Reduce stacking brightness
      let alpha = Math.pow(energyNorm, 1.4) * 0.75;
      if (energyNorm < 0.04) alpha = 0;

      if (colorSpectrum === "inverted") {
        alpha = 1 - alpha;
      }

      mainCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

      // ---- Energy-driven glow toggle ----
      if (energyNorm > 0.75) {
        mainCtx.globalCompositeOperation = "lighter";
      } else {
        mainCtx.globalCompositeOperation = "source-over";
      }

      // Smaller brush to prevent over-bright overlap
      let baseRadius = 1.5 + energyNorm * 3.5;
      let radius = baseRadius * shapeMultiplier;

      // ---- Tonal vs Noisy Brush Mode ----
      const flatnessThreshold = 0.6;

      if (blendMode === "circles") {
        // ---- Huge Circle Pixel Mode ----
        const pixelRadius = 8 * shapeMultiplier + energyNorm * 14;

        mainCtx.beginPath();
        mainCtx.arc(x, y, pixelRadius, 0, 2 * Math.PI);
        mainCtx.fill();

      } else {
        if (spread > flatnessThreshold) {
          // Noisy / consonant → scatter particles
          const scatterCount = 3;
          for (let i = 0; i < scatterCount; i++) {
            const offsetX = (Math.random() - 0.5) * 10;
            const offsetY = (Math.random() - 0.5) * 10;

            mainCtx.fillRect(
              x + offsetX - radius * 0.6,
              y + offsetY - radius * 0.6,
              radius * 1.2,
              radius * 1.2
            );
          }
        } else {
          // Tonal / vowel → smooth square stroke
          mainCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }

      // ---- Transient Burst ----
      if (isTransient) {
        mainCtx.beginPath();
        mainCtx.arc(x, y, radius * 2.2, 0, 2 * Math.PI);
        mainCtx.fill();
      }

      // ---- Manual Bloom (heavy post-processing mode) ----
      if (blendMode === "heavy") {
        const originalAlpha = mainCtx.globalAlpha;

        mainCtx.globalAlpha = alpha * 0.25;
        mainCtx.beginPath();
        mainCtx.arc(x, y, radius * 3, 0, 2 * Math.PI);
        mainCtx.fill();

        mainCtx.globalAlpha = originalAlpha;
      }
    });

    // Reset filter
    mainCtx.filter = "none";

    mainCtx.globalCompositeOperation = "source-over";

    // Draw identifier
    // mainCtx.font = "12px monospace";
    // mainCtx.fillStyle = "rgba(255,255,255,0.5)";
    // mainCtx.fillText(`#${currentIdentifier}`, width - 70, height - 10);
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

  async function stopRecording() {
    if (!isRecording) return;
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
        mediaRecorderRef.current.onstop = async () => {
          const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
          // Convert to MP3
          const mp3Blob = await convertWebMToMP3(webmBlob);
          // Store the MP3 in our Map
          audioStorageRef.current.set(currentIdentifier, mp3Blob);
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
    await uploadAudioAndImageToFirebase();
  }

  function stopHighQualityRecording() {
    // 1) Hide the “Stop” button right away:
    setIsHQRecording(false);

    // 2) Show spinner or logo
    setIsProcessingHQ(true);

    // 3) Force a small delay so React can paint
    requestAnimationFrame(() => {
      // 4) Another slight delay
      setTimeout(() => {
        // Now do the mic teardown
        teardownHQMicAndProcess();
      }, 0);
    });
  }

  function dataURLToBlob(dataURL) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  async function uploadAudioAndImageToFirebase(idOverride) {
    const id = idOverride || currentIdentifier;

    try {
      const audioBlob = audioStorageRef.current.get(id);
      if (!audioBlob) {
        console.warn("No audio found for id:", id);
        return;
      }

      const lookupToken = generateLookupToken();
      const publicPlayUrl = buildPublicPlayUrl(lookupToken);
      const qrCodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(publicPlayUrl)}`;

      // ✅ use id everywhere
      const audioRef = ref(storage, `audio/${id}.mp3`);
      await uploadBytes(audioRef, audioBlob);

      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL("image/png");
      const imageBlob = dataURLToBlob(dataUrl);
      const imageRef = ref(storage, `images/${id}.png`);
      await uploadBytes(imageRef, imageBlob);

      await setDoc(doc(db, "recordings", id), {
        userId: auth.currentUser.uid,
        recordingId: id,
        audioPath: `audio/${id}.mp3`,
        imagePath: `images/${id}.png`,
        qrToken: lookupToken,
        playUrl: publicPlayUrl,
        qrCodeUrl: qrCodeImageUrl,
        createdAt: new Date()
      });

      console.log("Audio, image, and QR metadata stored in Firebase:", id);

    } catch (err) {
      console.error("Error uploading to Firebase:", err);
    }
  }

  async function teardownHQMicAndProcess() {
    // 1 Stop mic
    if (hqStreamRef.current) {
      hqStreamRef.current.getTracks().forEach(track => track.stop());
      hqStreamRef.current = null;
    }

    // 2 Disconnect
    if (recorderNodeRef.current) {
      recorderNodeRef.current.disconnect();
      recorderNodeRef.current = null;
    }
    if (hqAudioContextRef.current) {
      hqAudioContextRef.current.close();
      hqAudioContextRef.current = null;
    }

    // 3) Stop the MediaRecorder & wait for onstop
    if (hqMediaRecorderRef.current && hqMediaRecorderRef.current.state !== 'inactive') {
      await new Promise((resolve) => {
        hqMediaRecorderRef.current.onstop = () => {
          // Build the final WebM blob
          const webmBlob = new Blob(hqRecordedChunksRef.current, { type: 'audio/webm' });
          // Store in our audioStorageRef for uploading
          audioStorageRef.current.set(currentIdentifier, webmBlob);

          resolve();
        };
        hqMediaRecorderRef.current.stop();
      });
    }

    // Convert raw data
    const floatArray = new Float32Array(highQualityDataRef.current);

    // Now do your heavy offline FFT
    generateHQColorMap(floatArray);

    // 5) Optionally upload automatically
    await uploadAudioAndImageToFirebase();

    // Done: hide spinner
    setIsProcessingHQ(false);
  }

  function generateHQColorMap(floatArray) {
    const totalSamples = floatArray.length;
    let allFrequencyFrames = [];

    for (let start = 0; start < totalSamples; start += HOP_SIZE) {
      const end = start + FFT_SIZE;
      // If we go beyond totalSamples, zero-pad
      if (end > totalSamples) {
        const padded = new Float32Array(FFT_SIZE);
        padded.set(floatArray.subarray(start, totalSamples), 0);
        allFrequencyFrames.push(computeFFTMagnitudes(padded));
        break;
      } else {
        const slice = floatArray.subarray(start, end);
        allFrequencyFrames.push(computeFFTMagnitudes(slice));
      }
    }

    // normalize frames to [0..255] etc.
    const normalized = normalizeFFTFrames(allFrequencyFrames);

    // store in state, generate color map
    setAudioData(normalized);
    generateColorMap(); // or trigger the same method you use for final image
    // Done generating frames -> hide spinner
    setIsProcessingHQ(false);
  }

  function arrayMax(arr) {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (val > max) max = val;
    }
    return max;
  }

  function normalizeFFTFrames(frames) {
    if (!frames.length) return [];

    // 1️⃣ Convert magnitudes → log scale (perceptual compression)
    const logFrames = frames.map(frame =>
      frame.map(v => Math.log1p(v)) // log compression
    );

    // 2️⃣ Find global max AFTER log compression
    const merged = logFrames.flatMap(frame => Array.from(frame));
    const globalMax = arrayMax(merged) || 1;

    // 3️⃣ Normalize using GLOBAL max (not per-frame)
    //    This preserves real amplitude differences across time
    const normalized = logFrames.map(frame =>
      frame.map(v => (v / globalMax) * 255)
    );

    return normalized;
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

    // Use the ORIGINAL file, not audioBuffer
    let finalBlob = file;

    // Normalize only if needed
    if (file.type !== "audio/mpeg" && file.type !== "audio/mp3") {
      finalBlob = await convertWebMToMP3(file);
    }

    // Save the file or Blob in the Map if you want to keep it for playback
    audioStorageRef.current.set(newId, finalBlob);

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

    // Upload using explicit ID (you must update this function)
    await uploadAudioAndImageToFirebase(newId);

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

  // Keep a single audio instance so it doesn't stack
  const audioPlayerRef = useRef(null);

  function playStoredAudio() {
    if (!currentIdentifier) return;

    const storedBlob = audioStorageRef.current.get(currentIdentifier);
    if (!storedBlob) {
      alert("No audio available for this color map");
      return;
    }

    // Stop any currently playing audio
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }

    const audioUrl = URL.createObjectURL(storedBlob);
    const audio = new Audio(audioUrl);

    audioPlayerRef.current = audio;

    audio.play();
  }

  // 1) The new upload button
  const uploadButton = !isRecording && (
    <label className="px-6 py-3 bg-sky-500 text-white rounded-lg cursor-pointer">
      <span>Upload Audio (Offline Analysis)</span>
      <input
        type="file"
        accept="audio/*, audio/wav, audio/mpeg, audio/mp3, audio/ogg, audio/webm"
        onChange={handleFileUploadOfflineAnalysis}
        className="hidden"
      />
    </label>
  );

  return (
    <div className="bg-gray-900 min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-white">
              Tunetoon
            </h1>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
            >
              Logout
            </button>
          </div>

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
                {/*}
                {!isRecording && currentIdentifier && (
                  <div className="absolute bottom-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded-lg">
                    #{currentIdentifier}
                  </div>
                )}
                  */}
              </div>

              {/* Centered spinner overlay (if isProcessingHQ is true) */}
              {isProcessingHQ && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                  {/* Simple spinner icon or text */}
                  <div className="flex flex-col items-center">
                    {/* A Tailwind "spinner" can be done like this: */}
                    <div className="h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <span className="text-white">Processing HQ Audio...</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-4 justify-center">
                {!isRecording && !isHQRecording && (
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

                {!isHQRecording && !isRecording && (
                  <button
                    onClick={startHighQualityRecording}
                    className="px-6 py-3 bg-indigo-500 text-white rounded-lg"
                  >
                    Start HQ Recording
                  </button>
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

                {isHQRecording && (
                  <button
                    onClick={stopHighQualityRecording}
                    className="px-6 py-3 bg-red-500 text-white rounded-lg"
                  >
                    Stop HQ Recording
                  </button>
                )}

                {!isRecording && !isHQRecording && currentIdentifier && (
                  <>
                    {/* 
                    At some point in your UI, once the user has recorded 
                    (or you have a valid 'currentIdentifier'), we render MyRecordingActions.
                    */}
                    {!purchased && (
                      <>
                        <DownloadTuneToonButton
                          recordingId={currentIdentifier}
                          canDownload={!!(recordingDoc?.audioPath && recordingDoc?.imagePath)}
                        />
                        {/* <PurchaseTuneToonButton recordingId={currentIdentifier} /> */}
                      </>
                    )}
                    <button
                      onClick={playStoredAudio}
                      className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <i className="bi bi-play-fill" />
                      <span>Play Original Audio</span>
                    </button>
                    {playUrl && (
                      <a
                        href={playUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <span>Open Public Audio Page</span>
                      </a>
                    )}
                  </>
                )}
                {/* QR display section */}
                {!isRecording && !isHQRecording && currentIdentifier && qrCodeUrl && (
                  <div className="w-full flex flex-col items-center gap-3">
                    <p className="text-sm text-gray-300 text-center max-w-lg">
                      QR code for this Tunetoon. Scanning it opens the original audio playback page.
                    </p>
                    <img
                      src={qrCodeUrl}
                      alt="QR code for Tunetoon audio playback"
                      className="w-48 h-48 rounded-lg bg-white p-2"
                    />
                    {qrToken && (
                      <p className="text-xs text-gray-400 break-all text-center max-w-lg">
                        Lookup token: {qrToken}
                      </p>
                    )}
                    {playUrl && (
                      <a
                        href={playUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 underline break-all text-center max-w-lg hover:text-blue-300"
                      >
                        {playUrl}
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Customizable feature controls - centered layout */}
              <div className="w-full flex justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-col gap-2 items-center">
                    <p className="font-semibold text-gray-200">Select a Blend Mode</p>
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

                    <p className="mt-4 font-semibold text-gray-200">Shape Overlap</p>
                    <select
                      value={shapeMultiplier}
                      onChange={(e) => setShapeMultiplier(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="1.0">No Overlap (1.0)</option>
                      <option value="1.5">Medium (1.5)</option>
                      <option value="2.0">Heavy (2.0)</option>
                    </select>

                    <p className="mt-4 font-semibold text-gray-200">Color Spectrum</p>
                    <select
                      value={colorSpectrum}
                      onChange={(e) => setColorSpectrum(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="normal">Normal</option>
                      <option value="inverted">Inverted</option>
                    </select>

                    <p className="mt-4 font-semibold text-gray-200">Frequency Range</p>
                    <select
                      value={frequencyRangeMode}
                      onChange={(e) => setFrequencyRangeMode(e.target.value)}
                      className="px-2 py-1 rounded"
                    >
                      <option value="voice">Voice (80–6kHz)</option>
                      <option value="music">Music (20–12kHz)</option>
                      <option value="adaptive">Adaptive</option>
                    </select>

                    <p className="mt-4 font-semibold text-gray-200">Pixel Mosaic Mode</p>
                    <select
                      value={pixelMosaicMode ? "on" : "off"}
                      onChange={(e) => setPixelMosaicMode(e.target.value === "on")}
                      className="px-2 py-1 rounded"
                    >
                      <option value="off">Off</option>
                      <option value="on">On</option>
                    </select>

                    <p className="mt-4 font-semibold text-gray-200">Stained Glass Mode</p>
                    <select
                      value={stainedGlassMode ? "on" : "off"}
                      onChange={(e) => setStainedGlassMode(e.target.value === "on")}
                      className="px-2 py-1 rounded"
                    >
                      <option value="off">Off</option>
                      <option value="on">On</option>
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

function DownloadTuneToonButton({ recordingId, canDownload }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDownload = async () => {
    if (!recordingId) return;

    try {
      setIsLoading(true);

      const url = `https://us-central1-tunetoon-d77f5.cloudfunctions.net/downloadTunetoon?recordingId=${recordingId}`;

      // Debug logging for auth
      const token = await auth.currentUser?.getIdToken();

      if (!token) {
        throw new Error("No auth token available");
      }

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Download error response:", text);
        throw new Error(text || "Download failed");
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `tunetoon-${recordingId}.zip`;
      a.click();

    } catch (err) {
      console.error(err);
      alert("Download failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={isLoading || !canDownload}
      className={`px-6 py-3 rounded-lg flex items-center gap-2 transition-colors ${(isLoading || !canDownload)
        ? "bg-gray-500 cursor-not-allowed"
        : "bg-blue-500 hover:bg-blue-600 text-white"
        }`}
    >
      {!canDownload ? (
        <>
          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Uploading...</span>
        </>
      ) : isLoading ? (
        <>
          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Preparing Download...</span>
        </>
      ) : (
        <span>Download Tunetoon</span>
      )}
    </button>
  );
}

// function PurchaseTuneToonButton({ recordingId }) {
//   const handlePurchase = async () => {
//     // Set purchased to true in Firestore to trigger the unlimited QR generation
//     await setDoc(doc(db, 'recordings', recordingId), {
//       purchased: true
//     }, { merge: true });
//   };

//   return (
//     <button
//       onClick={handlePurchase}
//       className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg flex items-center gap-2 transition-colors"
//     >
//       Purchase TuneToon
//     </button>
//   );
// }

function PlayPage() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const recordingId = queryParams.get('recording');
  const qrToken = queryParams.get('token');

  const [recordingData, setRecordingData] = useState(null);
  const [error, setError] = useState('');
  const audioRef = useRef(null);

  useEffect(() => {
    if (!recordingId && !qrToken) {
      setError('No recording specified.');
      return;
    }

    async function fetchRecording() {
      try {
        let data = null;

        if (recordingId) {
          // Keep direct lookup for internal (authenticated) use
          const docRef = doc(db, 'recordings', recordingId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) data = docSnap.data();
        } else if (qrToken) {
          // Use Cloud Function for public QR access
          const res = await fetch(
            `https://us-central1-tunetoon-d77f5.cloudfunctions.net/getRecordingByToken?token=${encodeURIComponent(qrToken)}`
          );

          if (!res.ok) {
            setError('Recording not found.');
            return;
          }

          data = await res.json();
        }

        if (!data) {
          setError('Recording not found.');
          return;
        }

        setRecordingData(data);
      } catch (err) {
        console.error(err);
        setError('Error loading recording.');
      }
    }

    fetchRecording();
  }, [recordingId, qrToken]);

  useEffect(() => {
    if (recordingData?.audioUrl && audioRef.current) {
      audioRef.current.play().catch((err) => {
        console.group("🎵 Autoplay failed");
        console.error(err);
        console.log("name:", err.name);
        console.log("message:", err.message);
        console.log("code:", err.code);
        console.log("userAgent:", navigator.userAgent);
        console.log("platform:", navigator.platform);
        console.log("vendor:", navigator.vendor);
        console.groupEnd();
      });
    }
  }, [recordingData]);

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  if (!recordingData) {
    return <div className="p-4 text-white">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white px-4 py-8">
      <div className="max-w-2xl mx-auto bg-gray-800 rounded-lg shadow-xl p-6">
        <div className="flex items-center justify-center mb-6">
          <h1 className="text-2xl font-bold">Playing Tunetoon</h1>
        </div>

        {recordingData.imageUrl ? (
          <img src={recordingData.imageUrl} className="mb-6 rounded-lg shadow-lg max-w-full" />
        ) : (
          <p className="text-gray-300 mb-6">No image available.</p>
        )}

        {recordingData.audioUrl ? (
          <audio
            ref={audioRef}
            controls
            autoPlay
            src={recordingData.audioUrl}
            className="w-full"
          />
        ) : (
          <p className="text-gray-300">No audio available.</p>
        )}
        {recordingData.scanCount !== undefined && (
          <p className="text-sm text-gray-400 mt-4 text-center">
            Played {recordingData.scanCount} times
          </p>
        )}
        <div className="mt-8 text-center">
          <a
            href="https://www.elohimslens.com/tunetoon"
            target="_blank"
            rel="noreferrer"
            className="text-lg font-semibold text-blue-400 hover:text-blue-300 underline"
          >
            Order Yours Today!
          </a>
        </div>
      </div>
    </div>
  );
}

export default App;