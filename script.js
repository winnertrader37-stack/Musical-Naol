"use strict";

/* =========================================================
   NAOL MUSIC STUDIO
   Complete browser-based audio editor and mixer.
   Features:
   - Multiple audio tracks
   - Waveforms
   - Playback, pause, stop and seek
   - Track volume, pan, mute, solo and remove
   - Master volume, pan and EQ
   - Reverb, delay, chorus, compressor and limiter
   - Automatic track-level balancing
   - Virtual keyboard and keyboard performance recording
   - Microphone recording
   - Keyboard performance playback
   - WAV mix export
   - Audio file export
   - Pitch, speed and fade controls
   - Project metadata export
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  /* =======================================================
     DOM ELEMENTS
  ======================================================= */

  const appStatus = $("appStatus");
  const toast = $("toast");

  const uploadInput = $("audioUpload");
  const trackList = $("trackList");

  const playBtn = $("playBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const seekBar = $("seekBar");

  const currentTrackName = $("currentTrackName");
  const currentTime = $("currentTime");
  const durationDisplay = $("duration");

  const recordBtn = $("recordBtn");
  const stopRecordBtn = $("stopRecordBtn");
  const recordStatus = $("recordStatus");

  const masterVolume = $("masterVolume");
  const panControl = $("panControl");

  const bassControl = $("bassControl");
  const midControl = $("midControl");
  const trebleControl = $("trebleControl");

  const reverbControl = $("reverbControl");
  const delayControl = $("delayControl");
  const compressorControl = $("compressorControl");

  const noiseGateControl = $("noiseGateControl");
  const chorusControl = $("chorusControl");
  const limiterControl = $("limiterControl");

  const pitchControl = $("pitchControl");
  const speedControl = $("speedControl");

  const fadeInControl = $("fadeInControl");
  const fadeOutControl = $("fadeOutControl");

  const exportFormat = $("exportFormat");

  /* =======================================================
     APPLICATION STATE
  ======================================================= */

  let audioContext = null;

  let masterInput = null;
  let masterGain = null;
  let masterAnalyser = null;

  let masterLow = null;
  let masterMid = null;
  let masterHigh = null;
  let masterPan = null;

  let masterCompressor = null;
  let masterLimiter = null;

  let masterDelay = null;
  let masterDelayFeedback = null;
  let masterDelayWet = null;

  let masterReverb = null;
  let masterReverbWet = null;

  let masterChorus = null;
  let chorusLFO = null;
  let chorusDepth = null;
  let chorusWet = null;

  let recordingDestination = null;

  let masterNoiseGate = null;
  let gateAnalyser = null;
  let gateTimer = null;

  let tracks = [];
  let nextTrackId = 1;
  let selectedTrackId = null;

  let microphoneStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  let microphoneSource = null;
  let microphoneGain = null;

  let keyboardDestination = null;
  let keyboardVolume = 0.3;

  const keyboardActiveNotes = new Map();
  const keyboardTimers = new Map();

  let keyboardRecording = false;
  let keyboardRecordingStart = 0;
  let keyboardEvents = [];
  let keyboardPlaybackTimers = [];

  let isPlaying = false;
  let transportStartTime = 0;
  let transportPosition = 0;
  let transportTimer = null;

  let toastTimer = null;
  let renderInProgress = false;

  const trackElements = new Map();

  /* =======================================================
     HELPERS
  ======================================================= */

  function notify(message) {
    if (!toast) {
      console.log("[Naol Music Studio]", message);
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  function setStatus(message) {
    if (appStatus) {
      appStatus.textContent = message;
    }
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = value;
    }
  }

  function bind(id, eventName, callback) {
    const element = $(id);

    if (element) {
      element.addEventListener(eventName, callback);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getNumber(id, fallback = 0) {
    const element = $(id);

    if (!element) return fallback;

    const number = Number(element.value);

    return Number.isFinite(number) ? number : fallback;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      seconds = 0;
    }

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);

    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(remaining).padStart(2, "0")
    );
  }

  function safeDisconnect(node) {
    if (!node) return;

    try {
      node.disconnect();
    } catch (_) {
      // The node may already be disconnected.
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function audioSupported() {
    if (!AudioContextClass) {
      notify("Browser kee Web Audio API hin deeggaru.");
      return false;
    }

    return true;
  }

  function getMasterDuration() {
    let duration = 0;

    for (const track of tracks) {
      duration = Math.max(
        duration,
        track.buffer.duration
      );
    }

    if (keyboardEvents.length) {
      const latest = keyboardEvents.reduce(
        (maximum, event) =>
          Math.max(maximum, event.end || event.start),
        0
      );

      duration = Math.max(duration, latest);
    }

    return duration;
  }

  function getTransportPosition() {
    if (!isPlaying || !audioContext) {
      return transportPosition;
    }

    return Math.max(
      0,
      transportPosition +
        (audioContext.currentTime - transportStartTime)
    );
  }

  function panText(pan) {
    if (Math.abs(pan) < 0.01) return "Center";

    return pan < 0
      ? "Left " + Math.round(-pan * 100) + "%"
      : "Right " + Math.round(pan * 100) + "%";
  }

  function makeSafeFilename(value) {
    return String(value || "naol-music")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .slice(0, 100);
  }

  /* =======================================================
     AUDIO ENGINE
  ======================================================= */

  async function ensureAudioContext() {
    if (!audioSupported()) {
      throw new Error("Web Audio API is unavailable.");
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();

      masterInput = audioContext.createGain();

      masterLow = audioContext.createBiquadFilter();
      masterLow.type = "lowshelf";
      masterLow.frequency.value = 150;

      masterMid = audioContext.createBiquadFilter();
      masterMid.type = "peaking";
      masterMid.frequency.value = 1000;
      masterMid.Q.value = 0.8;

      masterHigh = audioContext.createBiquadFilter();
      masterHigh.type = "highshelf";
      masterHigh.frequency.value = 6500;

      masterPan = audioContext.createStereoPanner();

      masterCompressor =
        audioContext.createDynamicsCompressor();

      masterCompressor.threshold.value = -20;
      masterCompressor.knee.value = 18;
      masterCompressor.ratio.value = 4;
      masterCompressor.attack.value = 0.006;
      masterCompressor.release.value = 0.18;

      masterLimiter =
        audioContext.createDynamicsCompressor();

      masterLimiter.threshold.value = -3;
      masterLimiter.knee.value = 0;
      masterLimiter.ratio.value = 20;
      masterLimiter.attack.value = 0.001;
      masterLimiter.release.value = 0.08;

      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.8;

      masterAnalyser = audioContext.createAnalyser();
      masterAnalyser.fftSize = 1024;
      masterAnalyser.smoothingTimeConstant = 0.8;

      masterNoiseGate = audioContext.createGain();
      masterNoiseGate.gain.value = 1;

      gateAnalyser = audioContext.createAnalyser();
      gateAnalyser.fftSize = 512;

      masterDelay = audioContext.createDelay(2);
      masterDelay.delayTime.value = 0.25;

      masterDelayFeedback = audioContext.createGain();
      masterDelayFeedback.gain.value = 0.15;

      masterDelayWet = audioContext.createGain();
      masterDelayWet.gain.value = 0;

      masterReverb = audioContext.createConvolver();
      masterReverb.buffer = createImpulseResponse(
        audioContext,
        2.2,
        2
      );

      masterReverbWet = audioContext.createGain();
      masterReverbWet.gain.value = 0;

      masterChorus = audioContext.createDelay(0.1);
      masterChorus.delayTime.value = 0.025;

      chorusLFO = audioContext.createOscillator();
      chorusLFO.type = "sine";
      chorusLFO.frequency.value = 0.7;

      chorusDepth = audioContext.createGain();
      chorusDepth.gain.value = 0.003;

      chorusWet = audioContext.createGain();
      chorusWet.gain.value = 0;

      chorusLFO.connect(chorusDepth);
      chorusDepth.connect(masterChorus.delayTime);
      chorusLFO.start();

      recordingDestination =
        audioContext.createMediaStreamDestination();

      /*
       * Main processing chain.
       *
       * Track and keyboard audio:
       * source -> track gain/pan -> masterInput
       * masterInput -> EQ -> pan -> compressor -> limiter
       * -> master gain -> analyser -> speakers and recording.
       */

      masterInput.connect(masterLow);
      masterLow.connect(masterMid);
      masterMid.connect(masterHigh);
      masterHigh.connect(masterPan);

      masterPan.connect(masterCompressor);
      masterCompressor.connect(masterLimiter);
      masterLimiter.connect(masterGain);

      masterGain.connect(masterNoiseGate);
      masterNoiseGate.connect(masterAnalyser);

      masterAnalyser.connect(audioContext.destination);
      masterAnalyser.connect(recordingDestination);

      /*
       * Parallel effects.
       * Each wet effect is captured in the master recording.
       */

      masterGain.connect(masterDelay);
      masterDelay.connect(masterDelayWet);

      masterDelayWet.connect(audioContext.destination);
      masterDelayWet.connect(recordingDestination);

      masterDelay.connect(masterDelayFeedback);
      masterDelayFeedback.connect(masterDelay);

      masterGain.connect(masterReverb);
      masterReverb.connect(masterReverbWet);

      masterReverbWet.connect(audioContext.destination);
      masterReverbWet.connect(recordingDestination);

      masterGain.connect(masterChorus);
      masterChorus.connect(chorusWet);

      chorusWet.connect(audioContext.destination);
      chorusWet.connect(recordingDestination);

      keyboardDestination = audioContext.createGain();
      keyboardDestination.gain.value = 1;
      keyboardDestination.connect(masterInput);

      updateMasterControls();
      updateEffectControls();

      startNoiseGateMonitor();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext;
  }

  function createImpulseResponse(context, seconds, decay) {
    const length = Math.floor(
      context.sampleRate * seconds
    );

    const impulse = context.createBuffer(
      2,
      length,
      context.sampleRate
    );

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        const progress = i / length;

        data[i] =
          (Math.random() * 2 - 1) *
          Math.pow(1 - progress, decay);
      }
    }

    return impulse;
  }

  /* =======================================================
     NOISE GATE
  ======================================================= */

  function startNoiseGateMonitor() {
    if (gateTimer) {
      clearInterval(gateTimer);
    }

    gateTimer = setInterval(() => {
      if (
        !audioContext ||
        !gateAnalyser ||
        !masterNoiseGate
      ) {
        return;
      }

      const threshold = clamp(
        getNumber("noiseGateControl", 0),
        0,
        1
      );

      /*
       * Zero means gate disabled.
       * Higher values require a louder signal to open.
       */

      if (threshold <= 0.001) {
        masterNoiseGate.gain.setTargetAtTime(
          1,
          audioContext.currentTime,
          0.03
        );

        return;
      }

      const data = new Uint8Array(
        gateAnalyser.frequencyBinCount
      );

      gateAnalyser.getByteTimeDomainData(data);

      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / data.length);

      const openThreshold = threshold * 0.08;
      const target = rms > openThreshold ? 1 : 0.12;

      masterNoiseGate.gain.setTargetAtTime(
        target,
        audioContext.currentTime,
        0.035
      );
    }, 40);

    /*
     * Analyse the processed master signal to control
     * the noise gate.
     */

    if (masterAnalyser && gateAnalyser) {
      safeDisconnect(gateAnalyser);

      try {
        masterAnalyser.connect(gateAnalyser);
      } catch (_) {
        // Ignore duplicate connection errors.
      }
    }
  }

  /* =======================================================
     MASTER CONTROLS
  ======================================================= */

  function updateMasterControls() {
    const volume = clamp(
      getNumber("masterVolume", 0.8),
      0,
      1
    );

    const pan = clamp(
      getNumber("panControl", 0),
      -1,
      1
    );

    const bass = clamp(
      getNumber("bassControl", 0),
      -24,
      24
    );

    const mid = clamp(
      getNumber("midControl", 0),
      -24,
      24
    );

    const treble = clamp(
      getNumber("trebleControl", 0),
      -24,
      24
    );

    setText(
      "masterVolumeValue",
      Math.round(volume * 100) + "%"
    );

    setText("panValue", panText(pan));
    setText("bassValue", bass.toFixed(1) + " dB");
    setText("midValue", mid.toFixed(1) + " dB");
    setText("trebleValue", treble.toFixed(1) + " dB");

    if (!audioContext) return;

    const now = audioContext.currentTime;

    masterGain.gain.setTargetAtTime(
      volume,
      now,
      0.025
    );

    masterPan.pan.setTargetAtTime(
      pan,
      now,
      0.025
    );

    masterLow.gain.setTargetAtTime(
      bass,
      now,
      0.025
    );

    masterMid.gain.setTargetAtTime(
      mid,
      now,
      0.025
    );

    masterHigh.gain.setTargetAtTime(
      treble,
      now,
      0.025
    );
  }

  /* =======================================================
     EFFECT CONTROLS
  ======================================================= */

  function updateEffectControls() {
    const reverb = clamp(
      getNumber("reverbControl", 0),
      0,
      1
    );

    const delay = clamp(
      getNumber("delayControl", 0),
      0,
      1
    );

    const compression = clamp(
      getNumber("compressorControl", 0.25),
      0,
      1
    );

    const chorus = clamp(
      getNumber("chorusControl", 0),
      0,
      1
    );

    const limiter = clamp(
      getNumber("limiterControl", 0.5),
      0,
      1
    );

    setText("reverbValue", Math.round(reverb * 100) + "%");
    setText("delayValue", Math.round(delay * 100) + "%");

    setText(
      "compressorValue",
      Math.round(compression * 100) + "%"
    );

    setText("chorusValue", Math.round(chorus * 100) + "%");
    setText("limiterValue", Math.round(limiter * 100) + "%");

    if (!audioContext) return;

    const now = audioContext.currentTime;

    masterReverbWet.gain.setTargetAtTime(
      reverb * 0.4,
      now,
      0.04
    );

    masterDelayWet.gain.setTargetAtTime(
      delay * 0.3,
      now,
      0.04
    );

    masterDelayFeedback.gain.setTargetAtTime(
      clamp(delay * 0.4, 0, 0.55),
      now,
      0.04
    );

    masterCompressor.threshold.setTargetAtTime(
      -8 - compression * 22,
      now,
      0.04
    );

    masterCompressor.ratio.setTargetAtTime(
      1 + compression * 8,
      now,
      0.04
    );

    masterLimiter.threshold.setTargetAtTime(
      -1 - limiter * 7,
      now,
      0.04
    );

    masterLimiter.ratio.setTargetAtTime(
      4 + limiter * 16,
      now,
      0.04
    );

    chorusWet.gain.setTargetAtTime(
      chorus * 0.25,
      now,
      0.04
    );
  }

  /* =======================================================
     TRACK ANALYSIS AND AUTO MIX
  ======================================================= */

  function analyseBuffer(buffer) {
    let sum = 0;
    let samples = 0;
    let peak = 0;

    const step = Math.max(
      1,
      Math.floor(buffer.length / 60000)
    );

    for (
      let channel = 0;
      channel < buffer.numberOfChannels;
      channel++
    ) {
      const data = buffer.getChannelData(channel);

      for (let i = 0; i < data.length; i += step) {
        const value = data[i];

        sum += value * value;
        samples++;

        peak = Math.max(peak, Math.abs(value));
      }
    }

    return {
      rms: samples ? Math.sqrt(sum / samples) : 0,
      peak
    };
  }

  async function autoMix() {
    if (!tracks.length) {
      notify("Auto Mix dura audio upload godhi.");
      return;
    }

    await ensureAudioContext();

    const activeTracks = tracks.filter(
      (track) => !track.muted
    );

    if (!activeTracks.length) {
      notify("Track hundi mute dha. Track tokko unmute godhi.");
      return;
    }

    const measurements = activeTracks.map((track) => {
      const result = analyseBuffer(track.buffer);

      track.rms = result.rms;
      track.peak = result.peak;

      return result;
    });

    /*
     * Target RMS is conservative.
     * Avoid extreme amplification of nearly silent tracks.
     */

    const targetRms = 0.16;

    activeTracks.forEach((track, index) => {
      const rms = measurements[index].rms;
      const peak = measurements[index].peak;

      if (rms <= 0.0001) {
        track.volume = Math.min(track.volume, 0.25);
        return;
      }

      const correction = targetRms / rms;

      /*
       * Limit gain correction to avoid large jumps.
       * Peak protection is also considered.
       */

      let gain = clamp(correction, 0.35, 2.5);

      if (peak > 0) {
        gain = Math.min(gain, 0.9 / peak);
      }

      track.volume = clamp(gain, 0.05, 1);
    });

    if (bassControl) bassControl.value = "0";
    if (midControl) midControl.value = "0";
    if (trebleControl) trebleControl.value = "1";

    if (compressorControl) {
      compressorControl.value = "0.4";
    }

    if (limiterControl) {
      limiterControl.value = "0.65";
    }

    if (masterVolume) {
      masterVolume.value = "0.8";
    }

    updateMasterControls();
    updateEffectControls();

    tracks.forEach((track) => {
      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          track.muted ? 0 : track.volume,
          audioContext.currentTime,
          0.04
        );
      }
    });

    renderTracks();

    setStatus("Auto Mix complete");
    notify(
      "Auto Mix xumurameera. Dhaggeeffadhu; yoo barbaachise sirreessi."
    );
  }

  bind("autoMixBtn", "click", () => {
    autoMix().catch((error) => {
      console.error(error);
      notify("Auto Mix hojjechuu hin dandeenye.");
    });
  });

  bind("autoAdjustBtn", "click", () => {
    autoMix().catch((error) => {
      console.error(error);
      notify("Auto Adjust hojjechuu hin dandeenye.");
    });
  });

  /* =======================================================
     TRACK NODES
  ======================================================= */

  function createTrackNodes(track) {
    if (!audioContext) return;

    safeDisconnect(track.gainNode);
    safeDisconnect(track.panNode);

    track.gainNode = audioContext.createGain();
    track.panNode = audioContext.createStereoPanner();

    track.gainNode.gain.value = track.muted
      ? 0
      : track.volume;

    track.panNode.pan.value = track.pan;

    track.gainNode.connect(track.panNode);
    track.panNode.connect(masterInput);
  }

  function stopTrackSource(track, savePosition = true) {
    if (!track.source) return;

    if (savePosition && isPlaying) {
      track.offset = getTransportPosition();
    }

    const source = track.source;

    track.source = null;

    try {
      source.onended = null;
      source.stop();
    } catch (_) {
      // The source may already have stopped.
    }

    safeDisconnect(source);
  }

  function playTrack(track, position = 0) {
    if (!audioContext || !track) return;

    stopTrackSource(track, false);
    createTrackNodes(track);

    const source = audioContext.createBufferSource();

    source.buffer = track.buffer;

    const speed = clamp(
      getNumber("speedControl", 1),
      0.25,
      2
    );

    const pitch = clamp(
      getNumber("pitchControl", 0),
      -12,
      12
    );

    source.playbackRate.value = speed;
    source.detune.value = pitch * 100;

    source.connect(track.gainNode);

    const startPosition = clamp(
      position,
      0,
      Math.max(0, track.buffer.duration - 0.001)
    );

    const now = audioContext.currentTime;

    const fadeIn = Math.max(
      0,
      getNumber("fadeInControl", 0)
    );

    const fadeOut = Math.max(
      0,
      getNumber("fadeOutControl", 0)
    );

    track.gainNode.gain.cancelScheduledValues(now);

    const targetVolume = track.muted
      ? 0
      : track.volume;

    track.gainNode.gain.setValueAtTime(
      fadeIn > 0 && startPosition === 0 ? 0 : targetVolume,
      now
    );

    if (fadeIn > 0 && startPosition === 0) {
      track.gainNode.gain.linearRampToValueAtTime(
        targetVolume,
        now + Math.min(fadeIn, track.buffer.duration / 2)
      );
    }

    if (
      fadeOut > 0 &&
      track.buffer.duration > startPosition + fadeOut
    ) {
      const fadeStart =
        track.buffer.duration - fadeOut - startPosition;

      track.gainNode.gain.setValueAtTime(
        targetVolume,
        now + Math.max(0, fadeStart / speed)
      );

      track.gainNode.gain.linearRampToValueAtTime(
        0,
        now + (track.buffer.duration - startPosition) / speed
      );
    }

    track.source = source;
    track.offset = startPosition;

    source.onended = () => {
      if (track.source === source) {
        track.source = null;
      }
    };

    if (startPosition < track.buffer.duration) {
      source.start(now, startPosition);
    }

    return source;
  }

  /* =======================================================
     TRACK UI
  ======================================================= */

  function createTrackElement(track) {
    if (!trackList) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "track";
    wrapper.dataset.trackId = String(track.id);

    const header = document.createElement("div");
    header.className = "track-header";

    const title = document.createElement("strong");
    title.className = "track-title";
    title.textContent = track.name;

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.textContent = "Select";

    selectButton.addEventListener("click", () => {
      selectedTrackId = track.id;

      document
        .querySelectorAll(".track.selected")
        .forEach((element) => {
          element.classList.remove("selected");
        });

      wrapper.classList.add("selected");

      setText("currentTrackName", track.name);
      setStatus("Selected: " + track.name);
    });

    header.append(title, selectButton);

    const waveform = document.createElement("canvas");
    waveform.className = "track-waveform";
    waveform.width = 900;
    waveform.height = 90;
    waveform.style.width = "100%";
    waveform.style.maxWidth = "100%";

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const volumeLabel = document.createElement("label");
    volumeLabel.textContent = "Volume ";

    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = "0.01";
    volume.value = String(track.volume);

    volume.addEventListener("input", () => {
      track.volume = Number(volume.value);

      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          track.muted ? 0 : track.volume,
          audioContext.currentTime,
          0.02
        );
      }

      const value = wrapper.querySelector(".track-volume-value");

      if (value) {
        value.textContent =
          Math.round(track.volume * 100) + "%";
      }
    });

    const volumeValue = document.createElement("span");
    volumeValue.className = "track-volume-value";
    volumeValue.textContent =
      Math.round(track.volume * 100) + "%";

    volumeLabel.append(volume, volumeValue);

    const panLabel = document.createElement("label");
    panLabel.textContent = "Pan ";

    const pan = document.createElement("input");
    pan.type = "range";
    pan.min = "-1";
    pan.max = "1";
    pan.step = "0.01";
    pan.value = String(track.pan);

    pan.addEventListener("input", () => {
      track.pan = Number(pan.value);

      if (track.panNode && audioContext) {
        track.panNode.pan.setTargetAtTime(
          track.pan,
          audioContext.currentTime,
          0.02
        );
      }
    });

    panLabel.appendChild(pan);

    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.textContent = track.muted ? "Unmute" : "Mute";

    muteButton.addEventListener("click", () => {
      track.muted = !track.muted;
      muteButton.textContent = track.muted ? "Unmute" : "Mute";

      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          track.muted ? 0 : track.volume,
          audioContext.currentTime,
          0.02
        );
      }
    });

    const soloButton = document.createElement("button");
    soloButton.type = "button";
    soloButton.textContent = track.solo ? "Unsolo" : "Solo";

    soloButton.addEventListener("click", () => {
      track.solo = !track.solo;

      if (track.solo) {
        tracks.forEach((other) => {
          other.solo = other.id === track.id;
        });
      } else {
        tracks.forEach((other) => {
          other.solo = false;
        });
      }

      applySoloState();
      renderTracks();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";

    removeButton.addEventListener("click", () => {
      removeTrack(track.id);
    });

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export WAV";

    exportButton.addEventListener("click", () => {
      exportSingleTrack(track).catch((error) => {
        console.error(error);
        notify("Track export hin milkoofne.");
      });
    });

    controls.append(
      volumeLabel,
      panLabel,
      muteButton,
      soloButton,
      exportButton,
      removeButton
    );

    wrapper.append(header, waveform, controls);

    trackList.appendChild(wrapper);

    trackElements.set(track.id, {
      wrapper,
      waveform
    });

    drawWaveform(track, waveform);

    return wrapper;
  }

  function drawWaveform(track, canvas) {
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(0, 0, width, height);

    context.fillStyle = "#111827";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "#273449";
    context.lineWidth = 1;

    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const data = track.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));

    context.strokeStyle = "#39d5ff";
    context.lineWidth = 1;

    context.beginPath();

    for (let x = 0; x < width; x++) {
      const start = x * step;
      const end = Math.min(data.length, start + step);

      let minimum = 1;
      let maximum = -1;

      for (let i = start; i < end; i++) {
        minimum = Math.min(minimum, data[i]);
        maximum = Math.max(maximum, data[i]);
      }

      const top = (1 - maximum) * height / 2;
      const bottom = (1 - minimum) * height / 2;

      context.moveTo(x, top);
      context.lineTo(x, bottom);
    }

    context.stroke();
  }

  function renderTracks() {
    if (!trackList) return;

    trackList.innerHTML = "";
    trackElements.clear();

    tracks.forEach((track) => {
      createTrackElement(track);
    });
  }

  function applySoloState() {
    const hasSolo = tracks.some((track) => track.solo);

    tracks.forEach((track) => {
      const shouldMute =
        track.muted || (hasSolo && !track.solo);

      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          shouldMute ? 0 : track.volume,
          audioContext.currentTime,
          0.02
        );
      }
    });
  }

  /* =======================================================
     TRACK ADD / REMOVE / UPLOAD
  ======================================================= */

  async function addAudioFile(file) {
    if (!file) return;

    if (
      file.type &&
      !file.type.startsWith("audio/") &&
      !/\.(wav|mp3|ogg|m4a|aac|flac|webm|opus)$/i.test(file.name)
    ) {
      notify("Faayila audio filadhu.");
      return;
    }

    await ensureAudioContext();

    const arrayBuffer = await file.arrayBuffer();

    const decodedBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0)
    );

    const track = {
      id: nextTrackId++,
      name: file.name || "Audio Track",
      buffer: decodedBuffer,
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      source: null,
      gainNode: null,
      panNode: null,
      offset: 0,
      rms: 0,
      peak: 0
    };

    const analysis = analyseBuffer(decodedBuffer);

    track.rms = analysis.rms;
    track.peak = analysis.peak;

    tracks.push(track);

    if (selectedTrackId === null) {
      selectedTrackId = track.id;
    }

    renderTracks();

    updateTransportDisplay();

    setStatus("Audio added: " + track.name);
    notify("Audio upload milkaa'e: " + track.name);
  }

  function removeTrack(trackId) {
    const index = tracks.findIndex(
      (track) => track.id === trackId
    );

    if (index === -1) return;

    const track = tracks[index];

    stopTrackSource(track, false);

    safeDisconnect(track.gainNode);
    safeDisconnect(track.panNode);

    tracks.splice(index, 1);

    if (selectedTrackId === trackId) {
      selectedTrackId = tracks.length
        ? tracks[0].id
        : null;
    }

    renderTracks();
    updateTransportDisplay();

    notify("Track haqameera.");
  }

  bind("audioUpload", "change", async (event) => {
    const files = Array.from(event.target.files || []);

    if (!files.length) return;

    for (const file of files) {
      try {
        await addAudioFile(file);
      } catch (error) {
        console.error("Audio upload error:", error);

        notify(
          "Audio hin banne. Faayila audio biraa yaali."
        );
      }
    }

    event.target.value = "";
  });

  /* =======================================================
     TRANSPORT
  ======================================================= */

  async function playAllTracks(position = null) {
    await ensureAudioContext();

    if (!tracks.length && !keyboardEvents.length) {
      notify("Jalqaba audio upload godhi ykn keyboard taphadhu.");
      return;
    }

    if (position !== null) {
      transportPosition = position;
    }

    const duration = getMasterDuration();

    if (transportPosition >= duration) {
      transportPosition = 0;
    }

    isPlaying = true;
    transportStartTime = audioContext.currentTime;

    tracks.forEach((track) => {
      const hasSolo = tracks.some((item) => item.solo);

      if (hasSolo && !track.solo) {
        return;
      }

      if (track.muted) return;

      playTrack(track, transportPosition);
    });

    scheduleKeyboardPlayback(transportPosition);

    startTransportTimer();

    setStatus("Playing");
  }

  function pauseAllTracks() {
    if (!isPlaying) return;

    transportPosition = getTransportPosition();
    isPlaying = false;

    tracks.forEach((track) => {
      stopTrackSource(track, false);
    });

    stopKeyboardPlayback();

    if (transportTimer) {
      clearInterval(transportTimer);
      transportTimer = null;
    }

    updateTransportDisplay();
    setStatus("Paused");
  }

  function stopAllTracks() {
    isPlaying = false;
    transportPosition = 0;

    tracks.forEach((track) => {
      stopTrackSource(track, false);
    });

    stopKeyboardPlayback();

    keyboardActiveNotes.forEach((note) => {
      try {
        note.oscillator.stop();
      } catch (_) {
        // Oscillator may already have stopped.
      }
    });

    keyboardActiveNotes.clear();

    if (transportTimer) {
      clearInterval(transportTimer);
      transportTimer = null;
    }

    updateTransportDisplay();
    setStatus("Stopped");
  }

  function startTransportTimer() {
    if (transportTimer) {
      clearInterval(transportTimer);
    }

    transportTimer = setInterval(() => {
      updateTransportDisplay();

      const duration = getMasterDuration();

      if (
        isPlaying &&
        getTransportPosition() >= duration
      ) {
        stopAllTracks();
        setStatus("Playback complete");
      }
    }, 100);
  }

  function updateTransportDisplay() {
    const position = getTransportPosition();
    const duration = getMasterDuration();

    if (currentTime) {
      currentTime.textContent = formatTime(position);
    }

    if (durationDisplay) {
      durationDisplay.textContent = formatTime(duration);
    }

    if (seekBar) {
      seekBar.max = String(Math.max(duration, 0.01));
      seekBar.value = String(
        clamp(position, 0, Math.max(duration, 0.01))
      );
    }

    if (currentTrackName) {
      const selected = tracks.find(
        (track) => track.id === selectedTrackId
      );

      if (selected) {
        currentTrackName.textContent = selected.name;
      } else if (keyboardRecording) {
        currentTrackName.textContent = "Keyboard Recording";
      } else {
        currentTrackName.textContent = "No track selected";
      }
    }
  }

  bind("playBtn", "click", () => {
    playAllTracks().catch((error) => {
      console.error(error);
      notify("Playback jalqabuu hin dandeenye.");
    });
  });

  bind("pauseBtn", "click", pauseAllTracks);
  bind("stopBtn", "click", stopAllTracks);

  bind("seekBar", "input", (event) => {
    const newPosition = Math.max(
      0,
      Number(event.target.value) || 0
    );

    if (isPlaying) {
      pauseAllTracks();
      transportPosition = newPosition;

      playAllTracks(newPosition).catch((error) => {
        console.error(error);
      });
    } else {
      transportPosition = newPosition;
      updateTransportDisplay();
    }
  });

  /* =======================================================
     MASTER RECORDING
  ======================================================= */

  async function startMasterRecording() {
    await ensureAudioContext();

    if (mediaRecorder && mediaRecorder.state === "recording") {
      notify("Recording duraan jalqabameera.");
      return;
    }

    recordedChunks = [];

    const mimeType = getSupportedRecorderMimeType();

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(
            recordingDestination.stream,
            { mimeType }
          )
        : new MediaRecorder(recordingDestination.stream);
    } catch (error) {
      console.error(error);
      notify("Browser kee audio recording hin deeggaru.");
      return;
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const type =
        mediaRecorder && mediaRecorder.mimeType
          ? mediaRecorder.mimeType
          : "audio/webm";

      const blob = new Blob(recordedChunks, { type });

      if (blob.size > 0) {
        downloadBlob(blob, "naol-master-recording.webm");
      }

      recordedChunks = [];

      setText("recordStatus", "Recording saved");
      notify("Recording buufameera.");
    };

    mediaRecorder.start(250);

    setText("recordStatus", "Recording...");
    setStatus("Master recording");
    notify("Master recording jalqabame.");
  }

  function stopMasterRecording() {
    if (
      !mediaRecorder ||
      mediaRecorder.state !== "recording"
    ) {
      notify("Recording hin jalqabamne.");
      return;
    }

    mediaRecorder.stop();
    setText("recordStatus", "Saving recording...");
  }

  function getSupportedRecorderMimeType() {
    if (typeof MediaRecorder === "undefined") {
      return "";
    }

    const types = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/ogg"
    ];

    return types.find((type) =>
      MediaRecorder.isTypeSupported(type)
    ) || "";
  }

  bind("recordBtn", "click", () => {
    startMasterRecording().catch((error) => {
      console.error(error);
      notify("Recording jalqabuu hin dandeenye.");
    });
  });

  bind("stopRecordBtn", "click", stopMasterRecording);

  /* =======================================================
     MICROPHONE RECORDING
  ======================================================= */

  async function startMicrophoneRecording() {
    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      notify("Browser kee microphone access hin deeggaru.");
      return;
    }

    await ensureAudioContext();

    if (microphoneStream) {
      notify("Microphone recording duraan banameera.");
      return;
    }

    try {
      microphoneStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

      microphoneSource =
        audioContext.createMediaStreamSource(microphoneStream);

      microphoneGain = audioContext.createGain();
      microphoneGain.gain.value = 0.8;

      microphoneSource.connect(microphoneGain);
      microphoneGain.connect(masterInput);

      setText("recordStatus", "Microphone active");
      setStatus("Microphone active");

      notify("Microphone hojii irra jira.");
    } catch (error) {
      console.error(error);

      microphoneStream = null;

      notify(
        "Microphone hin banamne. Permission browser kee ilaali."
      );
    }
  }

  function stopMicrophoneRecording() {
    if (!microphoneStream) {
      notify("Microphone hin banamne.");
      return;
    }

    safeDisconnect(microphoneSource);
    safeDisconnect(microphoneGain);

    microphoneStream.getTracks().forEach((track) => {
      track.stop();
    });

    microphoneStream = null;
    microphoneSource = null;
    microphoneGain = null;

    setText("recordStatus", "Microphone stopped");
    notify("Microphone cufameera.");
  }

  bind("micRecordBtn", "click", () => {
    startMicrophoneRecording().catch((error) => {
      console.error(error);
      notify("Microphone jalqabuu hin dandeenye.");
    });
  });

  bind("startMicBtn", "click", () => {
    startMicrophoneRecording().catch(console.error);
  });

  bind("stopMicBtn", "click", stopMicrophoneRecording);

  bind("stopMicrophoneBtn", "click", stopMicrophoneRecording);

  /* =======================================================
     VIRTUAL KEYBOARD
  ======================================================= */

  const NOTE_FREQUENCIES = {
    C3: 130.813,
    "C#3": 138.591,
    Db3: 138.591,
    D3: 146.832,
    "D#3": 155.563,
    Eb3: 155.563,
    E3: 164.814,
    F3: 174.614,
    "F#3": 184.997,
    Gb3: 184.997,
    G3: 195.998,
    "G#3": 207.652,
    Ab3: 207.652,
    A3: 220,
    "A#3": 233.082,
    Bb3: 233.082,
    B3: 246.942,

    C4: 261.626,
    "C#4": 277.183,
    Db4: 277.183,
    D4: 293.665,
    "D#4": 311.127,
    Eb4: 311.127,
    E4: 329.628,
    F4: 349.228,
    "F#4": 369.994,
    Gb4: 369.994,
    G4: 391.995,
    "G#4": 415.305,
    Ab4: 415.305,
    A4: 440,
    "A#4": 466.164,
    Bb4: 466.164,
    B4: 493.883,

    C5: 523.251,
    "C#5": 554.365,
    Db5: 554.365,
    D5: 587.330,
    "D#5": 622.254,
    Eb5: 622.254,
    E5: 659.255,
    F5: 698.456,
    "F#5": 739.989,
    Gb5: 739.989,
    G5: 783.991,
    "G#5": 830.609,
    Ab5: 830.609,
    A5: 880,
    "A#5": 932.328,
    Bb5: 932.328,
    B5: 987.767,

    C6: 1046.502
  };

  function getNoteFrequency(note) {
    if (typeof note === "number") {
      return note > 0 ? note : null;
    }

    if (!note) return null;

    const cleanNote = String(note)
      .trim()
      .replace(/♯/g, "#")
      .replace(/♭/g, "b");

    if (NOTE_FREQUENCIES[cleanNote]) {
      return NOTE_FREQUENCIES[cleanNote];
    }

    const match = cleanNote.match(
      /^([A-Ga-g])([#b]?)(-?\d+)$/
    );

    if (!match) return null;

    const letter = match[1].toUpperCase();
    const accidental = match[2];
    const octave = Number(match[3]);

    const semitones = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11
    };

    let midi =
      (octave + 1) * 12 +
      semitones[letter];

    if (accidental === "#") midi += 1;
    if (accidental === "b") midi -= 1;

    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function createKeyboardVoice(frequency, velocity = 0.8) {
    if (!audioContext || !keyboardDestination) return null;

    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;

    const now = audioContext.currentTime;
    const level = clamp(velocity, 0, 1) * keyboardVolume;

    envelope.gain.setValueAtTime(0.0001, now);

    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level),
      now + 0.025
    );

    oscillator.connect(envelope);
    envelope.connect(keyboardDestination);

    oscillator.start(now);

    return {
      oscillator,
      envelope,
      startTime: now,
      velocity: clamp(velocity, 0, 1)
    };
  }

  function startKeyboardNote(note, velocity = 0.8) {
    ensureAudioContext().then(() => {
      const frequency = getNoteFrequency(note);

      if (!frequency) {
        notify("Keyboard note hin beekamne.");
        return;
      }

      const key = String(note);

      if (keyboardActiveNotes.has(key)) return;

      const voice = createKeyboardVoice(frequency, velocity);

      if (!voice) return;

      keyboardActiveNotes.set(key, voice);

      if (keyboardRecording) {
        keyboardEvents.push({
          note: key,
          frequency,
          start: Math.max(
            0,
            audioContext.currentTime - keyboardRecordingStart
          ),
          end: null,
          velocity: voice.velocity
        });
      }

      highlightKeyboardKey(key, true);
    }).catch((error) => {
      console.error(error);
    });
  }

  function stopKeyboardNote(note) {
    const key = String(note);
    const voice = keyboardActiveNotes.get(key);

    if (!voice || !audioContext) return;

    const now = audioContext.currentTime;

    voice.envelope.gain.cancelScheduledValues(now);

    voice.envelope.gain.setTargetAtTime(
      0.0001,
      now,
      0.04
    );

    try {
      voice.oscillator.stop(now + 0.2);
    } catch (_) {
      // Oscillator may already have stopped.
    }

    keyboardActiveNotes.delete(key);

    if (keyboardRecording) {
      const event = [...keyboardEvents]
        .reverse()
        .find(
          (item) =>
            item.note === key &&
            item.end === null
        );

      if (event) {
        event.end = Math.max(
          event.start + 0.05,
          now - keyboardRecordingStart
        );
      }
    }

    highlightKeyboardKey(key, false);
  }

  function highlightKeyboardKey(note, active) {
    const selectors = [
      `[data-note="${CSS.escape(String(note))}"]`,
      `[data-key="${CSS.escape(String(note))}"]`
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.classList.toggle("active", active);
        element.classList.toggle("pressed", active);
      });
    });
  }

  function getKeyNote(element) {
    return (
      element.dataset.note ||
      element.dataset.key ||
      element.dataset.pitch ||
      null
    );
  }

  function bindVirtualKeyboard() {
    const keySelector = [
      "[data-note]",
      "[data-frequency]",
      ".piano-key",
      ".keyboard-key",
      ".key"
    ].join(",");

    document.querySelectorAll(keySelector).forEach((element) => {
      if (element.dataset.naolKeyboardBound === "1") {
        return;
      }

      element.dataset.naolKeyboardBound = "1";

      const note =
        getKeyNote(element) ||
        element.dataset.frequency;

      const start = (event) => {
        event.preventDefault();

        const frequency = element.dataset.frequency;

        startKeyboardNote(
          frequency ? Number(frequency) : note
        );
      };

      const stop = (event) => {
        event.preventDefault();

        stopKeyboardNote(note);
      };

      element.addEventListener("pointerdown", start);
      element.addEventListener("pointerup", stop);
      element.addEventListener("pointerleave", stop);
      element.addEventListener("pointercancel", stop);
    });
  }

  /*
   * Optional computer-keyboard mapping.
   * A, W, S, E, D, F, T, G, Y, H, U, J play C4-B4.
   */

  const computerKeyMap = {
    a: "C4",
    w: "C#4",
    s: "D4",
    e: "D#4",
    d: "E4",
    f: "F4",
    t: "F#4",
    g: "G4",
    y: "G#4",
    h: "A4",
    u: "A#4",
    j: "B4",
    k: "C5"
  };

  const computerKeysDown = new Set();

  document.addEventListener("keydown", (event) => {
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;

    if (
      target &&
      (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
    ) {
      return;
    }

    const note = computerKeyMap[event.key.toLowerCase()];

    if (!note || computerKeysDown.has(event.key.toLowerCase())) {
      return;
    }

    computerKeysDown.add(event.key.toLowerCase());
    startKeyboardNote(note);
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    const note = computerKeyMap[key];

    if (!note) return;

    computerKeysDown.delete(key);
    stopKeyboardNote(note);
  });

  window.addEventListener("blur", () => {
    Array.from(computerKeysDown).forEach((key) => {
      const note = computerKeyMap[key];

      if (note) stopKeyboardNote(note);
    });

    computerKeysDown.clear();
  });

  /* =======================================================
     KEYBOARD RECORDING
  ======================================================= */

  function startKeyboardRecording() {
    ensureAudioContext().then(() => {
      if (keyboardRecording) {
        notify("Keyboard recording duraan jalqabameera.");
        return;
      }

      keyboardEvents = [];
      keyboardRecording = true;
      keyboardRecordingStart = audioContext.currentTime;

      setText("keyboardRecordStatus", "Recording keyboard...");
      setText("recordStatus", "Keyboard recording...");

      setStatus("Keyboard recording");

      notify(
        "Keyboard recording jalqabame. Keys taphadhu; yeroo xumurtu Stop cuqaasi."
      );
    }).catch((error) => {
      console.error(error);
      notify("Keyboard recording jalqabuu hin dandeenye.");
    });
  }

  function stopKeyboardRecording() {
    if (!keyboardRecording) {
      notify("Keyboard recording hin jalqabamne.");
      return;
    }

    if (audioContext) {
      const now = audioContext.currentTime;

      keyboardEvents.forEach((event) => {
        if (event.end === null) {
          event.end = Math.max(
            event.start + 0.05,
            now - keyboardRecordingStart
          );
        }
      });
    }

    keyboardRecording = false;

    setText(
      "keyboardRecordStatus",
      "Keyboard recorded: " + keyboardEvents.length + " notes"
    );

    setText(
      "recordStatus",
      "Keyboard recorded: " + keyboardEvents.length + " notes"
    );

    setStatus("Keyboard recording complete");

    notify(
      "Keyboard performance galmaa'eera. WAV export gochuun audio mix keessatti dabali."
    );
  }

  bind("recordKeyboardBtn", "click", startKeyboardRecording);
  bind("keyboardRecordBtn", "click", startKeyboardRecording);
  bind("startKeyboardRecordBtn", "click", startKeyboardRecording);

  bind("stopKeyboardRecordBtn", "click", stopKeyboardRecording);
  bind("stopKeyboardBtn", "click", stopKeyboardRecording);
  bind("stopKeyboardRecordingBtn", "click", stopKeyboardRecording);

  /* =======================================================
     KEYBOARD PERFORMANCE PLAYBACK
  ======================================================= */

  function stopKeyboardPlayback() {
    keyboardPlaybackTimers.forEach((timer) => {
      clearTimeout(timer);
    });

    keyboardPlaybackTimers = [];

    keyboardActiveNotes.forEach((voice, note) => {
      stopKeyboardNote(note);
    });
  }

  function scheduleKeyboardPlayback(position = 0) {
    stopKeyboardPlayback();

    if (!keyboardEvents.length || !audioContext) return;

    const speed = clamp(
      getNumber("speedControl", 1),
      0.25,
      2
    );

    const events = keyboardEvents.slice();

    events.forEach((event) => {
      const start = Math.max(0, event.start || 0);
      const end = Math.max(
        start + 0.05,
        event.end === null ? start + 0.3 : event.end
      );

      if (end <= position) return;

      const adjustedStart = Math.max(
        0,
        (start - position) / speed
      );

      const adjustedEnd = Math.max(
        adjustedStart + 0.05,
        (end - position) / speed
      );

      const startTimer = setTimeout(() => {
        if (!isPlaying) return;

        startKeyboardNote(
          event.frequency || event.note,
          event.velocity || 0.8
        );
      }, adjustedStart * 1000);

      const endTimer = setTimeout(() => {
        stopKeyboardNote(event.note);
      }, adjustedEnd * 1000);

      keyboardPlaybackTimers.push(startTimer, endTimer);
    });
  }

  /* =======================================================
     WAV ENCODING
  ======================================================= */

  function audioBufferToWav(buffer) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;

    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;

    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    function writeString(offset, text) {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = [];

    for (let channel = 0; channel < channels; channel++) {
      channelData.push(buffer.getChannelData(channel));
    }

    let offset = 44;

    for (let i = 0; i < frames; i++) {
      for (let channel = 0; channel < channels; channel++) {
        let sample = channelData[channel][i];

        sample = clamp(sample, -1, 1);

        const intSample = sample < 0
          ? sample * 32768
          : sample * 32767;

        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob(
      [arrayBuffer],
      { type: "audio/wav" }
    );
  }

  /* =======================================================
     OFFLINE MIX RENDERING
  ======================================================= */

  async function renderMixToWavBuffer() {
    if (renderInProgress) {
      throw new Error("Mix render is already running.");
    }

    renderInProgress = true;

    try {
      const sampleRate = audioContext
        ? audioContext.sampleRate
        : 44100;

      const speed = clamp(
        getNumber("speedControl", 1),
        0.25,
        2
      );

      const duration = getMasterDuration();

      if (duration <= 0) {
        throw new Error("No audio available to render.");
      }

      const outputDuration = duration / speed + 2;

      if (outputDuration > 600) {
        throw new Error(
          "Mix is longer than 10 minutes. Export a shorter mix."
        );
      }

      const frameCount = Math.ceil(
        outputDuration * sampleRate
      );

      const offline = new OfflineAudioContext(
        2,
        frameCount,
        sampleRate
      );

      const input = offline.createGain();

      const low = offline.createBiquadFilter();
      low.type = "lowshelf";
      low.frequency.value = 150;
      low.gain.value = getNumber("bassControl", 0);

      const mid = offline.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.8;
      mid.gain.value = getNumber("midControl", 0);

      const high = offline.createBiquadFilter();
      high.type = "highshelf";
      high.frequency.value = 6500;
      high.gain.value = getNumber("trebleControl", 0);

      const pan = offline.createStereoPanner();
      pan.pan.value = clamp(
        getNumber("panControl", 0),
        -1,
        1
      );

      const compressor = offline.createDynamicsCompressor();

      const compression = clamp(
        getNumber("compressorControl", 0.4),
        0,
        1
      );

      compressor.threshold.value = -8 - compression * 22;
      compressor.ratio.value = 1 + compression * 8;

      const limiter = offline.createDynamicsCompressor();

      const limiterAmount = clamp(
        getNumber("limiterControl", 0.5),
        0,
        1
      );

      limiter.threshold.value = -1 - limiterAmount * 7;
      limiter.ratio.value = 4 + limiterAmount * 16;

      const master = offline.createGain();
      master.gain.value = clamp(
        getNumber("masterVolume", 0.8),
        0,
        1
      );

      input.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(pan);
      pan.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(master);
      master.connect(offline.destination);

      const fadeIn = Math.max(
        0,
        getNumber("fadeInControl", 0)
      );

      const fadeOut = Math.max(
        0,
        getNumber("fadeOutControl", 0)
      );

      const hasSolo = tracks.some((track) => track.solo);

      tracks.forEach((track) => {
        if (track.muted || (hasSolo && !track.solo)) {
          return;
        }

        const source = offline.createBufferSource();
        source.buffer = track.buffer;

        source.playbackRate.value = speed;

        const pitch = clamp(
          getNumber("pitchControl", 0),
          -12,
          12
        );

        source.detune.value = pitch * 100;

        const gain = offline.createGain();
        const trackPan = offline.createStereoPanner();

        gain.gain.value = clamp(
          track.volume,
          0,
          1
        );

        trackPan.pan.value = clamp(track.pan, -1, 1);

        if (fadeIn > 0) {
          gain.gain.setValueAtTime(
            0,
            0
          );

          gain.gain.linearRampToValueAtTime(
            clamp(track.volume, 0, 1),
            Math.min(fadeIn / speed, track.buffer.duration / speed)
          );
        }

        if (fadeOut > 0) {
          const fadeStart = Math.max(
            0,
            track.buffer.duration / speed - fadeOut / speed
          );

          gain.gain.setValueAtTime(
            clamp(track.volume, 0, 1),
            fadeStart
          );

          gain.gain.linearRampToValueAtTime(
            0,
            track.buffer.duration / speed
          );
        }

        source.connect(gain);
        gain.connect(trackPan);
        trackPan.connect(input);

        source.start(0);
      });

      /*
       * Recreate keyboard performance with offline oscillators.
       * This ensures recorded notes are included in the WAV.
       */

      keyboardEvents.forEach((event) => {
        const start = Math.max(0, event.start || 0) / speed;

        const end = Math.max(
          (event.end === null ? (event.start || 0) + 0.3 : event.end) / speed,
          start + 0.05
        );

        if (start >= outputDuration) return;

        const oscillator = offline.createOscillator();
        const envelope = offline.createGain();

        oscillator.type = "triangle";

        oscillator.frequency.value =
          event.frequency ||
          getNoteFrequency(event.note) ||
          440;

        const velocity = clamp(
          event.velocity || 0.8,
          0,
          1
        );

        const level = keyboardVolume * velocity;

        envelope.gain.setValueAtTime(
          0.0001,
          start
        );

        envelope.gain.exponentialRampToValueAtTime(
          Math.max(0.0002, level),
          start + 0.025
        );

        envelope.gain.setValueAtTime(
          Math.max(0.0002, level),
          end
        );

        envelope.gain.exponentialRampToValueAtTime(
          0.0001,
          end + 0.04
        );

        oscillator.connect(envelope);
        envelope.connect(input);

        oscillator.start(start);
        oscillator.stop(end + 0.06);
      });

      /*
       * Basic offline reverb and delay.
       */

      const reverbAmount = clamp(
        getNumber("reverbControl", 0),
        0,
        1
      );

      const delayAmount = clamp(
        getNumber("delayControl", 0),
        0,
        1
      );

      if (reverbAmount > 0) {
        const convolver = offline.createConvolver();

        convolver.buffer = createImpulseResponse(
          offline,
          2,
          2
        );

        const wet = offline.createGain();
        wet.gain.value = reverbAmount * 0.25;

        master.connect(convolver);
        convolver.connect(wet);
        wet.connect(offline.destination);
      }

      if (delayAmount > 0) {
        const delayNode = offline.createDelay(2);
        delayNode.delayTime.value = 0.25;

        const wet = offline.createGain();
        wet.gain.value = delayAmount * 0.2;

        master.connect(delayNode);
        delayNode.connect(wet);
        wet.connect(offline.destination);
      }

      setStatus("Rendering WAV...");

      return await offline.startRendering();
    } finally {
      renderInProgress = false;
    }
  }

  async function exportMixToWav() {
    if (renderInProgress) {
      notify("WAV render duraan adeemaa jira.");
      return;
    }

    try {
      await ensureAudioContext();

      notify("WAV mix qopheessaa jira...");

      const buffer = await renderMixToWavBuffer();
      const blob = audioBufferToWav(buffer);

      downloadBlob(blob, "naol-music-studio-mix.wav");

      setStatus("WAV export complete");
      notify("WAV mix guutuun buufameera.");
    } catch (error) {
      console.error(error);
      setStatus("WAV export failed");

      notify(
        error.message || "WAV export gochuu hin dandeenye."
      );
    }
  }

  async function exportSingleTrack(track) {
    if (!track) return;

    await ensureAudioContext();

    const offline = new OfflineAudioContext(
      track.buffer.numberOfChannels,
      track.buffer.length,
      track.buffer.sampleRate
    );

    const source = offline.createBufferSource();
    source.buffer = track.buffer;

    const gain = offline.createGain();
    gain.gain.value = clamp(track.volume, 0, 1);

    source.connect(gain);
    gain.connect(offline.destination);

    source.start();

    const buffer = await offline.startRendering();
    const blob = audioBufferToWav(buffer);

    downloadBlob(
      blob,
      makeSafeFilename(track.name.replace(/\.[^.]+$/, "")) + ".wav"
    );

    notify("Track WAV buufameera.");
  }

  bind("exportWavBtn", "click", exportMixToWav);
  bind("exportMixBtn", "click", exportMixToWav);
  bind("downloadMixBtn", "click", exportMixToWav);

  bind("exportBtn", "click", () => {
    const format = exportFormat
      ? exportFormat.value.toLowerCase()
      : "wav";

    if (format.includes("wav")) {
      exportMixToWav();
      return;
    }

    /*
     * Browser-native MediaRecorder usually exports WebM/Opus,
     * not MP3. Use WAV export when the requested format is WAV.
     */

    notify(
      "MP3 export native browser irratti hin mirkanoofne. WAV filadhu."
    );
  });

  /* =======================================================
     PROJECT SAVE
  ======================================================= */

  function saveProject() {
    const project = {
      app: "Naol Music Studio",
      version: 1,
      savedAt: new Date().toISOString(),

      master: {
        volume: getNumber("masterVolume", 0.8),
        pan: getNumber("panControl", 0),
        bass: getNumber("bassControl", 0),
        mid: getNumber("midControl", 0),
        treble: getNumber("trebleControl", 0),

        reverb: getNumber("reverbControl", 0),
        delay: getNumber("delayControl", 0),
        compressor: getNumber("compressorControl", 0.4),
        chorus: getNumber("chorusControl", 0),
        limiter: getNumber("limiterControl", 0.5),

        noiseGate: getNumber("noiseGateControl", 0),
        pitch: getNumber("pitchControl", 0),
        speed: getNumber("speedControl", 1),

        fadeIn: getNumber("fadeInControl", 0),
        fadeOut: getNumber("fadeOutControl", 0)
      },

      tracks: tracks.map((track) => ({
        id: track.id,
        name: track.name,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        duration: track.buffer.duration
      })),

      keyboardVolume,
      keyboardEvents: keyboardEvents.map((event) => ({
        ...event
      }))
    };

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    downloadBlob(blob, "naol-music-studio-project.json");

    notify(
      "Project settings fi keyboard notes save ta'eera. Audio files ofumaan project keessa hin dabalaman."
    );
  }

  bind("saveProjectBtn", "click", saveProject);
  bind("saveBtn", "click", saveProject);

  /* =======================================================
     PRESETS
  ======================================================= */

  function applyPreset(name) {
    const presets = {
      clean: {
        bass: 0,
        mid: 0,
        treble: 1,
        reverb: 0,
        delay: 0,
        compressor: 0.25,
        chorus: 0,
        limiter: 0.4
      },

      vocal: {
        bass: -1,
        mid: 2,
        treble: 2,
        reverb: 0.18,
        delay: 0.08,
        compressor: 0.55,
        chorus: 0,
        limiter: 0.6
      },

      bass: {
        bass: 4,
        mid: 0,
        treble: 1,
        reverb: 0.05,
        delay: 0,
        compressor: 0.4,
        chorus: 0,
        limiter: 0.7
      },

      ambient: {
        bass: 1,
        mid: 0,
        treble: 1,
        reverb: 0.55,
        delay: 0.35,
        compressor: 0.2,
        chorus: 0.25,
        limiter: 0.45
      },

      electronic: {
        bass: 2,
        mid: 0,
        treble: 2,
        reverb: 0.2,
        delay: 0.25,
        compressor: 0.55,
        chorus: 0.15,
        limiter: 0.7
      }
    };

    const preset = presets[name];

    if (!preset) {
      notify("Preset hin beekamne.");
      return;
    }

    const values = {
      bassControl: preset.bass,
      midControl: preset.mid,
      trebleControl: preset.treble,
      reverbControl: preset.reverb,
      delayControl: preset.delay,
      compressorControl: preset.compressor,
      chorusControl: preset.chorus,
      limiterControl: preset.limiter
    };

    Object.entries(values).forEach(([id, value]) => {
      const element = $(id);

      if (element) {
        element.value = String(value);
      }
    });

    updateMasterControls();
    updateEffectControls();

    notify("Preset " + name + " hojii irra oole.");
  }

  bind("presetClean", "click", () => applyPreset("clean"));
  bind("presetVocal", "click", () => applyPreset("vocal"));
  bind("presetBass", "click", () => applyPreset("bass"));
  bind("presetAmbient", "click", () => applyPreset("ambient"));
  bind("presetElectronic", "click", () => applyPreset("electronic"));

  bind("presetSelect", "change", (event) => {
    applyPreset(event.target.value);
  });

  /* =======================================================
     CONTROL LISTENERS
  ======================================================= */

  [
    "masterVolume",
    "panControl",
    "bassControl",
    "midControl",
    "trebleControl"
  ].forEach((id) => {
    bind(id, "input", updateMasterControls);
    bind(id, "change", updateMasterControls);
  });

  [
    "reverbControl",
    "delayControl",
    "compressorControl",
    "chorusControl",
    "limiterControl",
    "noiseGateControl"
  ].forEach((id) => {
    bind(id, "input", async () => {
      try {
        await ensureAudioContext();
        updateEffectControls();
      } catch (error) {
        console.error(error);
      }
    });
  });

  bind("speedControl", "input", () => {
    setText(
      "speedValue",
      getNumber("speedControl", 1).toFixed(2) + "x"
    );
  });

  bind("pitchControl", "input", () => {
    setText(
      "pitchValue",
      getNumber("pitchControl", 0).toFixed(1) + " semitones"
    );
  });

  bind("fadeInControl", "input", () => {
    setText(
      "fadeInValue",
      getNumber("fadeInControl", 0).toFixed(1) + " sec"
    );
  });

  bind("fadeOutControl", "input", () => {
    setText(
      "fadeOutValue",
      getNumber("fadeOutControl", 0).toFixed(1) + " sec"
    );
  });

  /* =======================================================
     LIVE LEVEL METER
  ======================================================= */

  function updateLevelMeter() {
    if (!masterAnalyser) {
      requestAnimationFrame(updateLevelMeter);
      return;
    }

    const data = new Uint8Array(
      masterAnalyser.frequencyBinCount
    );

    masterAnalyser.getByteTimeDomainData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128;
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / data.length);
    const level = clamp(rms * 220, 0, 100);

    const meter = $("levelMeter");

    if (meter) {
      meter.style.width = level + "%";
      meter.setAttribute("aria-valuenow", String(level));
    }

    const outputLevel = $("outputLevel");

    if (outputLevel) {
      outputLevel.textContent = Math.round(level) + "%";
    }

    requestAnimationFrame(updateLevelMeter);
  }

  /* =======================================================
     NAVIGATION
  ======================================================= */

  document.querySelectorAll("[data-section-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.sectionTarget;

      document.querySelectorAll("[data-section]").forEach((section) => {
        section.hidden =
          section.dataset.section !== target;
      });

      document.querySelectorAll("[data-section-target]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  });

  /* =======================================================
     KEYBOARD INITIALIZATION
  ======================================================= */

  bindVirtualKeyboard();

  /*
   * If keyboard keys are created dynamically later,
   * call bindVirtualKeyboard() again after creating them.
   */

  /* =======================================================
     INITIALIZATION
  ======================================================= */

  updateMasterControls();
  updateEffectControls();
  updateTransportDisplay();

  setText("speedValue", getNumber("speedControl", 1).toFixed(2) + "x");
  setText("pitchValue", getNumber("pitchControl", 0).toFixed(1) + " semitones");

  setStatus("Studio ready");

  updateLevelMeter();

  console.log(
    "Naol Music Studio initialized: tracks, keyboard, recording, Auto Mix and WAV export."
  );
});
