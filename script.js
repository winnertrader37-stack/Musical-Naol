"use strict";

/* =========================================================
   NAOL MUSIC STUDIO
   Audio engine, master controls, effects and auto mix
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

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

  let audioContext = null;

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

  let tracks = [];
  let nextTrackId = 1;
  let selectedTrackId = null;

  let mediaRecorder = null;
  let microphoneStream = null;
  let recordedChunks = [];

  let keyboardVolume = 0.3;
  let keyboardDestination = null;
  let keyboardActiveNotes = new Map();

  let keyboardRecording = false;
  let keyboardRecordingStart = 0;
  let keyboardEvents = [];
  let keyboardTimers = new Map();

  let renderInProgress = false;
  let toastTimer = null;

  const trackElements = new Map();

  /* -------------------------------------------------------
     HELPERS
  ------------------------------------------------------- */

  function notify(message) {
    if (!toast) {
      console.log(message);
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getNumber(id, fallback = 0) {
    const element = $(id);

    if (!element) return fallback;

    const number = Number(element.value);

    return Number.isFinite(number) ? number : fallback;
  }

  function safeDisconnect(node) {
    if (!node) return;

    try {
      node.disconnect();
    } catch (_) {
      // Node may already be disconnected.
    }
  }

  function bind(id, eventName, callback) {
    const element = $(id);

    if (element) {
      element.addEventListener(eventName, callback);
    }
  }

  function audioSupported() {
    if (!AudioContextClass) {
      notify("Browser audio engine hin deeggaru.");
      return false;
    }

    return true;
  }

  /* -------------------------------------------------------
     AUDIO CONTEXT
  ------------------------------------------------------- */

  async function ensureAudioContext() {
    if (!audioSupported()) {
      throw new Error("Web Audio API is unavailable.");
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();

      masterGain = audioContext.createGain();

      masterAnalyser = audioContext.createAnalyser();
      masterAnalyser.fftSize = 512;
      masterAnalyser.smoothingTimeConstant = 0.8;

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

      masterCompressor.threshold.value = -24;
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

      masterDelay = audioContext.createDelay(2);
      masterDelay.delayTime.value = 0.25;

      masterDelayFeedback = audioContext.createGain();
      masterDelayFeedback.gain.value = 0.2;

      masterDelayWet = audioContext.createGain();
      masterDelayWet.gain.value = 0;

      masterReverb = audioContext.createConvolver();

      masterReverb.buffer = createImpulseResponse(
        audioContext,
        2.5,
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
      chorusDepth.gain.value = 0.004;

      chorusWet = audioContext.createGain();
      chorusWet.gain.value = 0;

      chorusLFO.connect(chorusDepth);
      chorusDepth.connect(masterChorus.delayTime);
      chorusLFO.start();

      recordingDestination =
        audioContext.createMediaStreamDestination();

      /*
       * Main audio chain.
       * Effects use parallel wet paths.
       */

      masterLow.connect(masterMid);
      masterMid.connect(masterHigh);
      masterHigh.connect(masterPan);

      masterPan.connect(masterCompressor);
      masterCompressor.connect(masterLimiter);
      masterLimiter.connect(masterGain);

      masterGain.connect(masterAnalyser);
      masterAnalyser.connect(audioContext.destination);

      masterGain.connect(recordingDestination);

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
      keyboardDestination.connect(masterLow);

      updateMasterControls();
      updateEffectControls();
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

  /* -------------------------------------------------------
     MASTER CONTROLS
  ------------------------------------------------------- */

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

    const bass = getNumber("bassControl", 0);
    const mid = getNumber("midControl", 0);
    const treble = getNumber("trebleControl", 0);

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

  function panText(pan) {
    if (Math.abs(pan) < 0.01) {
      return "Center";
    }

    return pan < 0
      ? "Left " + Math.round(-pan * 100) + "%"
      : "Right " + Math.round(pan * 100) + "%";
  }

  /* -------------------------------------------------------
     EFFECT CONTROLS
  ------------------------------------------------------- */

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

    setText(
      "reverbValue",
      Math.round(reverb * 100) + "%"
    );

    setText(
      "delayValue",
      Math.round(delay * 100) + "%"
    );

    setText(
      "compressorValue",
      Math.round(compression * 100) + "%"
    );

    setText(
      "chorusValue",
      Math.round(chorus * 100) + "%"
    );

    setText(
      "limiterValue",
      Math.round(limiter * 100) + "%"
    );

    if (!audioContext) return;

    const now = audioContext.currentTime;

    masterReverbWet.gain.setTargetAtTime(
      reverb * 0.45,
      now,
      0.04
    );

    masterDelayWet.gain.setTargetAtTime(
      delay * 0.35,
      now,
      0.04
    );

    masterDelayFeedback.gain.setTargetAtTime(
      clamp(delay * 0.45, 0, 0.6),
      now,
      0.04
    );

    masterCompressor.threshold.setTargetAtTime(
      -8 - compression * 24,
      now,
      0.04
    );

    masterCompressor.ratio.setTargetAtTime(
      1 + compression * 9,
      now,
      0.04
    );

    masterLimiter.threshold.setTargetAtTime(
      -1 - limiter * 8,
      now,
      0.04
    );

    masterLimiter.ratio.setTargetAtTime(
      4 + limiter * 16,
      now,
      0.04
    );

    chorusWet.gain.setTargetAtTime(
      chorus * 0.3,
      now,
      0.04
    );
  }

  /* -------------------------------------------------------
     AUTO MIX
  ------------------------------------------------------- */

  async function autoMix() {
    if (tracks.length === 0) {
      notify("Auto Mix dura audio tokko upload godhi.");
      return;
    }

    await ensureAudioContext();

    /*
     * Analyse audio loudness using RMS.
     * This sets a safe initial mix level.
     */

    let totalRms = 0;
    let count = 0;

    for (const track of tracks) {
      if (track.muted) continue;

      const buffer = track.buffer;
      const sampleStep = Math.max(
        1,
        Math.floor(buffer.length / 50000)
      );

      let sum = 0;
      let samples = 0;

      for (
        let channel = 0;
        channel < buffer.numberOfChannels;
        channel++
      ) {
        const data = buffer.getChannelData(channel);

        for (
          let i = 0;
          i < data.length;
          i += sampleStep
        ) {
          sum += data[i] * data[i];
          samples++;
        }
      }

      const rms = samples
        ? Math.sqrt(sum / samples)
        : 0;

      track.rms = rms;

      totalRms += rms;
      count++;
    }

    const averageRms = count
      ? totalRms / count
      : 0;

    tracks.forEach((track) => {
      if (!track.rms || track.muted) return;

      const correction = averageRms > 0
        ? averageRms / track.rms
        : 1;

      track.volume = clamp(
        track.volume * correction,
        0.1,
        1
      );
    });

    /*
     * Conservative mastering starting point.
     * The user can adjust these controls afterward.
     */

    if (bassControl) bassControl.value = "1";
    if (midControl) midControl.value = "0";
    if (trebleControl) trebleControl.value = "1";

    if (compressorControl) {
      compressorControl.value = "0.35";
    }

    if (limiterControl) {
      limiterControl.value = "0.65";
    }

    if (masterVolume) {
      masterVolume.value = "0.8";
    }

    updateMasterControls();
    updateEffectControls();

    renderTracks();

    notify("Auto Mix xumurameera. Dhaggeeffadhu, yoo barbaachise sirreessi.");
    setStatus("Auto Mix complete");
  }

  /*
   * Connect the Auto Mix button if it exists.
   * This avoids a script crash when a button is absent.
   */

  bind("autoMixBtn", "click", () => {
    autoMix().catch((error) => {
      console.error(error);
      notify("Auto Mix hojjechuu hin dandeenye.");
    });
  });

  /* -------------------------------------------------------
     INITIAL ENGINE SETUP
  ------------------------------------------------------- */

  updateMasterControls();

  updateEffectControls();

  setStatus("Studio ready");

  console.log("Naol Music Studio audio engine initialized.");

  /*
   * Remaining modules:
   * - Track upload and waveform UI
   * - Playback and seeking
   * - Microphone recording
   * - Virtual keyboard and keyboard recording
   * - WAV export and project save
   *
   * Continue with Part 2 before using this as the final
   * replacement file.
   */
});
