"use strict";

/* =========================================================
   NAOL MUSIC STUDIO
   Browser-based audio editing and mixing engine
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
  let masterCompressor = null;
  let masterLimiter = null;

  let masterLow = null;
  let masterMid = null;
  let masterHigh = null;
  let masterPan = null;

  let masterDelay = null;
  let masterDelayFeedback = null;
  let masterDelayWet = null;

  let masterReverb = null;
  let masterReverbWet = null;

  let masterChorus = null;
  let chorusLFO = null;
  let chorusDepth = null;
  let chorusWet = null;

  let noiseGateGain = null;
  let noiseGateAnalyser = null;

  let recordingDestination = null;

  let tracks = [];
  let nextTrackId = 1;

  let selectedTrackId = null;

  let mediaRecorder = null;
  let microphoneStream = null;
  let recordedChunks = [];

  let keyboardVolume = 0.3;
  let keyboardDestination = null;
  let keyboardRecordingDestination = null;

  let keyboardActiveNotes = new Map();

  let renderInProgress = false;
  let toastTimer = null;

  const trackElements = new Map();

  /* -------------------------------------------------------
     GENERAL HELPERS
  ------------------------------------------------------- */

  function notify(message) {
    if (!toast) return;

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

  function setText(id, text) {
    const element = $(id);

    if (element) {
      element.textContent = text;
    }
  }

  function safeDisconnect(node) {
    if (!node) return;

    try {
      node.disconnect();
    } catch (_) {
      // Node may already be disconnected.
    }
  }

  function audioSupported() {
    if (!AudioContextClass) {
      notify(
        "Browser audio engine hin deeggaru. Browser ammayyaa fayyadami."
      );

      return false;
    }

    return true;
  }

  /* -------------------------------------------------------
     AUDIO CONTEXT AND MASTER ENGINE
  ------------------------------------------------------- */

  async function ensureAudioContext() {
    if (!audioSupported()) {
      throw new Error("AudioContext is unavailable.");
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();

      masterGain = audioContext.createGain();
      masterAnalyser = audioContext.createAnalyser();

      masterAnalyser.fftSize = 256;
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

      masterCompressor = audioContext.createDynamicsCompressor();

      masterCompressor.threshold.value = -24;
      masterCompressor.knee.value = 18;
      masterCompressor.ratio.value = 4;
      masterCompressor.attack.value = 0.006;
      masterCompressor.release.value = 0.18;

      masterLimiter = audioContext.createDynamicsCompressor();

      masterLimiter.threshold.value = -3;
      masterLimiter.knee.value = 0;
      masterLimiter.ratio.value = 20;
      masterLimiter.attack.value = 0.001;
      masterLimiter.release.value = 0.08;

      masterDelay = audioContext.createDelay(2);
      masterDelay.delayTime.value = 0.25;

      masterDelayFeedback = audioContext.createGain();
      masterDelayFeedback.gain.value = 0.25;

      masterDelayWet = audioContext.createGain();
      masterDelayWet.gain.value = 0;

      masterReverb = audioContext.createConvolver();
      masterReverb.buffer = createImpulseResponse(
        audioContext,
        2.5,
        2.0
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

      noiseGateGain = audioContext.createGain();
      noiseGateGain.gain.value = 1;

      noiseGateAnalyser = audioContext.createAnalyser();
      noiseGateAnalyser.fftSize = 1024;

      recordingDestination = audioContext.createMediaStreamDestination();

      /*
       * Main signal chain:
       * EQ -> Pan -> Compressor -> Limiter -> Master Gain
       *      -> Delay/Reverb/Chorus parallel paths -> Output
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

      /*
       * Keyboard notes are connected to the main processing chain.
       */
      keyboardDestination = audioContext.createGain();
      keyboardDestination.gain.value = 1;

      keyboardDestination.connect(masterLow);
      keyboardRecordingDestination = recordingDestination;

      updateMasterControls();
      updateEffectControls();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext;
  }

  function createImpulseResponse(context, seconds, decay) {
    const length = Math.floor(context.sampleRate * seconds);

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
    const masterValue = getNumber("masterVolume", 0.8);

    setText(
      "masterVolumeValue",
      Math.round(masterValue * 100) + "%"
    );

    const pan = getNumber("panControl", 0);

    setText(
      "panValue",
      Math.abs(pan) < 0.01
        ? "Center"
        : pan < 0
          ? "Left " + Math.round(Math.abs(pan) * 100) + "%"
          : "Right " + Math.round(pan * 100) + "%"
    );

    const bass = getNumber("bassControl", 0);
    const mid = getNumber("midControl", 0);
    const treble = getNumber("trebleControl", 0);

    setText("bassValue", bass.toFixed(1) + " dB");
    setText("midValue", mid.toFixed(1) + " dB");
    setText("trebleValue", treble.toFixed(1) + " dB");

    if (!audioContext) return;

    const now = audioContext.currentTime;

    masterGain.gain.setTargetAtTime(
      masterValue,
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

  /* -------------------------------------------------------
     EFFECTS
  ------------------------------------------------------- */

  function updateEffectControls() {
    const reverb = getNumber("reverbControl", 0);
    const delay = getNumber("delayControl", 0);

    const compressor = getNumber("compressorControl", 0.25);
    const noiseGate = getNumber("noiseGateControl", 0);

    const chorus = getNumber("chorusControl", 0);
    const limiter = getNumber("limiterControl", 0.5);

    setText("reverbValue", Math.round(reverb * 100) + "%");
    setText("delayValue", Math.round(delay * 100) + "%");

    setText(
      "compressorValue",
      Math.round(compressor * 100) + "%"
    );

    setText(
      "noiseGateValue",
      noiseGate === 0
        ? "Off"
        : noiseGate.toFixed(3)
    );

    setText("chorusValue", Math.round(chorus * 100) + "%");
    setText("limiterValue", Math.round(limiter * 100) + "%");

    if (!audioContext) return;

    const now = audioContext.currentTime;

    masterReverbWet.gain.setTargetAtTime(
      reverb * 0.55,
      now,
      0.04
    );

    masterDelayWet.gain.setTargetAtTime(
      delay * 0.55,
      now,
      0.04
    );

    masterDelayFeedback.gain.setTargetAtTime(
      clamp(delay * 0.55, 0, 0.65),
      now,
      0.04
    );

    masterCompressor.threshold.setTargetAtTime(
      -8 - compressor * 24,
      now,
      0.04
    );

    masterCompressor.ratio.setTargetAtTime(
      1 + compressor * 9,
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
      chorus * 0.35,
      now,
      0.04
    );

    /*
     * Gate monitor reads the post-EQ signal level.
     * It attenuates quiet signals; it is not spectral denoising.
     */
    if (noiseGate > 0) {
      if (!noiseGateAnalyser) return;

      const buffer = new Float32Array(
        noiseGateAnalyser.fftSize
      );

      noiseGateAnalyser.getFloatTimeDomainData(buffer);

      let sum = 0;

      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }

      const rms = Math.sqrt(sum / buffer.length);

      const target = rms < noiseGate ? 0.04 : 1;

      noiseGateGain.gain.setTargetAtTime(
        target,
        now,
        0.025
      );
    } else {
      noiseGateGain.gain.setTargetAtTime(
        1,
        now,
        0.025
      );
    }
  }

  /* -------------------------------------------------------
     TRACK CREATION
  ------------------------------------------------------- */

  async function createTrackFromFile(file) {
    if (!file || !file.type.startsWith("audio/")) {
      notify("Faayila audio sirrii filadhu.");
      return;
    }

    await ensureAudioContext();

    setStatus("Loading " + file.name + "...");

    let audioBuffer;

    try {
      const arrayBuffer = await file.arrayBuffer();

      audioBuffer = await audioContext.decodeAudioData(
        arrayBuffer.slice(0)
      );
    } catch (error) {
      console.error(error);

      notify(
        "Faayila audio kana banuun hin danda'amne. Format biraa yaali."
      );

      setStatus("Could not load audio");

      return;
    }

    const track = {
      id: nextTrackId++,
      name: file.name,
      buffer: audioBuffer,
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      source: null,
      gainNode: null,
      panNode: null,
      gateGain: null,
      gateAnalyser: null,
      active: false,
      startedAt: 0,
      offset: 0,
      playbackRate: 1,
      pitchShift: 0,
      fadeIn: 0,
      fadeOut: 0,
      objectURL: null
    };

    tracks.push(track);

    if (selectedTrackId === null) {
      selectedTrackId = track.id;
    }

    renderTracks();

    updateCurrentTrack();

    notify("Audio loaded: " + file.name);

    setStatus("Audio ready");
  }

  /* -------------------------------------------------------
     TRACK UI
  ------------------------------------------------------- */

  function renderTracks() {
    trackList.innerHTML = "";

    trackElements.clear();

    if (tracks.length === 0) {
      const empty = document.createElement("div");

      empty.className = "empty-state";

      empty.innerHTML = `
        <div class="empty-icon">♫</div>
        <h3>Your studio is ready</h3>
        <p>Upload an audio file to begin editing and mixing.</p>
      `;

      trackList.appendChild(empty);

      return;
    }

    tracks.forEach((track) => {
      const card = document.createElement("article");

      card.className = "track-card";

      card.dataset.trackId = String(track.id);

      const header = document.createElement("div");

      header.className = "track-header";

      const title = document.createElement("div");

      title.className = "track-title";
      title.textContent = track.name;

      const actions = document.createElement("div");

      actions.className = "track-actions";

      const buttons = [
        ["Select", "select"],
        [track.muted ? "Unmute" : "Mute", "mute"],
        [track.solo ? "Unsolo" : "Solo", "solo"],
        ["Play", "play"],
        ["Export WAV", "export"],
        ["Remove", "remove"]
      ];

      buttons.forEach(([label, action]) => {
        const button = document.createElement("button");

        button.className = "mini-btn";
        button.type = "button";
        button.textContent = label;

        button.addEventListener("click", async () => {
          try {
            if (action === "select") {
              selectedTrackId = track.id;
              updateCurrentTrack();
              renderTracks();

              notify("Track selected");
            }

            if (action === "mute") {
              track.muted = !track.muted;

              updateTrackAudioState(track);
              renderTracks();
            }

            if (action === "solo") {
              track.solo = !track.solo;

              updateAllTrackAudioStates();
              renderTracks();
            }

            if (action === "play") {
              selectedTrackId = track.id;

              await playTrack(track);

              updateCurrentTrack();
              renderTracks();
            }

            if (action === "export") {
              exportTrackWav(track);
            }

            if (action === "remove") {
              removeTrack(track.id);
            }
          } catch (error) {
            console.error(error);
            notify("Track operation failed.");
          }
        });

        actions.appendChild(button);
      });

      header.appendChild(title);
      header.appendChild(actions);

      const canvas = document.createElement("canvas");

      canvas.className = "track-waveform";
      canvas.width = 1000;
      canvas.height = 124;

      drawWaveform(canvas, track.buffer);

      const controls = document.createElement("div");

      controls.className = "track-controls";

      const volumeControl = document.createElement("div");

      volumeControl.className = "track-control";

      const volumeLabel = document.createElement("label");

      volumeLabel.textContent = "Track Volume";

      const volume = document.createElement("input");

      volume.type = "range";
      volume.min = "0";
      volume.max = "1";
      volume.step = "0.01";
      volume.value = String(track.volume);

      const volumeText = document.createElement("span");

      volumeText.textContent =
        Math.round(track.volume * 100) + "%";

      volume.addEventListener("input", () => {
        track.volume = Number(volume.value);

        volumeText.textContent =
          Math.round(track.volume * 100) + "%";

        updateTrackAudioState(track);
      });

      volumeControl.append(
        volumeLabel,
        volume,
        volumeText
      );

      const panControlElement = document.createElement("div");

      panControlElement.className = "track-control";

      const panLabel = document.createElement("label");

      panLabel.textContent = "Track Pan";

      const pan = document.createElement("input");

      pan.type = "range";
      pan.min = "-1";
      pan.max = "1";
      pan.step = "0.01";
      pan.value = String(track.pan);

      const panText = document.createElement("span");

      panText.textContent = getPanText(track.pan);

      pan.addEventListener("input", () => {
        track.pan = Number(pan.value);

        panText.textContent = getPanText(track.pan);

        if (track.panNode && audioContext) {
          track.panNode.pan.setTargetAtTime(
            track.pan,
            audioContext.currentTime,
            0.02
          );
        }
      });

      panControlElement.append(
        panLabel,
        pan,
        panText
      );

      controls.append(
        volumeControl,
        panControlElement
      );

      card.append(
        header,
        canvas,
        controls
      );

      trackList.appendChild(card);

      trackElements.set(track.id, {
        card,
        canvas,
        volume,
        pan
      });
    });
  }

  function getPanText(pan) {
    if (Math.abs(pan) < 0.01) return "Center";

    return pan < 0
      ? "Left " + Math.round(-pan * 100) + "%"
      : "Right " + Math.round(pan * 100) + "%";
  }

  function drawWaveform(canvas, buffer) {
    const ctx = canvas.getContext("2d");

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#101a2b";

    ctx.fillRect(0, 0, width, height);

    const data = buffer.getChannelData(0);

    const step = Math.max(
      1,
      Math.floor(data.length / width)
    );

    const center = height / 2;

    ctx.beginPath();

    ctx.strokeStyle = "#8276ff";
    ctx.lineWidth = 1.6;

    for (let x = 0; x < width; x++) {
      const start = x * step;

      let min = 1;
      let max = -1;

      for (
        let i = start;
        i < Math.min(start + step, data.length);
        i++
      ) {
        const value = data[i];

        if (value < min) min = value;
        if (value > max) max = value;
      }

      ctx.moveTo(x, center + min * center * 0.9);

      ctx.lineTo(x, center + max * center * 0.9);
    }

    ctx.stroke();
  }

  /* -------------------------------------------------------
     TRACK AUDIO ROUTING
  ------------------------------------------------------- */

  function isTrackAudible(track) {
    const hasSolo = tracks.some((item) => item.solo);

    if (track.muted) return false;

    if (hasSolo && !track.solo) return false;

    return true;
  }

  function createTrackNodes(track) {
    track.gainNode = audioContext.createGain();

    track.panNode = audioContext.createStereoPanner();

    track.gateGain = audioContext.createGain();

    track.gateAnalyser = audioContext.createAnalyser();
    track.gateAnalyser.fftSize = 1024;

    track.gainNode.gain.value = track.volume;
    track.panNode.pan.value = track.pan;

    track.gainNode.connect(track.panNode);

    track.panNode.connect(track.gateGain);

    track.gateGain.connect(track.gateAnalyser);

    track.gateAnalyser.connect(masterLow);

    return track.gainNode;
  }

  function updateTrackAudioState(track) {
    if (!track.gainNode || !audioContext) return;

    const now = audioContext.currentTime;

    const target = isTrackAudible(track)
      ? track.volume
      : 0;

    track.gainNode.gain.setTargetAtTime(
      target,
      now,
      0.02
    );
  }

  function updateAllTrackAudioStates() {
    tracks.forEach(updateTrackAudioState);
  }

  /* -------------------------------------------------------
     PLAYBACK
  ------------------------------------------------------- */

  async function playTrack(track) {
    await ensureAudioContext();

    if (track.source) {
      stopTrackSource(track, true);
    }

    createTrackNodes(track);

    const source = audioContext.createBufferSource();

    source.buffer = track.buffer;

    source.playbackRate.value = track.playbackRate;

    source.connect(track.gainNode);

    track.source = source;

    track.offset = clamp(
      track.offset,
      0,
      Math.max(0, track.buffer.duration - 0.01)
    );

    track.startedAt = audioContext.currentTime;

    track.active = true;

    updateTrackAudioState(track);

    source.onended = () => {
      if (track.source !== source) return;

      track.active = false;

      safeDisconnect(source);
      safeDisconnect(track.gainNode);
      safeDisconnect(track.panNode);
      safeDisconnect(track.gateGain);
      safeDisconnect(track.gateAnalyser);

      track.source = null;

      track.gainNode = null;
      track.panNode = null;
      track.gateGain = null;
      track.gateAnalyser = null;

      if (!tracks.some((item) => item.active)) {
        setStatus("Playback finished");
      }
    };

    source.start(0, track.offset);

    updateCurrentTrack();

    setStatus("Playing " + track.name);
  }

  function stopTrackSource(track, preservePosition = false) {
    if (!track.source) {
      track.active = false;
      return;
    }

    if (preservePosition && audioContext) {
      const elapsed =
        (audioContext.currentTime - track.startedAt) *
        track.playbackRate;

      track.offset = clamp(
        track.offset + elapsed,
        0,
        track.buffer.duration
      );
    } else {
      track.offset = 0;
    }

    const source = track.source;

    track.source = null;
    track.active = false;

    source.onended = null;

    try {
      source.stop();
    } catch (_) {
      // Already stopped.
    }

    safeDisconnect(source);

    safeDisconnect(track.gainNode);
    safeDisconnect(track.panNode);
    safeDisconnect(track.gateGain);
    safeDisconnect(track.gateAnalyser);

    track.gainNode = null;
    track.panNode = null;
    track.gateGain = null;
    track.gateAnalyser = null;
  }

  async function playAllTracks() {
    if (tracks.length === 0) {
      notify("Jalqaba music upload godhi.");
      return;
    }

    await ensureAudioContext();

    const activeTracks = tracks.filter(
      (track) => track.active
    );

    if (activeTracks.length > 0) {
      notify("Music duraan taphachaa jira.");
      return;
    }

    const longestTrack = tracks.reduce(
      (longest, track) =>
        track.buffer.duration > longest.buffer.duration
          ? track
          : longest,
      tracks[0]
    );

    selectedTrackId = longestTrack.id;

    for (const track of tracks) {
      track.offset = 0;
    }

    const jobs = tracks.map((track) => playTrack(track));

    await Promise.all(jobs);

    updateCurrentTrack();
  }

  function pauseAllTracks() {
    if (!audioContext) return;

    tracks.forEach((track) => {
      if (track.active) {
        stopTrackSource(track, true);
      }
    });

    setStatus("Playback paused");
  }

  function stopAllTracks() {
    tracks.forEach((track) => {
      stopTrackSource(track, false);
    });

    setStatus("Playback stopped");

    updateCurrentTrack();
  }

  function removeTrack(trackId) {
    const track = tracks.find(
      (item) => item.id === trackId
    );

    if (!track) return;

    stopTrackSource(track, false);

    tracks = tracks.filter(
      (item) => item.id !== trackId
    );

    if (selectedTrackId === trackId) {
      selectedTrackId = tracks.length
        ? tracks[0].id
        : null;
    }

    renderTracks();

    updateCurrentTrack();

    notify("Track removed");
  }

  function updateCurrentTrack() {
    const track = tracks.find(
      (item) => item.id === selectedTrackId
    );

    if (!track) {
      currentTrackName.textContent = "No audio selected";

      currentTime.textContent = "00:00";

      durationDisplay.textContent = "00:00";

      seekBar.value = "0";

      seekBar.max = "100";

      return;
    }

    currentTrackName.textContent = track.name;

    durationDisplay.textContent = formatTime(
      track.buffer.duration
    );

    seekBar.max = String(track.buffer.duration || 1);

    seekBar.value = String(
      clamp(
        track.offset,
        0,
        track.buffer.duration
      )
    );
  }

  function getCurrentPosition(track) {
    if (!track) return 0;

    if (!track.active || !audioContext) {
      return track.offset;
    }

    const elapsed =
      (audioContext.currentTime - track.startedAt) *
      track.playbackRate;

    return clamp(
      track.offset + elapsed,
      0,
      track.buffer.duration
    );
  }

  /* -------------------------------------------------------
     AUDIO UPLOAD
  ------------------------------------------------------- */

  uploadInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) return;

    try {
      for (const file of files) {
        await createTrackFromFile(file);
      }
    } catch (error) {
      console.error(error);

      notify("Audio upload irratti rakkoon uumame.");
    }

    uploadInput.value = "";
  });

  $("addTrackBtn").addEventListener("click", () => {
    uploadInput.click();
  });

  /* -------------------------------------------------------
     TRANSPORT BUTTONS
  ------------------------------------------------------- */

  playBtn.addEventListener("click", async () => {
    try {
      await playAllTracks();
    } catch (error) {
      console.error(error);

      notify("Playback jalqabuu hin dandeenye.");
    }
  });

  pauseBtn.addEventListener("click", pauseAllTracks);

  stopBtn.addEventListener("click", stopAllTracks);

  seekBar.addEventListener("input", () => {
    const track = tracks.find(
      (item) => item.id === selectedTrackId
    );

    if (!track) return;

    const wasPlaying = track.active;

    if (wasPlaying) {
      stopTrackSource(track, false);
    }

    track.offset = clamp(
      Number(seekBar.value),
      0,
      track.buffer.duration
    );

    if (wasPlaying) {
      playTrack(track).catch(console.error);
    }

    currentTime.textContent = formatTime(track.offset);
  });

  /* -------------------------------------------------------
     MASTER CONTROLS
  ------------------------------------------------------- */

  [
    "masterVolume",
    "panControl",
    "bassControl",
    "midControl",
    "trebleControl"
  ].forEach((id) => {
    $(id).addEventListener("input", async () => {
      try {
        await ensureAudioContext();

        updateMasterControls();
      } catch (error) {
        console.error(error);
      }
    });
  });

  [
    "reverbControl",
    "delayControl",
    "compressorControl",
    "noiseGateControl",
    "chorusControl",
    "limiterControl"
  ].forEach((id) => {
    $(id).addEventListener("input", async () => {
      try {
        await ensureAudioContext();

        updateEffectControls();
      } catch (error) {
        console.error(error);
      }
    });
  });

  $("resetEffectsBtn").addEventListener("click", async () => {
    reverbControl.value = "0";
    delayControl.value = "0";
    compressorControl.value = "0.25";
    noiseGateControl.value = "0";
    chorusControl.value = "0";
    limiterControl.value = "0.5";

    await ensureAudioContext();

    updateEffectControls();

    notify("Effects reset");
  });

  /* -------------------------------------------------------
     PRESETS
  ------------------------------------------------------- */

  $("applyPresetBtn").addEventListener("click", async () => {
    const preset = $("vocalPreset").value;

    const presets = {
      none: {
        bass: 0,
        mid: 0,
        treble: 0,
        reverb: 0,
        delay: 0,
        compressor: 0.25,
        chorus: 0
      },

      clean: {
        bass: 1,
        mid: 0,
        treble: 1.5,
        reverb: 0.08,
        delay: 0,
        compressor: 0.3,
        chorus: 0
      },

      warm: {
        bass: 2,
        mid: 0.5,
        treble: -1,
        reverb: 0.12,
        delay: 0.05,
        compressor: 0.4,
        chorus: 0.08
      },

      bright: {
        bass: -1,
        mid: 0,
        treble: 2.5,
        reverb: 0.1,
        delay: 0.04,
        compressor: 0.35,
        chorus: 0.05
      },

      room: {
        bass: 0,
        mid: 0,
        treble: 0,
        reverb: 0.45,
        delay: 0.08,
        compressor: 0.2,
        chorus: 0.05
      },

      radio: {
        bass: -3,
        mid: 3,
        treble: 1,
        reverb: 0.02,
        delay: 0,
        compressor: 0.7,
        chorus: 0
      }
    };

    const p = presets[preset] || presets.none;

    $("bassControl").value = String(p.bass);
    $("midControl").value = String(p.mid);
    $("trebleControl").value = String(p.treble);

    reverbControl.value = String(p.reverb);
    delayControl.value = String(p.delay);

    compressorControl.value = String(p.compressor);
    chorusControl.value = String(p.chorus);

    await ensureAudioContext();

    updateMasterControls();
    updateEffectControls();

    notify("Preset applied: " + preset);
  });

  /* -------------------------------------------------------
     SPEED AND PITCH
  ------------------------------------------------------- */

  function updatePlaybackRate() {
    const speed = getNumber("speedControl", 1);
    const semitones = getNumber("pitchControl", 0);

    setText("speedValue", speed.toFixed(2) + "x");

    setText(
      "pitchValue",
      semitones + " semitones"
    );

    /*
     * Native AudioBufferSource playbackRate changes pitch too.
     * This is not independent pitch correction.
     */
    const rate =
      speed * Math.pow(2, semitones / 12);

    tracks.forEach((track) => {
      track.playbackRate = clamp(rate, 0.25, 3);

      if (track.source) {
        track.source.playbackRate.setTargetAtTime(
          track.playbackRate,
          audioContext.currentTime,
          0.03
        );
      }
    });
  }

  pitchControl.addEventListener("input", updatePlaybackRate);

  speedControl.addEventListener("input", updatePlaybackRate);

  fadeInControl.addEventListener("input", () => {
    setText(
      "fadeInValue",
      getNumber("fadeInControl", 0) + " sec"
    );
  });

  fadeOutControl.addEventListener("input", () => {
    setText(
      "fadeOutValue",
      getNumber("fadeOutControl", 0) + " sec"
    );
  });

  /* -------------------------------------------------------
     MICROPHONE RECORDING
  ------------------------------------------------------- */

  async function startMicrophoneRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify("Microphone access browser kana keessatti hin jiru.");
      return;
    }

    await ensureAudioContext();

    try {
      microphoneStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

      const micSource =
        audioContext.createMediaStreamSource(
          microphoneStream
        );

      const micGain = audioContext.createGain();

      micGain.gain.value = 1;

      micSource.connect(micGain);
      micGain.connect(masterLow);

      /*
       * Record the master mix as heard through the master
       * processing path. Microphone stream stays local.
       */
      const stream = recordingDestination.stream;

      recordedChunks = [];

      const options = getRecorderOptions();

      mediaRecorder = options
        ? new MediaRecorder(stream, options)
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mimeType =
          mediaRecorder?.mimeType || "audio/webm";

        const blob = new Blob(recordedChunks, {
          type: mimeType
        });

        const extension =
          mimeType.includes("ogg") ? "ogg" : "webm";

        const file = new File(
          [blob],
          "Naol_Recording." + extension,
          { type: mimeType }
        );

        /*
         * Stop mic after recording, then load the recording.
         */
        microphoneStream?.getTracks().forEach((track) => {
          track.stop();
        });

        microphoneStream = null;

        safeDisconnect(micSource);
        safeDisconnect(micGain);

        await createTrackFromFile(file);

        recordStatus.textContent = "Recording saved";

        setStatus("Recording completed");
      };

      mediaRecorder.start(250);

      recordBtn.disabled = true;
      stopRecordBtn.disabled = false;

      recordStatus.textContent = "Recording...";
      setStatus("Microphone recording");
    } catch (error) {
      console.error(error);

      microphoneStream?.getTracks().forEach((track) => {
        track.stop();
      });

      microphoneStream = null;

      notify(
        "Microphone hin banamne. Permission browser irraa kenni."
      );
    }
  }

  function getRecorderOptions() {
    if (!window.MediaRecorder) return null;

    const types = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm"
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return { mimeType: type };
      }
    }

    return null;
  }

  recordBtn.addEventListener(
    "click",
    startMicrophoneRecording
  );

  stopRecordBtn.addEventListener("click", () => {
    if (
      mediaRecorder &&
      mediaRecorder.state !== "inactive"
    ) {
      mediaRecorder.stop();
    }

    recordBtn.disabled = false;
    stopRecordBtn.disabled = true;

    recordStatus.textContent = "Saving recording...";
  });

  /* -------------------------------------------------------
     VIRTUAL KEYBOARD
  ------------------------------------------------------- */

  const NOTE_FREQUENCIES = {
    "C4": 261.63,
    "C#4": 277.18,
    "D4": 293.66,
    "D#4": 311.13,
    "E4": 329.63,
    "F4": 349.23,
    "F#4": 369.99,
    "G4": 392.00,
    "G#4": 415.30,
    "A4": 440.00,
    "A#4": 466.16,
    "B4": 493.88,
    "C5": 523.25
  };

  async function playKeyboardNote(note) {
    await ensureAudioContext();

    if (keyboardActiveNotes.has(note)) return;

    const frequency = NOTE_FREQUENCIES[note];

    if (!frequency) return;

    const oscillator = audioContext.createOscillator();

    const gain = audioContext.createGain();

    oscillator.type = "triangle";

    oscillator.frequency.value = frequency;

    gain.gain.value = 0;

    oscillator.connect(gain);
    gain.connect(keyboardDestination);

    const now = audioContext.currentTime;

    gain.gain.setTargetAtTime(
      keyboardVolume,
      now,
      0.01
    );

    oscillator.start(now);

    keyboardActiveNotes.set(note, {
      oscillator,
      gain
    });

    const button = document.querySelector(
      '.piano-key[data-note="' + note + '"]'
    );

    button?.classList.add("playing");
  }

  function stopKeyboardNote(note) {
    const active = keyboardActiveNotes.get(note);

    if (!active || !audioContext) return;

    const now = audioContext.currentTime;

    active.gain.gain.cancelScheduledValues(now);

    active.gain.gain.setTargetAtTime(
      0,
      now,
      0.04
    );

    active.oscillator.stop(now + 0.2);

    active.oscillator.onended = () => {
      safeDisconnect(active.oscillator);
      safeDisconnect(active.gain);
    };

    keyboardActiveNotes.delete(note);

    const button = document.querySelector(
      '.piano-key[data-note="' + note + '"]'
    );

    button?.classList.remove("playing");
  }

  document.querySelectorAll(".piano-key").forEach((button) => {
    const note = button.dataset.note;

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();

      playKeyboardNote(note).catch(console.error);
    });

    button.addEventListener("pointerup", () => {
      stopKeyboardNote(note);
    });

    button.addEventListener("pointerleave", () => {
      stopKeyboardNote(note);
    });

    button.addEventListener("pointercancel", () => {
      stopKeyboardNote(note);
    });
  });

  $("keyboardVolume").addEventListener("input", () => {
    keyboardVolume = getNumber("keyboardVolume", 0.3);
  });

  /* -------------------------------------------------------
     WAV ENCODING
  ------------------------------------------------------- */

  function encodeWav(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;

    const sampleRate = audioBuffer.sampleRate;

    const frames = audioBuffer.length;

    const bytesPerSample = 2;

    const blockAlign = channels * bytesPerSample;

    const dataSize = frames * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);

    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
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

    view.setUint32(
      28,
      sampleRate * blockAlign,
      true
    );

    view.setUint16(32, blockAlign, true);

    view.setUint16(34, 16, true);

    writeString(36, "data");

    view.setUint32(40, dataSize, true);

    const channelData = [];

    for (let channel = 0; channel < channels; channel++) {
      channelData.push(
        audioBuffer.getChannelData(channel)
      );
    }

    let offset = 44;

    for (let frame = 0; frame < frames; frame++) {
      for (
        let channel = 0;
        channel < channels;
        channel++
      ) {
        const sample = clamp(
          channelData[channel][frame],
          -1,
          1
        );

        const integer = sample < 0
          ? sample * 32768
          : sample * 32767;

        view.setInt16(
          offset,
          integer,
          true
        );

        offset += 2;
      }
    }

    return new Blob([buffer], {
      type: "audio/wav"
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);

    anchor.click();

    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function exportTrackWav(track) {
    try {
      const blob = encodeWav(track.buffer);

      const filename =
        track.name.replace(/\.[^.]+$/, "") + ".wav";

      downloadBlob(blob, filename);

      notify("Track WAV export jalqabe.");
    } catch (error) {
      console.error(error);

      notify("Track WAV export hin milkoofne.");
    }
  }

  /* -------------------------------------------------------
     OFFLINE MIX RENDER
  ------------------------------------------------------- */

  async function renderMixToWav() {
    if (tracks.length === 0) {
      notify("Music upload godhi dura export hin danda'amu.");
      return;
    }

    if (renderInProgress) {
      notify("Export duraan hojjetamaa jira.");
      return;
    }

    renderInProgress = true;

    setStatus("Rendering audio...");

    try {
      const sampleRate = 44100;

      const longestDuration = Math.max(
        ...tracks.map((track) => track.buffer.duration)
      );

      /*
       * Tail time allows reverb and delay to decay naturally.
       */
      const tailSeconds = Math.min(
        8,
        Math.max(
          getNumber("reverbControl", 0) * 3,
          getNumber("delayControl", 0) * 2
        )
      );

      const length = Math.ceil(
        (longestDuration + tailSeconds) * sampleRate
      );

      const offline = new OfflineAudioContext(
        2,
        length,
        sampleRate
      );

      const outputGain = offline.createGain();

      outputGain.gain.value =
        getNumber("masterVolume", 0.8);

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

      pan.pan.value = getNumber("panControl", 0);

      const compressor = offline.createDynamicsCompressor();

      const compression =
        getNumber("compressorControl", 0.25);

      compressor.threshold.value = -8 - compression * 24;

      compressor.ratio.value = 1 + compression * 9;

      const limiter = offline.createDynamicsCompressor();

      const limiterAmount =
        getNumber("limiterControl", 0.5);

      limiter.threshold.value =
        -1 - limiterAmount * 8;

      limiter.ratio.value =
        4 + limiterAmount * 16;

      low.connect(mid);
      mid.connect(high);
      high.connect(pan);

      pan.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(outputGain);

      outputGain.connect(offline.destination);

      /*
       * Render reverb on a parallel branch.
       */
      const reverbAmount =
        getNumber("reverbControl", 0);

      if (reverbAmount > 0) {
        const convolver = offline.createConvolver();

        convolver.buffer = createImpulseResponse(
          offline,
          2.5,
          2
        );

        const wet = offline.createGain();

        wet.gain.value = reverbAmount * 0.55;

        outputGain.connect(convolver);

        convolver.connect(wet);

        wet.connect(offline.destination);
      }

      /*
       * Render delay on a parallel branch.
       */
      const delayAmount =
        getNumber("delayControl", 0);

      if (delayAmount > 0) {
        const delay = offline.createDelay(2);

        delay.delayTime.value = 0.25;

        const wet = offline.createGain();

        wet.gain.value = delayAmount * 0.5;

        outputGain.connect(delay);

        delay.connect(wet);

        wet.connect(offline.destination);
      }

      const hasSolo = tracks.some(
        (track) => track.solo
      );

      tracks.forEach((track) => {
        if (!isTrackAudible(track)) return;

        if (hasSolo && !track.solo) return;

        const source = offline.createBufferSource();

        source.buffer = track.buffer;

        source.playbackRate.value =
          clamp(track.playbackRate, 0.25, 3);

        const gain = offline.createGain();

        gain.gain.value = track.volume;

        const trackPan = offline.createStereoPanner();

        trackPan.pan.value = track.pan;

        source.connect(gain);

        gain.connect(trackPan);

        trackPan.connect(low);

        source.start(0);
      });

      const renderedBuffer =
        await offline.startRendering();

      const wav = encodeWav(renderedBuffer);

      downloadBlob(wav, "Naol_Music_Studio_Mix.wav");

      notify("WAV export xumurameera.");

      setStatus("Export complete");
    } catch (error) {
      console.error(error);

      notify(
        "Export irratti rakkoon uumame. Faayila xiqqaa yaali."
      );

      setStatus("Export failed");
    } finally {
      renderInProgress = false;
    }
  }

  $("exportBtn").addEventListener(
    "click",
    renderMixToWav
  );

  $("masterExportBtn").addEventListener(
    "click",
    renderMixToWav
  );

  /* -------------------------------------------------------
     PROJECT SAVE / LOAD
  ------------------------------------------------------- */

  function saveProject() {
    if (tracks.length === 0) {
      notify("Jalqaba track tokko yoo xiqqaate upload godhi.");
      return;
    }

    /*
     * Project metadata is saved as JSON.
     * Audio files themselves are not embedded.
     * Original files must be re-imported after reopening.
     */
    const project = {
      application: "Naol Music Studio",
      version: "1.0",
      savedAt: new Date().toISOString(),

      settings: {
        masterVolume: getNumber("masterVolume", 0.8),
        pan: getNumber("panControl", 0),

        bass: getNumber("bassControl", 0),
        mid: getNumber("midControl", 0),
        treble: getNumber("trebleControl", 0),

        reverb: getNumber("reverbControl", 0),
        delay: getNumber("delayControl", 0),

        compressor: getNumber(
          "compressorControl",
          0.25
        ),

        noiseGate: getNumber("noiseGateControl", 0),

        chorus: getNumber("chorusControl", 0),

        limiter: getNumber("limiterControl", 0.5),

        pitch: getNumber("pitchControl", 0),

        speed: getNumber("speedControl", 1)
      },

      tracks: tracks.map((track) => ({
        name: track.name,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo
      }))
    };

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    downloadBlob(blob, "Naol_Music_Project.json");

    notify(
      "Project settings saved. Original audio files also save godhi."
    );
  }

  $("saveProjectBtn").addEventListener(
    "click",
    saveProject
  );

  /* -------------------------------------------------------
     NAVIGATION
  ------------------------------------------------------- */

  const sectionMap = {
    studio: "studioSection",
    effects: "effectsSection",
    vocal: "vocalSection",
    keyboard: "keyboardSection",
    mastering: "masteringSection"
  };

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");

      const targetId =
        sectionMap[button.dataset.section];

      const target = $(targetId);

      target?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });

  /* -------------------------------------------------------
     KEYBOARD RECORD BUTTON
  ------------------------------------------------------- */

  $("recordKeyboardBtn").addEventListener("click", () => {
    notify(
      "Keyboard sound master mix keessatti dhaga'ama. Keyboard recording adda addaa irratti hojjennuuf MIDI recording module dabaluu qabna."
    );
  });

  /* -------------------------------------------------------
     REAL-TIME UI UPDATE
  ------------------------------------------------------- */

  function updatePlaybackUI() {
    const track = tracks.find(
      (item) => item.id === selectedTrackId
    );

    if (track) {
      const position = getCurrentPosition(track);

      currentTime.textContent = formatTime(position);

      if (!seekBar.matches(":active")) {
        seekBar.value = String(position);
      }
    }

    if (masterAnalyser) {
      const values = new Uint8Array(
        masterAnalyser.frequencyBinCount
      );

      masterAnalyser.getByteFrequencyData(values);

      let total = 0;

      for (let i = 0; i < values.length; i++) {
        total += values[i];
      }

      const average = total / Math.max(1, values.length);

      const meter = $("masterMeter");

      if (meter) {
        meter.style.width =
          clamp((average / 255) * 100, 0, 100) + "%";
      }
    }

    if (audioContext) {
      updateEffectControls();
    }

    requestAnimationFrame(updatePlaybackUI);
  }

  updatePlaybackUI();

  /* -------------------------------------------------------
     INITIAL STATE
  ------------------------------------------------------- */

  updateMasterControls();

  updateCurrentTrack();

  setStatus("Studio ready");

  console.log("Naol Music Studio initialized.");
});
