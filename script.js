"use strict";

/* =========================================================
   NAOL MUSIC STUDIO
   Complete browser-based audio workstation.

   Features:
   - Multiple audio file uploads
   - Multitrack playback
   - Play, pause, stop and seek
   - Track volume, pan, mute, solo and remove
   - Master volume and stereo pan
   - Bass, mid and treble EQ
   - Reverb, delay, compressor, limiter and chorus
   - Basic noise gate
   - Microphone recording
   - Virtual piano keyboard
   - Keyboard performance recording
   - Vocal presets
   - Automatic mix balancing
   - WAV export
   - WebM recording export
   - Project settings download
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  /* =========================================================
     DOM ELEMENTS
     ========================================================= */

  const appStatus = $("appStatus");
  const toast = $("toast");

  const uploadInput = $("audioUpload");
  const addTrackBtn = $("addTrackBtn");
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

  const saveProjectBtn = $("saveProjectBtn");
  const exportBtn = $("exportBtn");
  const masterExportBtn = $("masterExportBtn");

  const resetEffectsBtn = $("resetEffectsBtn");
  const vocalPreset = $("vocalPreset");
  const applyPresetBtn = $("applyPresetBtn");

  const keyboardVolume = $("keyboardVolume");
  const pianoKeyboard = $("pianoKeyboard");
  const recordKeyboardBtn = $("recordKeyboardBtn");

  const masterMeter = $("masterMeter");

  /* =========================================================
     APPLICATION STATE
     ========================================================= */

  let audioContext = null;
  let audioGraph = null;

  let tracks = [];
  let nextTrackId = 1;

  let isPlaying = false;
  let playbackStartTime = 0;
  let playbackStartOffset = 0;
  let pausedAt = 0;
  let playbackTimer = null;

  let microphoneStream = null;
  let microphoneSource = null;
  let microphoneTrackGain = null;
  let microphoneRecorder = null;
  let microphoneChunks = [];
  let isRecordingMicrophone = false;

  let keyboardRecording = false;
  let keyboardEvents = [];
  let keyboardRecordingStart = 0;
  let keyboardActiveNotes = new Map();
  let keyboardVoices = new Set();

  let toastTimer = null;
  let meterAnimationFrame = null;

  const MASTER_VOLUME_DEFAULT = 0.8;

  /* =========================================================
     GENERAL HELPERS
     ========================================================= */

  function setStatus(message) {
    if (appStatus) {
      appStatus.textContent = message;
    }
  }

  function showToast(message, duration = 3500) {
    if (!toast) {
      console.log(message);
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      seconds = 0;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(remainingSeconds).padStart(2, "0")
    );
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function readControl(element, fallback = 0) {
    if (!element) {
      return fallback;
    }

    const value = Number(element.value);

    return Number.isFinite(value) ? value : fallback;
  }

  function safeFilename(name) {
    return String(name || "naol-mix")
      .replace(/\.[^.]+$/, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim() || "naol-mix";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function getSupportedAudioFile(file) {
    if (!file) {
      return false;
    }

    const supportedExtensions =
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

    const supportedMime =
      /^audio\//i.test(file.type || "");

    return supportedMime || supportedExtensions.test(file.name || "");
  }

  function getTrackDuration() {
    return tracks.reduce((maximum, track) => {
      if (track.removed || !track.buffer) {
        return maximum;
      }

      const speed = Math.max(0.1, track.speed || 1);
      const duration = track.buffer.duration / speed;

      return Math.max(maximum, duration);
    }, 0);
  }

  function getCurrentPosition() {
    if (isPlaying && audioContext) {
      return clamp(
        playbackStartOffset +
          (audioContext.currentTime - playbackStartTime),
        0,
        getTrackDuration()
      );
    }

    return clamp(pausedAt, 0, getTrackDuration());
  }

  /* =========================================================
     AUDIO CONTEXT
     ========================================================= */

  async function ensureAudioContext() {
    if (!AudioContextClass) {
      throw new Error(
        "This browser does not support the Web Audio API. Try an updated Chrome browser."
      );
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();

      createAudioGraph();

      startMeter();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext;
  }

  /* =========================================================
     AUDIO GRAPH
     ========================================================= */

  function createAudioGraph() {
    if (!audioContext) {
      return;
    }

    const ctx = audioContext;

    const masterInput = ctx.createGain();
    const masterGain = ctx.createGain();

    const bassFilter = ctx.createBiquadFilter();
    const midFilter = ctx.createBiquadFilter();
    const trebleFilter = ctx.createBiquadFilter();

    const masterPanner = ctx.createStereoPanner();

    const compressor = ctx.createDynamicsCompressor();
    const limiter = ctx.createDynamicsCompressor();

    const analyser = ctx.createAnalyser();

    const recordingDestination = ctx.createMediaStreamDestination();

    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 180;

    midFilter.type = "peaking";
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.8;

    trebleFilter.type = "highshelf";
    trebleFilter.frequency.value = 5000;

    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    masterGain.gain.value = MASTER_VOLUME_DEFAULT;

    /*
     * Main chain:
     * Tracks -> Master Input -> EQ -> Compressor
     * -> Limiter -> Master Gain -> Pan -> Output
     */

    masterInput.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(masterGain);
    masterGain.connect(masterPanner);

    masterPanner.connect(analyser);
    analyser.connect(ctx.destination);

    /*
     * Record the processed master mix.
     */

    masterPanner.connect(recordingDestination);

    audioGraph = {
      masterInput,
      masterGain,
      bassFilter,
      midFilter,
      trebleFilter,
      masterPanner,
      compressor,
      limiter,
      analyser,
      recordingDestination
    };

    updateMasterControls();
    updateEffects();
  }

  /* =========================================================
     MASTER CONTROLS
     ========================================================= */

  function updateMasterControls() {
    if (!audioGraph || !audioContext) {
      return;
    }

    const ctx = audioContext;
    const graph = audioGraph;

    const volume = clamp(
      readControl(masterVolume, MASTER_VOLUME_DEFAULT),
      0,
      1
    );

    const pan = clamp(
      readControl(panControl, 0),
      -1,
      1
    );

    graph.masterGain.gain.setTargetAtTime(
      volume,
      ctx.currentTime,
      0.015
    );

    graph.masterPanner.pan.setTargetAtTime(
      pan,
      ctx.currentTime,
      0.015
    );

    graph.bassFilter.gain.setTargetAtTime(
      readControl(bassControl, 0),
      ctx.currentTime,
      0.015
    );

    graph.midFilter.gain.setTargetAtTime(
      readControl(midControl, 0),
      ctx.currentTime,
      0.015
    );

    graph.trebleFilter.gain.setTargetAtTime(
      readControl(trebleControl, 0),
      ctx.currentTime,
      0.015
    );

    updateControlLabels();
  }

  function updateControlLabels() {
    const masterVolumeValue = $("masterVolumeValue");
    const panValue = $("panValue");

    if (masterVolumeValue) {
      masterVolumeValue.textContent =
        Math.round(readControl(masterVolume, 0.8) * 100) + "%";
    }

    if (panValue) {
      const pan = readControl(panControl, 0);

      if (Math.abs(pan) < 0.03) {
        panValue.textContent = "Center";
      } else if (pan < 0) {
        panValue.textContent =
          "Left " + Math.round(Math.abs(pan) * 100) + "%";
      } else {
        panValue.textContent =
          "Right " + Math.round(pan * 100) + "%";
      }
    }

    const values = [
      ["bassValue", bassControl, " dB"],
      ["midValue", midControl, " dB"],
      ["trebleValue", trebleControl, " dB"]
    ];

    values.forEach(([id, control, suffix]) => {
      const element = $(id);

      if (element) {
        const value = readControl(control, 0);

        element.textContent =
          (value > 0 ? "+" : "") + value + suffix;
      }
    });

    const percentageControls = [
      ["reverbValue", reverbControl],
      ["delayValue", delayControl],
      ["compressorValue", compressorControl],
      ["chorusValue", chorusControl],
      ["limiterValue", limiterControl]
    ];

    percentageControls.forEach(([id, control]) => {
      const element = $(id);

      if (element) {
        element.textContent =
          Math.round(readControl(control, 0) * 100) + "%";
      }
    });

    const gateValue = $("noiseGateValue");

    if (gateValue) {
      const threshold = readControl(noiseGateControl, 0);

      gateValue.textContent =
        threshold <= 0 ? "Off" : threshold.toFixed(3);
    }

    const pitchValue = $("pitchValue");

    if (pitchValue) {
      pitchValue.textContent =
        readControl(pitchControl, 0) + " semitones";
    }

    const speedValue = $("speedValue");

    if (speedValue) {
      speedValue.textContent =
        readControl(speedControl, 1).toFixed(2) + "x";
    }

    const fadeInValue = $("fadeInValue");

    if (fadeInValue) {
      fadeInValue.textContent =
        readControl(fadeInControl, 0) + " sec";
    }

    const fadeOutValue = $("fadeOutValue");

    if (fadeOutValue) {
      fadeOutValue.textContent =
        readControl(fadeOutControl, 0) + " sec";
    }
  }

  /* =========================================================
     EFFECT PROCESSING
     ========================================================= */

  function makeImpulseResponse(ctx, duration = 2.0) {
    const sampleRate = ctx.sampleRate;

    const length = Math.max(
      1,
      Math.floor(sampleRate * duration)
    );

    const impulse = ctx.createBuffer(
      2,
      length,
      sampleRate
    );

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2.5);

        data[i] =
          (Math.random() * 2 - 1) * decay;
      }
    }

    return impulse;
  }

  function createEffectNodes(ctx) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();

    const convolver = ctx.createConvolver();
    const delay = ctx.createDelay(2.0);
    const delayFeedback = ctx.createGain();

    const chorusDelay = ctx.createDelay(0.1);
    const chorusOscillator = ctx.createOscillator();
    const chorusDepth = ctx.createGain();
    const chorusWet = ctx.createGain();

    const gate = ctx.createDynamicsCompressor();

    convolver.buffer = makeImpulseResponse(ctx, 2.0);

    delay.delayTime.value = 0.28;
    delayFeedback.gain.value = 0.2;

    chorusDelay.delayTime.value = 0.025;
    chorusOscillator.frequency.value = 0.35;
    chorusDepth.gain.value = 0.003;

    gate.threshold.value = -70;
    gate.knee.value = 0;
    gate.ratio.value = 8;
    gate.attack.value = 0.003;
    gate.release.value = 0.08;

    dry.gain.value = 1;
    wet.gain.value = 0;
    chorusWet.gain.value = 0;

    /*
     * Parallel reverb and delay.
     */

    dry.connect(gate);

    gate.connect(ctx.destination);

    dry.connect(convolver);
    convolver.connect(wet);

    wet.connect(ctx.destination);

    dry.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);

    delay.connect(wet);

    /*
     * Chorus modulation.
     */

    dry.connect(chorusDelay);
    chorusDelay.connect(chorusWet);
    chorusWet.connect(ctx.destination);

    chorusOscillator.connect(chorusDepth);
    chorusDepth.connect(chorusDelay.delayTime);

    chorusOscillator.start();

    return {
      dry,
      wet,
      convolver,
      delay,
      delayFeedback,
      chorusDelay,
      chorusOscillator,
      chorusDepth,
      chorusWet,
      gate
    };
  }

  /*
   * The main effects graph uses a dedicated parallel routing
   * section. The track graph itself always remains connected
   * directly to the master input.
   */

  let effectsGraph = null;

  function setupEffectsGraph() {
    if (!audioContext || !audioGraph || effectsGraph) {
      return;
    }

    const ctx = audioContext;

    const input = ctx.createGain();
    const dry = ctx.createGain();

    const reverb = ctx.createConvolver();
    const reverbGain = ctx.createGain();

    const delay = ctx.createDelay(2.0);
    const delayFeedback = ctx.createGain();
    const delayGain = ctx.createGain();

    const chorusDelay = ctx.createDelay(0.1);
    const chorusGain = ctx.createGain();
    const chorusOscillator = ctx.createOscillator();
    const chorusDepth = ctx.createGain();

    const noiseGate = ctx.createDynamicsCompressor();

    reverb.buffer = makeImpulseResponse(ctx, 2.2);

    delay.delayTime.value = 0.25;
    delayFeedback.gain.value = 0.25;

    chorusDelay.delayTime.value = 0.025;
    chorusOscillator.frequency.value = 0.35;
    chorusDepth.gain.value = 0.002;

    noiseGate.threshold.value = -70;
    noiseGate.knee.value = 0;
    noiseGate.ratio.value = 8;
    noiseGate.attack.value = 0.003;
    noiseGate.release.value = 0.08;

    dry.gain.value = 1;

    /*
     * Effects are processed in parallel to preserve the dry
     * signal and avoid feeding the master output back into itself.
     */

    input.connect(dry);
    dry.connect(noiseGate);
    noiseGate.connect(audioGraph.masterInput);

    input.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(audioGraph.masterInput);

    input.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(audioGraph.masterInput);

    input.connect(chorusDelay);
    chorusDelay.connect(chorusGain);
    chorusGain.connect(audioGraph.masterInput);

    chorusOscillator.connect(chorusDepth);
    chorusDepth.connect(chorusDelay.delayTime);

    chorusOscillator.start();

    effectsGraph = {
      input,
      dry,
      reverb,
      reverbGain,
      delay,
      delayFeedback,
      delayGain,
      chorusDelay,
      chorusGain,
      chorusOscillator,
      chorusDepth,
      noiseGate
    };

    updateEffects();
  }

  function updateEffects() {
    if (!audioContext) {
      return;
    }

    /*
     * Ensure the graph exists after the first audio interaction.
     */

    if (!effectsGraph && audioGraph) {
      setupEffectsGraph();
    }

    if (!effectsGraph) {
      updateControlLabels();
      return;
    }

    const ctx = audioContext;
    const fx = effectsGraph;

    const reverbAmount = clamp(
      readControl(reverbControl, 0),
      0,
      1
    );

    const delayAmount = clamp(
      readControl(delayControl, 0),
      0,
      0.8
    );

    const compressionAmount = clamp(
      readControl(compressorControl, 0.25),
      0,
      1
    );

    const chorusAmount = clamp(
      readControl(chorusControl, 0),
      0,
      1
    );

    const limiterAmount = clamp(
      readControl(limiterControl, 0.5),
      0,
      1
    );

    const gateThreshold = clamp(
      readControl(noiseGateControl, 0),
      0,
      0.1
    );

    fx.dry.gain.setTargetAtTime(
      1 - reverbAmount * 0.15,
      ctx.currentTime,
      0.02
    );

    fx.reverbGain.gain.setTargetAtTime(
      reverbAmount * 0.45,
      ctx.currentTime,
      0.02
    );

    fx.delayGain.gain.setTargetAtTime(
      delayAmount * 0.45,
      ctx.currentTime,
      0.02
    );

    fx.delayFeedback.gain.setTargetAtTime(
      clamp(delayAmount * 0.45, 0, 0.38),
      ctx.currentTime,
      0.02
    );

    fx.chorusGain.gain.setTargetAtTime(
      chorusAmount * 0.45,
      ctx.currentTime,
      0.02
    );

    fx.chorusDepth.gain.setTargetAtTime(
      chorusAmount * 0.004,
      ctx.currentTime,
      0.02
    );

    fx.noiseGate.threshold.value =
      gateThreshold > 0
        ? 20 * Math.log10(gateThreshold)
        : -70;

    /*
     * Update the master compressor and limiter.
     */

    if (audioGraph.compressor) {
      audioGraph.compressor.threshold.value =
        -12 - compressionAmount * 18;

      audioGraph.compressor.ratio.value =
        1 + compressionAmount * 7;
    }

    if (audioGraph.limiter) {
      audioGraph.limiter.threshold.value =
        -1 - limiterAmount * 8;

      audioGraph.limiter.ratio.value =
        4 + limiterAmount * 16;
    }

    updateControlLabels();
  }

  /* =========================================================
     AUDIO UPLOAD
     ========================================================= */

  async function handleUpload(event) {
    const files = Array.from(
      event.target.files || []
    );

    /*
     * Reset the input so selecting the same file again works.
     */

    event.target.value = "";

    if (!files.length) {
      return;
    }

    const acceptedFiles = files.filter(
      getSupportedAudioFile
    );

    const rejectedCount =
      files.length - acceptedFiles.length;

    if (!acceptedFiles.length) {
      showToast(
        "No supported audio files found. Select MP3, WAV, OGG or another browser-supported audio file."
      );

      return;
    }

    try {
      await ensureAudioContext();
      setupEffectsGraph();

      setStatus("Loading audio files...");

      let successful = 0;

      for (const file of acceptedFiles) {
        try {
          if (file.size === 0) {
            throw new Error("The file is empty.");
          }

          const arrayBuffer = await file.arrayBuffer();

          const decodedBuffer =
            await audioContext.decodeAudioData(
              arrayBuffer.slice(0)
            );

          if (!decodedBuffer || decodedBuffer.length === 0) {
            throw new Error("The audio file contains no playable audio.");
          }

          const track = {
            id: nextTrackId++,
            name: file.name,
            originalFileName: file.name,
            size: file.size,
            buffer: decodedBuffer,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false,
            removed: false,
            speed: clamp(
              readControl(speedControl, 1),
              0.5,
              1.5
            ),
            pitch: readControl(pitchControl, 0),
            fadeIn: readControl(fadeInControl, 0),
            fadeOut: readControl(fadeOutControl, 0),
            source: null,
            gainNode: null,
            pannerNode: null,
            startedAt: 0,
            startOffset: 0
          };

          tracks.push(track);

          renderTracks();

          successful++;

        } catch (error) {
          console.error(
            "Audio upload failed:",
            file.name,
            error
          );

          showToast(
            "Could not open " +
              file.name +
              ". Try converting it to MP3 or WAV.",
            5000
          );
        }
      }

      if (successful > 0) {
        setStatus(
          successful +
            " audio file(s) loaded successfully."
        );

        showToast(
          successful +
            " audio file(s) added to your studio."
        );

        renderTracks();
        updateTransportDisplay();

      } else {
        setStatus("Audio upload failed.");

        showToast(
          "No files could be decoded. Try another audio format.",
          5000
        );
      }

      if (rejectedCount > 0) {
        showToast(
          rejectedCount +
            " unsupported file(s) were skipped."
        );
      }

    } catch (error) {
      console.error("Upload error:", error);

      setStatus("Could not load audio.");

      showToast(
        error.message ||
          "Audio upload failed. Please try again.",
        5000
      );
    }
  }

  if (uploadInput) {
    uploadInput.addEventListener(
      "change",
      handleUpload
    );
  }

  if (addTrackBtn && uploadInput) {
    addTrackBtn.addEventListener("click", () => {
      uploadInput.click();
    });
  }

  /* =========================================================
     TRACK MANAGEMENT
     ========================================================= */

  function createTrackElement(track) {
    const card = document.createElement("article");

    card.className = "track-card";
    card.dataset.trackId = String(track.id);

    const header = document.createElement("div");
    header.className = "track-header";

    const title = document.createElement("strong");
    title.className = "track-name";
    title.textContent = track.name;

    const duration = document.createElement("span");
    duration.className = "track-duration";
    duration.textContent = formatTime(
      track.buffer.duration
    );

    header.append(title, duration);

    const waveform = document.createElement("div");
    waveform.className = "track-waveform";

    const barCount = 48;

    const channelData =
      track.buffer.getChannelData(0);

    const blockSize = Math.max(
      1,
      Math.floor(channelData.length / barCount)
    );

    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement("span");

      bar.className = "waveform-bar";

      const start = i * blockSize;
      const end = Math.min(
        channelData.length,
        start + blockSize
      );

      let peak = 0;

      for (let j = start; j < end; j += 4) {
        peak = Math.max(
          peak,
          Math.abs(channelData[j] || 0)
        );
      }

      const height = Math.max(
        8,
        Math.min(100, peak * 100)
      );

      bar.style.height = height + "%";

      waveform.appendChild(bar);
    }

    const buttons = document.createElement("div");
    buttons.className = "track-buttons";

    const muteButton = createButton(
      track.muted ? "Unmute" : "Mute",
      "btn secondary track-mute"
    );

    const soloButton = createButton(
      track.solo ? "Unsolo" : "Solo",
      "btn secondary track-solo"
    );

    const removeButton = createButton(
      "Remove",
      "btn secondary track-remove"
    );

    muteButton.addEventListener("click", () => {
      track.muted = !track.muted;

      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          getEffectiveTrackVolume(track),
          audioContext.currentTime,
          0.02
        );
      }

      renderTracks();
    });

    soloButton.addEventListener("click", () => {
      track.solo = !track.solo;

      tracks.forEach((item) => {
        if (item.gainNode && audioContext) {
          item.gainNode.gain.setTargetAtTime(
            getEffectiveTrackVolume(item),
            audioContext.currentTime,
            0.02
          );
        }
      });

      renderTracks();
    });

    removeButton.addEventListener("click", () => {
      removeTrack(track.id);
    });

    buttons.append(
      muteButton,
      soloButton,
      removeButton
    );

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const volumeLabel = document.createElement("label");
    volumeLabel.textContent = "Volume";

    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.min = "0";
    volumeSlider.max = "1";
    volumeSlider.step = "0.01";
    volumeSlider.value = String(track.volume);

    volumeSlider.setAttribute(
      "aria-label",
      "Track volume"
    );

    const volumeText = document.createElement("span");
    volumeText.textContent =
      Math.round(track.volume * 100) + "%";

    volumeSlider.addEventListener("input", () => {
      track.volume = Number(volumeSlider.value);

      volumeText.textContent =
        Math.round(track.volume * 100) + "%";

      if (track.gainNode && audioContext) {
        track.gainNode.gain.setTargetAtTime(
          getEffectiveTrackVolume(track),
          audioContext.currentTime,
          0.015
        );
      }
    });

    const panLabel = document.createElement("label");
    panLabel.textContent = "Pan";

    const panSlider = document.createElement("input");
    panSlider.type = "range";
    panSlider.min = "-1";
    panSlider.max = "1";
    panSlider.step = "0.01";
    panSlider.value = String(track.pan);

    panSlider.setAttribute(
      "aria-label",
      "Track stereo pan"
    );

    const panText = document.createElement("span");
    panText.textContent =
      track.pan === 0
        ? "Center"
        : track.pan < 0
          ? "Left"
          : "Right";

    panSlider.addEventListener("input", () => {
      track.pan = Number(panSlider.value);

      panText.textContent =
        Math.abs(track.pan) < 0.03
          ? "Center"
          : track.pan < 0
            ? "Left"
            : "Right";

      if (track.pannerNode && audioContext) {
        track.pannerNode.pan.setTargetAtTime(
          track.pan,
          audioContext.currentTime,
          0.015
        );
      }
    });

    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Speed";

    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "0.5";
    speedSlider.max = "1.5";
    speedSlider.step = "0.05";
    speedSlider.value = String(track.speed);

    speedSlider.setAttribute(
      "aria-label",
      "Track playback speed"
    );

    const speedText = document.createElement("span");
    speedText.textContent =
      track.speed.toFixed(2) + "x";

    speedSlider.addEventListener("change", () => {
      track.speed = Number(speedSlider.value);

      speedText.textContent =
        track.speed.toFixed(2) + "x";

      /*
       * Restart playback at the current position so the
       * updated playback rate takes effect.
       */

      if (isPlaying) {
        restartPlaybackAtCurrentPosition();
      }
    });

    controls.append(
      volumeLabel,
      volumeSlider,
      volumeText,
      panLabel,
      panSlider,
      panText,
      speedLabel,
      speedSlider,
      speedText
    );

    card.append(
      header,
      waveform,
      buttons,
      controls
    );

    return card;
  }

  function createButton(text, className) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = text;
    button.className = className;

    return button;
  }

  function renderTracks() {
    if (!trackList) {
      return;
    }

    trackList.innerHTML = "";

    const activeTracks = tracks.filter(
      (track) => !track.removed
    );

    if (activeTracks.length === 0) {
      const empty = document.createElement("div");

      empty.className = "empty-state";
      empty.id = "emptyTracks";

      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.textContent = "♫";

      const heading = document.createElement("h3");
      heading.textContent = "Your studio is ready";

      const paragraph = document.createElement("p");
      paragraph.textContent =
        "Upload an audio file to begin editing and mixing.";

      empty.append(icon, heading, paragraph);

      trackList.appendChild(empty);

      return;
    }

    activeTracks.forEach((track) => {
      trackList.appendChild(
        createTrackElement(track)
      );
    });
  }

  function getEffectiveTrackVolume(track) {
    const anySolo = tracks.some(
      (item) => !item.removed && item.solo
    );

    if (track.muted) {
      return 0;
    }

    if (anySolo && !track.solo) {
      return 0;
    }

    return clamp(track.volume, 0, 1);
  }

  function removeTrack(trackId) {
    const track = tracks.find(
      (item) => item.id === trackId
    );

    if (!track) {
      return;
    }

    const wasPlaying = isPlaying;
    const position = getCurrentPosition();

    stopTrackSource(track);

    track.removed = true;

    tracks = tracks.filter(
      (item) => item.id !== trackId
    );

    if (wasPlaying) {
      startPlayback(position);
    }

    renderTracks();
    updateTransportDisplay();

    showToast("Track removed.");
  }

  /* =========================================================
     PLAYBACK ENGINE
     ========================================================= */

  function stopTrackSource(track) {
    if (!track || !track.source) {
      return;
    }

    try {
      track.source.onended = null;
      track.source.stop();
    } catch (_) {
      // The source may already have stopped.
    }

    try {
      track.source.disconnect();
    } catch (_) {}

    try {
      if (track.gainNode) {
        track.gainNode.disconnect();
      }
    } catch (_) {}

    try {
      if (track.pannerNode) {
        track.pannerNode.disconnect();
      }
    } catch (_) {}

    track.source = null;
    track.gainNode = null;
    track.pannerNode = null;
  }

  function applyTrackFade(track, gainNode, startTime, offset, duration) {
    const fadeIn = clamp(
      track.fadeIn || readControl(fadeInControl, 0),
      0,
      10
    );

    const fadeOut = clamp(
      track.fadeOut || readControl(fadeOutControl, 0),
      0,
      10
    );

    const effectiveVolume =
      getEffectiveTrackVolume(track);

    const endTime =
      startTime + Math.max(0, duration);

    gainNode.gain.cancelScheduledValues(startTime);

    if (fadeIn > 0 && offset < fadeIn) {
      gainNode.gain.setValueAtTime(
        0,
        startTime
      );

      gainNode.gain.linearRampToValueAtTime(
        effectiveVolume,
        Math.min(
          endTime,
          startTime + fadeIn - offset
        )
      );

    } else {
      gainNode.gain.setValueAtTime(
        effectiveVolume,
        startTime
      );
    }

    if (fadeOut > 0 && duration > fadeOut) {
      const fadeStart = endTime - fadeOut;

      gainNode.gain.setValueAtTime(
        effectiveVolume,
        Math.max(startTime, fadeStart)
      );

      gainNode.gain.linearRampToValueAtTime(
        0,
        endTime
      );
    }
  }

  function startTrackSource(track, position) {
    if (!audioContext || !audioGraph || !track.buffer) {
      return;
    }

    const speed = clamp(track.speed || 1, 0.5, 1.5);

    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    const pannerNode = audioContext.createStereoPanner();

    source.buffer = track.buffer;
    source.playbackRate.value = speed;

    /*
     * Playback rate changes speed and pitch together.
     * Independent pitch correction is not implemented here.
     */

    source.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(audioGraph.masterInput);

    pannerNode.pan.value = track.pan;

    const durationRemaining =
      (track.buffer.duration - position) / speed;

    if (durationRemaining <= 0) {
      return;
    }

    const startTime = audioContext.currentTime + 0.02;

    applyTrackFade(
      track,
      gainNode,
      startTime,
      position,
      durationRemaining
    );

    track.source = source;
    track.gainNode = gainNode;
    track.pannerNode = pannerNode;
    track.startedAt = startTime;
    track.startOffset = position;

    source.onended = () => {
      if (track.source === source) {
        track.source = null;
      }
    };

    source.start(
      startTime,
      clamp(position, 0, track.buffer.duration)
    );
  }

  async function startPlayback(position = 0) {
    const activeTracks = tracks.filter(
      (track) => !track.removed && track.buffer
    );

    if (activeTracks.length === 0) {
      showToast("Upload an audio file before pressing Play.");
      return;
    }

    try {
      await ensureAudioContext();
      setupEffectsGraph();

      stopAllSources();

      const totalDuration = getTrackDuration();

      position = clamp(position, 0, totalDuration);

      if (position >= totalDuration) {
        position = 0;
      }

      playbackStartOffset = position;
      pausedAt = position;
      playbackStartTime = audioContext.currentTime + 0.02;

      activeTracks.forEach((track) => {
        if (position < track.buffer.duration / track.speed) {
          startTrackSource(track, position * track.speed);
        }
      });

      /*
       * Keyboard events are replayed when playback begins.
       */

      scheduleKeyboardEvents(position);

      isPlaying = true;

      setStatus("Playing audio...");

      updateTransportDisplay();
      startPlaybackTimer();

    } catch (error) {
      console.error("Playback failed:", error);

      showToast(
        error.message || "Could not start audio playback.",
        5000
      );
    }
  }

  function stopAllSources() {
    tracks.forEach(stopTrackSource);
  }

  function pausePlayback() {
    if (!isPlaying) {
      return;
    }

    pausedAt = getCurrentPosition();

    isPlaying = false;

    stopAllSources();
    stopKeyboardVoices();

    clearInterval(playbackTimer);

    setStatus("Playback paused.");

    updateTransportDisplay();
  }

  function stopPlayback() {
    isPlaying = false;

    pausedAt = 0;
    playbackStartOffset = 0;

    stopAllSources();
    stopKeyboardVoices();

    clearInterval(playbackTimer);

    setStatus("Playback stopped.");

    updateTransportDisplay();
  }

  function restartPlaybackAtCurrentPosition() {
    const position = getCurrentPosition();

    if (isPlaying) {
      startPlayback(position);
    }
  }

  function startPlaybackTimer() {
    clearInterval(playbackTimer);

    playbackTimer = setInterval(() => {
      if (!isPlaying) {
        return;
      }

      updateTransportDisplay();

      if (getCurrentPosition() >= getTrackDuration()) {
        stopPlayback();
        setStatus("Playback finished.");
      }
    }, 100);
  }

  function updateTransportDisplay() {
    const position = getCurrentPosition();
    const duration = getTrackDuration();

    if (currentTime) {
      currentTime.textContent = formatTime(position);
    }

    if (durationDisplay) {
      durationDisplay.textContent = formatTime(duration);
    }

    if (seekBar) {
      seekBar.value =
        duration > 0
          ? String((position / duration) * 100)
          : "0";
    }

    if (currentTrackName) {
      const activeTracks = tracks.filter(
        (track) => !track.removed
      );

      if (activeTracks.length === 0) {
        currentTrackName.textContent = "No audio selected";
      } else if (activeTracks.length === 1) {
        currentTrackName.textContent =
          activeTracks[0].name;
      } else {
        currentTrackName.textContent =
          activeTracks.length + " tracks in mix";
      }
    }
  }

  if (playBtn) {
    playBtn.addEventListener("click", async () => {
      if (isPlaying) {
        return;
      }

      await startPlayback(getCurrentPosition());
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener(
      "click",
      pausePlayback
    );
  }

  if (stopBtn) {
    stopBtn.addEventListener(
      "click",
      stopPlayback
    );
  }

  if (seekBar) {
    seekBar.addEventListener("input", () => {
      const duration = getTrackDuration();

      const target =
        (Number(seekBar.value) / 100) * duration;

      if (currentTime) {
        currentTime.textContent = formatTime(target);
      }
    });

    seekBar.addEventListener("change", () => {
      const duration = getTrackDuration();

      const target =
        (Number(seekBar.value) / 100) * duration;

      if (isPlaying) {
        startPlayback(target);
      } else {
        pausedAt = target;
        updateTransportDisplay();
      }
    });
  }

  /* =========================================================
     MASTER VOLUME AND EFFECT LISTENERS
     ========================================================= */

  [
    masterVolume,
    panControl,
    bassControl,
    midControl,
    trebleControl
  ].forEach((control) => {
    if (!control) {
      return;
    }

    control.addEventListener("input", () => {
      updateMasterControls();
    });
  });

  [
    reverbControl,
    delayControl,
    compressorControl,
    noiseGateControl,
    chorusControl,
    limiterControl
  ].forEach((control) => {
    if (!control) {
      return;
    }

    control.addEventListener("input", () => {
      updateEffects();
    });
  });

  [
    pitchControl,
    speedControl,
    fadeInControl,
    fadeOutControl
  ].forEach((control) => {
    if (!control) {
      return;
    }

    control.addEventListener("input", () => {
      updateControlLabels();
    });
  });

  /* =========================================================
     RESET EFFECTS
     ========================================================= */

  if (resetEffectsBtn) {
    resetEffectsBtn.addEventListener("click", () => {
      if (reverbControl) reverbControl.value = "0";
      if (delayControl) delayControl.value = "0";
      if (compressorControl) compressorControl.value = "0.25";
      if (noiseGateControl) noiseGateControl.value = "0";
      if (chorusControl) chorusControl.value = "0";
      if (limiterControl) limiterControl.value = "0.5";

      if (bassControl) bassControl.value = "0";
      if (midControl) midControl.value = "0";
      if (trebleControl) trebleControl.value = "0";

      updateMasterControls();
      updateEffects();

      showToast("Audio effects have been reset.");
    });
  }

  /* =========================================================
     VOCAL PRESETS
     ========================================================= */

  function applySelectedPreset() {
    if (!vocalPreset) {
      return;
    }

    const preset = vocalPreset.value;

    const presets = {
      none: {
        bass: 0,
        mid: 0,
        treble: 0,
        reverb: 0,
        delay: 0,
        compressor: 0.25,
        chorus: 0,
        limiter: 0.5
      },

      clean: {
        bass: 1,
        mid: 0,
        treble: 2,
        reverb: 0.08,
        delay: 0,
        compressor: 0.4,
        chorus: 0,
        limiter: 0.5
      },

      warm: {
        bass: 3,
        mid: 1,
        treble: -1,
        reverb: 0.12,
        delay: 0.02,
        compressor: 0.45,
        chorus: 0.04,
        limiter: 0.55
      },

      bright: {
        bass: -1,
        mid: 1,
        treble: 4,
        reverb: 0.1,
        delay: 0,
        compressor: 0.35,
        chorus: 0.02,
        limiter: 0.5
      },

      room: {
        bass: 0,
        mid: 0,
        treble: 1,
        reverb: 0.42,
        delay: 0.08,
        compressor: 0.25,
        chorus: 0.04,
        limiter: 0.5
      },

      radio: {
        bass: 3,
        mid: 4,
        treble: 2,
        reverb: 0.03,
        delay: 0,
        compressor: 0.7,
        chorus: 0,
        limiter: 0.8
      }
    };

    const settings = presets[preset] || presets.none;

    if (bassControl) bassControl.value = settings.bass;
    if (midControl) midControl.value = settings.mid;
    if (trebleControl) trebleControl.value = settings.treble;

    if (reverbControl) reverbControl.value = settings.reverb;
    if (delayControl) delayControl.value = settings.delay;

    if (compressorControl) {
      compressorControl.value = settings.compressor;
    }

    if (chorusControl) chorusControl.value = settings.chorus;
    if (limiterControl) limiterControl.value = settings.limiter;

    updateMasterControls();
    updateEffects();

    showToast("Vocal preset applied: " + preset);
  }

  if (applyPresetBtn) {
    applyPresetBtn.addEventListener(
      "click",
      applySelectedPreset
    );
  }

  /* =========================================================
     MICROPHONE RECORDING
     ========================================================= */

  async function startMicrophoneRecording() {
    if (isRecordingMicrophone) {
      return;
    }

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      showToast(
        "Microphone access is unavailable. Use HTTPS and a supported browser.",
        5000
      );

      return;
    }

    try {
      await ensureAudioContext();
      setupEffectsGraph();

      microphoneStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

      microphoneSource =
        audioContext.createMediaStreamSource(
          microphoneStream
        );

      microphoneTrackGain =
        audioContext.createGain();

      microphoneTrackGain.gain.value = 1;

      microphoneSource.connect(microphoneTrackGain);

      microphoneTrackGain.connect(
        audioGraph.masterInput
      );

      microphoneChunks = [];

      const recordingStream =
        audioGraph.recordingDestination.stream;

      let mimeType = "";

      if (window.MediaRecorder) {
        const mimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/ogg"
        ];

        mimeType = mimeCandidates.find((type) =>
          MediaRecorder.isTypeSupported(type)
        ) || "";

        microphoneRecorder = mimeType
          ? new MediaRecorder(recordingStream, {
              mimeType
            })
          : new MediaRecorder(recordingStream);

        microphoneRecorder.addEventListener(
          "dataavailable",
          (event) => {
            if (event.data && event.data.size > 0) {
              microphoneChunks.push(event.data);
            }
          }
        );

        microphoneRecorder.addEventListener(
          "stop",
          async () => {
            await finishMicrophoneRecording();
          }
        );

        microphoneRecorder.start(250);
      }

      isRecordingMicrophone = true;

      if (recordBtn) {
        recordBtn.disabled = true;
      }

      if (stopRecordBtn) {
        stopRecordBtn.disabled = false;
      }

      if (recordStatus) {
        recordStatus.textContent = "Recording microphone...";
      }

      setStatus("Microphone recording started.");

      showToast("Microphone recording started.");

    } catch (error) {
      console.error(
        "Microphone recording failed:",
        error
      );

      if (microphoneStream) {
        microphoneStream.getTracks().forEach(
          (track) => track.stop()
        );
      }

      microphoneStream = null;

      if (recordStatus) {
        recordStatus.textContent =
          "Microphone permission unavailable";
      }

      showToast(
        "Could not start microphone recording: " +
          (error.message || "permission denied"),
        6000
      );
    }
  }

  function stopMicrophoneRecording() {
    if (!isRecordingMicrophone) {
      return;
    }

    isRecordingMicrophone = false;

    if (microphoneRecorder &&
        microphoneRecorder.state !== "inactive") {
      microphoneRecorder.stop();
    } else {
      finishMicrophoneRecording();
    }

    if (recordBtn) {
      recordBtn.disabled = false;
    }

    if (stopRecordBtn) {
      stopRecordBtn.disabled = true;
    }

    if (recordStatus) {
      recordStatus.textContent = "Processing recording...";
    }

    setStatus("Finishing microphone recording...");
  }

  async function finishMicrophoneRecording() {
    const chunks = microphoneChunks.slice();

    if (microphoneSource) {
      try {
        microphoneSource.disconnect();
      } catch (_) {}
    }

    if (microphoneTrackGain) {
      try {
        microphoneTrackGain.disconnect();
      } catch (_) {}
    }

    if (microphoneStream) {
      microphoneStream.getTracks().forEach(
        (track) => track.stop()
      );
    }

    microphoneSource = null;
    microphoneTrackGain = null;
    microphoneStream = null;
    microphoneRecorder = null;
    microphoneChunks = [];

    if (chunks.length === 0) {
      if (recordStatus) {
        recordStatus.textContent = "No audio recorded";
      }

      setStatus("Recording stopped.");

      return;
    }

    try {
      const mimeType =
        chunks[0].type || "audio/webm";

      const blob = new Blob(chunks, {
        type: mimeType
      });

      const buffer = await blob.arrayBuffer();

      const decoded =
        await audioContext.decodeAudioData(
          buffer.slice(0)
        );

      const track = {
        id: nextTrackId++,
        name: "Microphone Recording " +
          new Date().toLocaleTimeString(),
        originalFileName: "microphone-recording",
        size: blob.size,
        buffer: decoded,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
        removed: false,
        speed: 1,
        pitch: 0,
        fadeIn: 0,
        fadeOut: 0,
        source: null,
        gainNode: null,
        pannerNode: null,
        startedAt: 0,
        startOffset: 0
      };

      tracks.push(track);

      renderTracks();
      updateTransportDisplay();

      if (recordStatus) {
        recordStatus.textContent = "Recording added to tracks";
      }

      setStatus("Microphone recording added to your project.");

      showToast(
        "Microphone recording added to your tracks."
      );

    } catch (error) {
      console.error(
        "Could not decode microphone recording:",
        error
      );

      if (recordStatus) {
        recordStatus.textContent = "Recording could not be decoded";
      }

      showToast(
        "Recording was created, but the browser could not decode it. Try another browser.",
        6000
      );
    }
  }

  if (recordBtn) {
    recordBtn.addEventListener(
      "click",
      startMicrophoneRecording
    );
  }

  if (stopRecordBtn) {
    stopRecordBtn.addEventListener(
      "click",
      stopMicrophoneRecording
    );

    stopRecordBtn.disabled = true;
  }

  /* =========================================================
     VIRTUAL KEYBOARD
     ========================================================= */

  function noteToFrequency(note) {
    const match = /^([A-G])(#?)(-?\d+)$/.exec(note);

    if (!match) {
      return 440;
    }

    const noteNames = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11
    };

    const letter = match[1];
    const sharp = match[2] === "#" ? 1 : 0;
    const octave = Number(match[3]);

    const midi =
      (octave + 1) * 12 +
      noteNames[letter] +
      sharp;

    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  async function startKeyboardNote(note, record = true) {
    try {
      await ensureAudioContext();
      setupEffectsGraph();

      const frequency = noteToFrequency(note);

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;

      filter.type = "lowpass";
      filter.frequency.value = 8000;

      const volume = clamp(
        readControl(keyboardVolume, 0.3),
        0,
        1
      );

      gainNode.gain.value = 0;

      oscillator.connect(filter);
      filter.connect(gainNode);

      gainNode.connect(audioGraph.masterInput);

      const now = audioContext.currentTime;

      gainNode.gain.setValueAtTime(0, now);

      gainNode.gain.linearRampToValueAtTime(
        Math.max(0.0001, volume * 0.18),
        now + 0.02
      );

      oscillator.start(now);

      const voice = {
        note,
        oscillator,
        gainNode,
        startedAt: now,
        stopped: false
      };

      keyboardVoices.add(voice);

      keyboardActiveNotes.set(note, voice);

      if (record && keyboardRecording) {
        keyboardEvents.push({
          note,
          type: "on",
          time: Math.max(
            0,
            audioContext.currentTime -
              keyboardRecordingStart
          )
        });
      }

      highlightKeyboardKey(note, true);

      return voice;

    } catch (error) {
      console.error(
        "Keyboard note failed:",
        error
      );

      showToast("Could not play keyboard note.");

      return null;
    }
  }

  function stopKeyboardNote(note, record = true) {
    const voice = keyboardActiveNotes.get(note);

    if (!voice || !audioContext) {
      return;
    }

    const now = audioContext.currentTime;

    try {
      voice.gainNode.gain.cancelScheduledValues(now);

      voice.gainNode.gain.setTargetAtTime(
        0,
        now,
        0.04
      );

      voice.oscillator.stop(now + 0.2);

      voice.oscillator.addEventListener(
        "ended",
        () => {
          try {
            voice.oscillator.disconnect();
            voice.gainNode.disconnect();
          } catch (_) {}

          keyboardVoices.delete(voice);
        },
        { once: true }
      );

    } catch (_) {}

    voice.stopped = true;

    keyboardActiveNotes.delete(note);

    if (record && keyboardRecording) {
      keyboardEvents.push({
        note,
        type: "off",
        time: Math.max(
          0,
          audioContext.currentTime -
            keyboardRecordingStart
        )
      });
    }

    highlightKeyboardKey(note, false);
  }

  function stopKeyboardVoices() {
    Array.from(keyboardActiveNotes.keys()).forEach(
      (note) => stopKeyboardNote(note, false)
    );
  }

  function highlightKeyboardKey(note, active) {
    if (!pianoKeyboard) {
      return;
    }

    const key = pianoKeyboard.querySelector(
      '[data-note="' + note + '"]'
    );

    if (key) {
      key.classList.toggle("active", active);
    }
  }

  if (pianoKeyboard) {
    const keys = pianoKeyboard.querySelectorAll(
      "[data-note]"
    );

    keys.forEach((key) => {
      const note = key.dataset.note;

      key.addEventListener("pointerdown", async (event) => {
        event.preventDefault();

        if (keyboardActiveNotes.has(note)) {
          return;
        }

        await startKeyboardNote(note);
      });

      const release = (event) => {
        if (event) {
          event.preventDefault();
        }

        stopKeyboardNote(note);
      };

      key.addEventListener("pointerup", release);
      key.addEventListener("pointerleave", (event) => {
        if (event.buttons) {
          release(event);
        }
      });

      key.addEventListener("pointercancel", release);
    });
  }

  /* =========================================================
     COMPUTER KEYBOARD NOTES
     ========================================================= */

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

  const computerActiveKeys = new Set();

  document.addEventListener("keydown", async (event) => {
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

    const key = event.key.toLowerCase();
    const note = computerKeyMap[key];

    if (!note || event.repeat) {
      return;
    }

    event.preventDefault();

    computerActiveKeys.add(key);

    await startKeyboardNote(note);
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    const note = computerKeyMap[key];

    if (!note) {
      return;
    }

    computerActiveKeys.delete(key);

    stopKeyboardNote(note);
  });

  window.addEventListener("blur", () => {
    Array.from(computerActiveKeys).forEach((key) => {
      const note = computerKeyMap[key];

      if (note) {
        stopKeyboardNote(note);
      }
    });

    computerActiveKeys.clear();
  });

  /* =========================================================
     KEYBOARD PERFORMANCE RECORDING
     ========================================================= */

  function startKeyboardRecording() {
    keyboardEvents = [];
    keyboardRecordingStart =
      audioContext ? audioContext.currentTime : 0;

    keyboardRecording = true;

    if (recordKeyboardBtn) {
      recordKeyboardBtn.textContent =
        "■ Stop Keyboard Recording";

      recordKeyboardBtn.classList.add("recording");
    }

    showToast(
      "Keyboard recording started. Play some notes."
    );

    setStatus("Recording keyboard performance...");
  }

  function stopKeyboardRecording() {
    keyboardRecording = false;

    if (recordKeyboardBtn) {
      recordKeyboardBtn.textContent =
        "● Record Keyboard";

      recordKeyboardBtn.classList.remove("recording");
    }

    if (keyboardEvents.length === 0) {
      showToast("No keyboard notes were recorded.");

      setStatus("Keyboard recording stopped.");

      return;
    }

    showToast(
      keyboardEvents.length +
        " keyboard events recorded. They will play with the mix."
    );

    setStatus("Keyboard performance saved in memory.");
  }

  if (recordKeyboardBtn) {
    recordKeyboardBtn.addEventListener("click", async () => {
      try {
        await ensureAudioContext();

        if (!keyboardRecording) {
          startKeyboardRecording();
        } else {
          stopKeyboardRecording();
        }

      } catch (error) {
        showToast(
          error.message || "Keyboard recording could not start."
        );
      }
    });
  }

  function scheduleKeyboardEvents(startPosition = 0) {
    if (
      !audioContext ||
      !audioGraph ||
      keyboardEvents.length === 0
    ) {
      return;
    }

    const events = keyboardEvents
      .filter((event) => event.time >= startPosition)
      .slice()
      .sort((a, b) => a.time - b.time);

    const activeNotes = new Map();

    events.forEach((event) => {
      const delay =
        Math.max(0, event.time - startPosition);

      const scheduledTime =
        audioContext.currentTime + delay;

      if (event.type === "on") {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.value =
          noteToFrequency(event.note);

        gainNode.gain.value = 0.0001;

        oscillator.connect(gainNode);
        gainNode.connect(audioGraph.masterInput);

        gainNode.gain.setValueAtTime(
          0.0001,
          scheduledTime
        );

        gainNode.gain.linearRampToValueAtTime(
          Math.max(
            0.0001,
            readControl(keyboardVolume, 0.3) * 0.18
          ),
          scheduledTime + 0.02
        );

        oscillator.start(scheduledTime);

        activeNotes.set(event.note, {
          oscillator,
          gainNode
        });

      } else if (event.type === "off") {
        const voice = activeNotes.get(event.note);

        if (voice) {
          try {
            voice.gainNode.gain.setTargetAtTime(
              0,
              scheduledTime,
              0.03
            );

            voice.oscillator.stop(scheduledTime + 0.15);

            voice.oscillator.addEventListener(
              "ended",
              () => {
                try {
                  voice.oscillator.disconnect();
                  voice.gainNode.disconnect();
                } catch (_) {}
              },
              { once: true }
            );

          } catch (_) {}

          activeNotes.delete(event.note);
        }
      }
    });

    /*
     * Notes still held at the end are released after a short
     * safety period to avoid stuck oscillator sounds.
     */

    activeNotes.forEach((voice) => {
      const releaseTime =
        audioContext.currentTime +
        Math.max(0.1, getTrackDuration() - startPosition);

      try {
        voice.gainNode.gain.setTargetAtTime(
          0,
          releaseTime,
          0.04
        );

        voice.oscillator.stop(releaseTime + 0.2);
      } catch (_) {}
    });
  }

  /* =========================================================
     AUTO MIX
     ========================================================= */

  function autoMix() {
    if (tracks.length === 0) {
      showToast("Upload audio tracks before using Auto Mix.");
      return;
    }

    const usableTracks = tracks.filter(
      (track) => !track.removed && track.buffer
    );

    if (usableTracks.length === 0) {
      showToast("No usable audio tracks found.");
      return;
    }

    usableTracks.forEach((track) => {
      const buffer = track.buffer;

      let sumSquares = 0;
      let count = 0;

      /*
       * Sample a maximum of approximately 20,000 points
       * from the first channel for a quick loudness estimate.
       */

      const data = buffer.getChannelData(0);

      const stride = Math.max(
        1,
        Math.floor(data.length / 20000)
      );

      for (let i = 0; i < data.length; i += stride) {
        const value = data[i] || 0;

        sumSquares += value * value;
        count++;
      }

      const rms = Math.sqrt(
        sumSquares / Math.max(1, count)
      );

      /*
       * Balance tracks without applying extreme gain boosts.
       */

      const suggestedVolume =
        rms > 0.0001
          ? clamp(0.18 / rms, 0.15, 1.5)
          : 0.5;

      track.volume = Math.min(
        1,
        suggestedVolume
      );

      track.pan = 0;
    });

    /*
     * A moderate mastering preset helps keep peaks controlled.
     */

    if (masterVolume) {
      masterVolume.value = "0.75";
    }

    if (compressorControl) {
      compressorControl.value = "0.4";
    }

    if (limiterControl) {
      limiterControl.value = "0.65";
    }

    if (bassControl) {
      bassControl.value = "0";
    }

    if (midControl) {
      midControl.value = "0";
    }

    if (trebleControl) {
      trebleControl.value = "0";
    }

    updateMasterControls();
    updateEffects();
    renderTracks();

    showToast(
      "Auto Mix applied. Review the result before exporting."
    );

    setStatus("Automatic mix balancing completed.");
  }

  /*
   * Create an Auto Mix button if the HTML does not already
   * contain one. This allows the feature to be used without
   * changing the existing index.html.
   */

  function installAutoMixButton() {
    const existing = $("autoMixBtn");

    if (existing) {
      existing.addEventListener("click", autoMix);
      return;
    }

    const button = createButton(
      "✨ Auto Mix",
      "btn secondary"
    );

    button.id = "autoMixBtn";

    const mixerPanel = document.querySelector(
      ".mixer-panel .section-heading"
    );

    if (mixerPanel) {
      mixerPanel.appendChild(button);
    }

    button.addEventListener("click", autoMix);
  }

  installAutoMixButton();

  /* =========================================================
     PROJECT SETTINGS SAVE
     ========================================================= */

  function collectProjectSettings() {
    return {
      application: "Naol Music Studio",
      version: "1.0",
      savedAt: new Date().toISOString(),

      master: {
        volume: readControl(masterVolume, 0.8),
        pan: readControl(panControl, 0)
      },

      equalizer: {
        bass: readControl(bassControl, 0),
        mid: readControl(midControl, 0),
        treble: readControl(trebleControl, 0)
      },

      effects: {
        reverb: readControl(reverbControl, 0),
        delay: readControl(delayControl, 0),
        compressor: readControl(compressorControl, 0.25),
        noiseGate: readControl(noiseGateControl, 0),
        chorus: readControl(chorusControl, 0),
        limiter: readControl(limiterControl, 0.5)
      },

      vocal: {
        pitch: readControl(pitchControl, 0),
        speed: readControl(speedControl, 1),
        fadeIn: readControl(fadeInControl, 0),
        fadeOut: readControl(fadeOutControl, 0)
      },

      keyboard: {
        volume: readControl(keyboardVolume, 0.3),
        events: keyboardEvents
      },

      tracks: tracks.map((track) => ({
        name: track.name,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        speed: track.speed,
        fadeIn: track.fadeIn,
        fadeOut: track.fadeOut,
        duration: track.buffer.duration
      }))
    };
  }

  function saveProject() {
    const project = collectProjectSettings();

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    downloadBlob(
      blob,
      "naol-music-studio-project.json"
    );

    showToast(
      "Project settings downloaded. Keep your original audio files too."
    );
  }

  if (saveProjectBtn) {
    saveProjectBtn.addEventListener(
      "click",
      saveProject
    );
  }

  /* =========================================================
     LIVE MASTER METER
     ========================================================= */

  function startMeter() {
    if (!audioGraph || !masterMeter) {
      return;
    }

    if (meterAnimationFrame) {
      cancelAnimationFrame(meterAnimationFrame);
    }

    const analyser = audioGraph.analyser;

    const data = new Uint8Array(
      analyser.frequencyBinCount
    );

    function drawMeter() {
      if (!audioGraph || !masterMeter) {
        return;
      }

      analyser.getByteTimeDomainData(data);

      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        const value = (data[i] - 128) / 128;

        sum += value * value;
      }

      const rms = Math.sqrt(
        sum / Math.max(1, data.length)
      );

      const level = clamp(
        rms * 220,
        0,
        100
      );

      masterMeter.style.height =
        level + "%";

      meterAnimationFrame =
        requestAnimationFrame(drawMeter);
    }

    drawMeter();
  }

  /* =========================================================
     WAV ENCODER
     ========================================================= */

  function audioBufferToWav(buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numberOfFrames = buffer.length;

    const bytesPerSample = 2;

    const blockAlign =
      numberOfChannels * bytesPerSample;

    const dataSize =
      numberOfFrames * blockAlign;

    const arrayBuffer = new ArrayBuffer(
      44 + dataSize
    );

    const view = new DataView(arrayBuffer);

    function writeString(offset, text) {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");

    view.setUint32(
      4,
      36 + dataSize,
      true
    );

    writeString(8, "WAVE");
    writeString(12, "fmt ");

    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);

    view.setUint16(
      22,
      numberOfChannels,
      true
    );

    view.setUint32(
      24,
      sampleRate,
      true
    );

    view.setUint32(
      28,
      sampleRate * blockAlign,
      true
    );

    view.setUint16(
      32,
      blockAlign,
      true
    );

    view.setUint16(
      34,
      16,
      true
    );

    writeString(36, "data");

    view.setUint32(
      40,
      dataSize,
      true
    );

    const channels = [];

    for (let channel = 0; channel < numberOfChannels; channel++) {
      channels.push(
        buffer.getChannelData(channel)
      );
    }

    let offset = 44;

    for (let frame = 0; frame < numberOfFrames; frame++) {
      for (
        let channel = 0;
        channel < numberOfChannels;
        channel++
      ) {
        let sample = channels[channel][frame] || 0;

        sample = clamp(sample, -1, 1);

        const pcmValue =
          sample < 0
            ? sample * 32768
            : sample * 32767;

        view.setInt16(
          offset,
          pcmValue,
          true
        );

        offset += 2;
      }
    }

    return new Blob(
      [arrayBuffer],
      { type: "audio/wav" }
    );
  }

  /* =========================================================
     OFFLINE MIX RENDERING
     ========================================================= */

  async function renderOfflineMix() {
    const activeTracks = tracks.filter(
      (track) => !track.removed && track.buffer
    );

    if (activeTracks.length === 0) {
      throw new Error("Upload audio tracks before exporting.");
    }

    const totalDuration = Math.max(
      getTrackDuration(),
      keyboardEvents.length
        ? Math.max(
            ...keyboardEvents.map((event) => event.time)
          ) + 1
        : 0
    );

    if (totalDuration <= 0) {
      throw new Error("The mix has no audio duration.");
    }

    /*
     * Limit excessively long offline renders to avoid exhausting
     * mobile browser memory.
     */

    if (totalDuration > 1800) {
      throw new Error(
        "This mix is longer than 30 minutes. Export shorter sections on this device."
      );
    }

    const sampleRate =
      audioContext ? audioContext.sampleRate : 44100;

    const frameCount =
      Math.ceil(totalDuration * sampleRate);

    const offlineContext = new OfflineAudioContext(
      2,
      frameCount,
      sampleRate
    );

    const input = offlineContext.createGain();

    const bass = offlineContext.createBiquadFilter();
    const mid = offlineContext.createBiquadFilter();
    const treble = offlineContext.createBiquadFilter();

    const compressor =
      offlineContext.createDynamicsCompressor();

    const limiter =
      offlineContext.createDynamicsCompressor();

    const master =
      offlineContext.createGain();

    const panner =
      offlineContext.createStereoPanner();

    bass.type = "lowshelf";
    bass.frequency.value = 180;
    bass.gain.value = readControl(bassControl, 0);

    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    mid.gain.value = readControl(midControl, 0);

    treble.type = "highshelf";
    treble.frequency.value = 5000;
    treble.gain.value = readControl(trebleControl, 0);

    const compressionAmount = readControl(
      compressorControl,
      0.25
    );

    compressor.threshold.value =
      -12 - compressionAmount * 18;

    compressor.knee.value = 24;

    compressor.ratio.value =
      1 + compressionAmount * 7;

    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const limiterAmount = readControl(
      limiterControl,
      0.5
    );

    limiter.threshold.value =
      -1 - limiterAmount * 8;

    limiter.knee.value = 0;

    limiter.ratio.value =
      4 + limiterAmount * 16;

    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    master.gain.value =
      readControl(masterVolume, 0.8);

    panner.pan.value =
      readControl(panControl, 0);

    input.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(panner);
    panner.connect(offlineContext.destination);

    const anySolo = activeTracks.some(
      (track) => track.solo
    );

    activeTracks.forEach((track) => {
      if (track.muted || (anySolo && !track.solo)) {
        return;
      }

      const source =
        offlineContext.createBufferSource();

      const gain =
        offlineContext.createGain();

      const trackPan =
        offlineContext.createStereoPanner();

      source.buffer = track.buffer;

      const speed = clamp(
        track.speed || 1,
        0.5,
        1.5
      );

      source.playbackRate.value = speed;

      trackPan.pan.value = track.pan;

      const effectiveVolume =
        clamp(track.volume, 0, 1);

      gain.gain.value = effectiveVolume;

      const fadeIn = clamp(
        track.fadeIn || 0,
        0,
        10
      );

      const fadeOut = clamp(
        track.fadeOut || 0,
        0,
        10
      );

      const playbackDuration =
        track.buffer.duration / speed;

      if (fadeIn > 0) {
        gain.gain.setValueAtTime(
          0,
          0
        );

        gain.gain.linearRampToValueAtTime(
          effectiveVolume,
          Math.min(fadeIn, playbackDuration)
        );
      }

      if (
        fadeOut > 0 &&
        playbackDuration > fadeOut
      ) {
        gain.gain.setValueAtTime(
          effectiveVolume,
          playbackDuration - fadeOut
        );

        gain.gain.linearRampToValueAtTime(
          0,
          playbackDuration
        );
      }

      source.connect(gain);
      gain.connect(trackPan);
      trackPan.connect(input);

      source.start(0);
    });

    /*
     * Re-create keyboard notes in the offline render so recorded
     * keyboard performances can be included in the exported mix.
     */

    const sortedEvents = keyboardEvents
      .slice()
      .sort((a, b) => a.time - b.time);

    const offlineVoices = new Map();

    sortedEvents.forEach((event) => {
      const when = clamp(
        event.time,
        0,
        totalDuration
      );

      if (event.type === "on") {
        const oscillator =
          offlineContext.createOscillator();

        const gain =
          offlineContext.createGain();

        oscillator.type = "triangle";

        oscillator.frequency.value =
          noteToFrequency(event.note);

        gain.gain.value = 0.0001;

        oscillator.connect(gain);
        gain.connect(input);

        gain.gain.setValueAtTime(
          0.0001,
          when
        );

        gain.gain.linearRampToValueAtTime(
          Math.max(
            0.0001,
            readControl(keyboardVolume, 0.3) * 0.18
          ),
          Math.min(totalDuration, when + 0.02)
        );

        oscillator.start(when);

        if (!offlineVoices.has(event.note)) {
          offlineVoices.set(event.note, []);
        }

        offlineVoices.get(event.note).push({
          oscillator,
          gain
        });

      } else if (event.type === "off") {
        const voices =
          offlineVoices.get(event.note);

        const voice = voices && voices.shift();

        if (voice) {
          try {
            voice.gain.gain.setTargetAtTime(
              0,
              when,
              0.03
            );

            voice.oscillator.stop(
              Math.min(totalDuration, when + 0.2)
            );
          } catch (_) {}
        }
      }
    });

    /*
     * Release any keyboard notes that have no matching note-off.
     */

    offlineVoices.forEach((voices) => {
      voices.forEach((voice) => {
        try {
          voice.gain.gain.setTargetAtTime(
            0,
            Math.max(0, totalDuration - 0.25),
            0.04
          );

          voice.oscillator.stop(
            Math.max(0.01, totalDuration - 0.02)
          );
        } catch (_) {}
      });
    });

    return offlineContext.startRendering();
  }

  /* =========================================================
     EXPORT WAV
     ========================================================= */

  async function exportWav() {
    const buttons = [
      exportBtn,
      masterExportBtn
    ].filter(Boolean);

    buttons.forEach((button) => {
      button.disabled = true;
      button.dataset.originalText =
        button.textContent;

      button.textContent = "Rendering...";
    });

    try {
      await ensureAudioContext();

      setStatus("Rendering WAV mix...");

      showToast(
        "Rendering your mix. Please wait."
      );

      const renderedBuffer =
        await renderOfflineMix();

      const wavBlob =
        audioBufferToWav(renderedBuffer);

      downloadBlob(
        wavBlob,
        "naol-music-studio-mix.wav"
      );

      setStatus("WAV export completed.");

      showToast(
        "WAV file exported successfully."
      );

    } catch (error) {
      console.error("WAV export failed:", error);

      setStatus("WAV export failed.");

      showToast(
        error.message ||
          "Could not export WAV audio.",
        6000
      );

    } finally {
      buttons.forEach((button) => {
        button.disabled = false;

        if (button.dataset.originalText) {
          button.textContent =
            button.dataset.originalText;
        }
      });
    }
  }

  /* =========================================================
     EXPORT WEBM
     ========================================================= */

  async function exportWebM() {
    if (!window.MediaRecorder) {
      showToast(
        "WebM export is not supported in this browser. Try WAV export."
      );

      return;
    }

    try {
      await ensureAudioContext();

      const stream =
        audioGraph.recordingDestination.stream;

      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm"
      ].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      if (!mimeType) {
        showToast(
          "This browser does not support WebM audio recording."
        );

        return;
      }

      const recorder = new MediaRecorder(
        stream,
        { mimeType }
      );

      const chunks = [];

      recorder.addEventListener(
        "dataavailable",
        (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        }
      );

      recorder.addEventListener(
        "stop",
        () => {
          const blob = new Blob(chunks, {
            type: mimeType
          });

          downloadBlob(
            blob,
            "naol-music-studio-mix.webm"
          );

          setStatus("WebM export completed.");

          showToast(
            "WebM recording downloaded."
          );
        },
        { once: true }
      );

      const wasPlaying = isPlaying;
      const oldPosition = getCurrentPosition();

      if (!wasPlaying) {
        await startPlayback(0);
      }

      recorder.start();

      setStatus("Recording WebM mix...");

      const duration =
        getTrackDuration() * 1000 + 500;

      setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }

        if (!wasPlaying) {
          stopPlayback();
        } else {
          startPlayback(oldPosition);
        }
      }, duration);

    } catch (error) {
      console.error("WebM export failed:", error);

      showToast(
        error.message ||
          "WebM export failed.",
        5000
      );
    }
  }

  /* =========================================================
     EXPORT BUTTONS
     ========================================================= */

  async function exportSelectedFormat() {
    const format =
      exportFormat ? exportFormat.value : "wav";

    if (format === "webm") {
      await exportWebM();
    } else {
      await exportWav();
    }
  }

  if (exportBtn) {
    exportBtn.addEventListener(
      "click",
      exportSelectedFormat
    );
  }

  if (masterExportBtn) {
    masterExportBtn.addEventListener(
      "click",
      exportSelectedFormat
    );
  }

  /* =========================================================
     SIDEBAR NAVIGATION
     ========================================================= */

  const sectionMap = {
    studio: $("studioSection"),
    effects: $("effectsSection"),
    vocal: $("vocalSection"),
    keyboard: $("keyboardSection"),
    mastering: $("masteringSection")
  };

  const navItems = document.querySelectorAll(
    ".nav-item[data-section]"
  );

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const sectionName = item.dataset.section;

      const target = sectionMap[sectionName];

      if (!target) {
        return;
      }

      navItems.forEach((nav) => {
        nav.classList.toggle(
          "active",
          nav === item
        );
      });

      target.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });

  /* =========================================================
     CLEANUP
     ========================================================= */

  window.addEventListener("beforeunload", () => {
    stopAllSources();
    stopKeyboardVoices();

    clearInterval(playbackTimer);

    if (meterAnimationFrame) {
      cancelAnimationFrame(meterAnimationFrame);
    }

    if (microphoneStream) {
      microphoneStream.getTracks().forEach(
        (track) => track.stop()
      );
    }
  });

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  if (stopRecordBtn) {
    stopRecordBtn.disabled = true;
  }

  updateControlLabels();
  renderTracks();
  updateTransportDisplay();

  setStatus(
    "Studio ready. Upload audio to begin."
  );

  console.log(
    "Naol Music Studio initialized successfully."
  );
});
