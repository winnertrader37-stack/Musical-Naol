"use strict";

/* =========================================================
   NAOL MUSIC STUDIO
   Complete Audio Mixing, Keyboard Recording & Mastering
   Audio + Recorded Keyboard Events Included in Auto Adjust
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const state = {
    audioContext: null,
    masterGain: null,
    masterAnalyser: null,
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],

    tracks: [],
    activeTrackId: null,
    nextTrackId: 1,

    keyboardEvents: [],
    activeKeyboardNotes: new Map(),
    keyboardRecording: false,
    keyboardRecordStart: 0,
    keyboardMixGain: 1,
    keyboardPlaybackNodes: [],

    isPlaying: false,
    playStartTime: 0,
    playStartOffset: 0,
    animationFrame: null,

    exportInProgress: false,

    effects: {},
    eq: {},
    masterChain: {},
    reverbBuffer: null,

    currentPreset: "balanced",
    toastTimer: null
  };

  const NOTE_NAMES = [
    "C", "C#", "D", "D#", "E", "F",
    "F#", "G", "G#", "A", "A#", "B"
  ];

  const FREQUENCIES = {
    C: 261.6256,
    "C#": 277.1826,
    D: 293.6648,
    "D#": 311.1270,
    E: 329.6276,
    F: 349.2282,
    "F#": 369.9944,
    G: 391.9954,
    "G#": 415.3047,
    A: 440.0000,
    "A#": 466.1638,
    B: 493.8833
  };

  const DEFAULTS = {
    masterVolume: 0.85,
    bass: 0,
    mid: 0,
    treble: 0,
    reverb: 0.12,
    delay: 0.08,
    compressor: 0.55,
    noiseGate: 0.02,
    chorus: 0.08,
    limiter: 0.85,
    pitch: 0,
    speed: 1,
    pan: 0,
    keyboardVolume: 0.65
  };

  /* =========================================================
     GENERAL HELPERS
     ========================================================= */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function numberValue(id, fallback) {
    const element = $(id);
    if (!element) return fallback;

    const value = Number(element.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = String(value);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }

  function notify(message, type = "info") {
    const toast = $("toast");

    if (toast) {
      toast.textContent = message;
      toast.dataset.type = type;
      toast.classList.add("show");

      clearTimeout(state.toastTimer);

      state.toastTimer = setTimeout(() => {
        toast.classList.remove("show");
      }, 3500);
    } else {
      console.log(`[Naol Music Studio] ${message}`);
    }
  }

  function setStatus(message) {
    const status = $("appStatus");
    if (status) status.textContent = message;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeDisconnect(node) {
    if (!node) return;

    try {
      node.disconnect();
    } catch (_) {
      // Already disconnected.
    }
  }

  function getAudioContext() {
    if (!state.audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error(
          "Browser kun Web Audio API hin deeggaru. Chrome ykn Edge fayyadami."
        );
      }

      state.audioContext = new AudioContextClass();
      buildAudioEngine();
    }

    if (state.audioContext.state === "suspended") {
      state.audioContext.resume().catch(() => {});
    }

    return state.audioContext;
  }

  /* =========================================================
     AUDIO ENGINE
     ========================================================= */

  function buildAudioEngine() {
    const ctx = state.audioContext;

    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 150;

    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;

    const treble = ctx.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 5000;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 15;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    const reverbSend = ctx.createGain();
    const reverbReturn = ctx.createGain();

    reverbSend.gain.value = 0;
    reverbReturn.gain.value = 0.35;

    const reverb = ctx.createConvolver();
    reverb.buffer = createImpulseResponse(ctx, 2.2, 2.4);

    reverbSend.connect(reverb);
    reverb.connect(reverbReturn);
    reverbReturn.connect(masterGain);

    const delaySend = ctx.createGain();
    const delay = ctx.createDelay(3);
    const delayFeedback = ctx.createGain();
    const delayReturn = ctx.createGain();

    delay.delayTime.value = 0.28;
    delayFeedback.gain.value = 0.22;
    delaySend.gain.value = 0;
    delayReturn.gain.value = 0.35;

    delaySend.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayReturn);
    delayReturn.connect(masterGain);

    const chorusSend = ctx.createGain();
    const chorusDelay = ctx.createDelay(0.1);
    const chorusLFO = ctx.createOscillator();
    const chorusDepth = ctx.createGain();
    const chorusReturn = ctx.createGain();

    chorusDelay.delayTime.value = 0.025;
    chorusLFO.frequency.value = 0.7;
    chorusDepth.gain.value = 0.008;
    chorusSend.gain.value = 0;
    chorusReturn.gain.value = 0.25;

    chorusLFO.connect(chorusDepth);
    chorusDepth.connect(chorusDelay.delayTime);
    chorusLFO.start();

    chorusSend.connect(chorusDelay);
    chorusDelay.connect(chorusReturn);
    chorusReturn.connect(masterGain);

    bass.connect(mid);
    mid.connect(treble);
    treble.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(masterGain);
    masterGain.connect(ctx.destination);

    state.masterGain = masterGain;
    state.masterAnalyser = analyser;

    state.eq = { bass, mid, treble };
    state.effects = {
      compressor,
      limiter,
      reverbSend,
      reverbReturn,
      delaySend,
      delay,
      delayFeedback,
      delayReturn,
      chorusSend,
      chorusDelay,
      chorusLFO,
      chorusDepth,
      chorusReturn,
      reverb
    };

    state.masterChain = {
      bass,
      mid,
      treble,
      compressor,
      limiter,
      analyser,
      masterGain
    };

    applyAllControls();
    startMasterMeter();
  }

  function createImpulseResponse(ctx, seconds = 2, decay = 2) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

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

  /* =========================================================
     TRACK AUDIO GRAPH
     ========================================================= */

  function createTrackGraph(track) {
    const ctx = getAudioContext();

    track.source = null;
    track.gainNode = ctx.createGain();
    track.panner = ctx.createStereoPanner();

    track.gainNode.gain.value = track.volume;
    track.panner.pan.value = track.pan;

    track.gainNode.connect(track.panner);

    track.panner.connect(state.eq.bass);
    track.panner.connect(state.effects.reverbSend);
    track.panner.connect(state.effects.delaySend);
    track.panner.connect(state.effects.chorusSend);
  }

  function disconnectTrackGraph(track) {
    if (!track) return;

    if (track.source) {
      try {
        track.source.stop();
      } catch (_) {}

      safeDisconnect(track.source);
      track.source = null;
    }

    safeDisconnect(track.gainNode);
    safeDisconnect(track.panner);
  }

  function getTrackDuration(track) {
    if (!track || !track.buffer) return 0;

    return track.buffer.duration;
  }

  function getTotalDuration() {
    let total = 0;

    state.tracks.forEach((track) => {
      total = Math.max(total, getTrackDuration(track));
    });

    state.keyboardEvents.forEach((event) => {
      const end = event.time + Math.max(0.05, event.duration || 0.2);
      total = Math.max(total, end);
    });

    return total;
  }

  /* =========================================================
     UPLOAD AUDIO FILES
     ========================================================= */

  async function decodeAudioFile(file) {
    const ctx = getAudioContext();
    const arrayBuffer = await file.arrayBuffer();

    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  async function addAudioFile(file) {
    if (!file || !file.type.startsWith("audio/")) {
      notify("Maaloo audio file filadhu.", "error");
      return;
    }

    try {
      setStatus("Audio loading...");

      const buffer = await decodeAudioFile(file);

      const track = {
        id: state.nextTrackId++,
        name: file.name,
        file,
        buffer,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
        offset: 0,
        startOffset: 0,
        startedAt: 0,
        source: null,
        gainNode: null,
        panner: null,
        duration: buffer.duration,
        originalRms: analyzeAudioBuffer(buffer).rms,
        autoGain: 1
      };

      createTrackGraph(track);
      state.tracks.push(track);

      if (state.activeTrackId === null) {
        state.activeTrackId = track.id;
      }

      renderTrackList();
      updateTrackDisplay();

      setStatus("Audio ready");
      notify(`${file.name} studio keessatti dabalame.`, "success");
    } catch (error) {
      console.error(error);
      setStatus("Audio loading failed");
      notify("Audio file banamuu hin dandeenye.", "error");
    }
  }

  function renderTrackList() {
    const container = $("trackList");
    if (!container) return;

    container.innerHTML = "";

    if (state.tracks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-tracks";
      empty.textContent = "Audio upload godhi ykn keyboard irratti taphadhu.";
      container.appendChild(empty);
      return;
    }

    state.tracks.forEach((track) => {
      const row = document.createElement("div");
      row.className = "track-item";
      row.dataset.trackId = track.id;

      if (track.id === state.activeTrackId) {
        row.classList.add("active");
      }

      const heading = document.createElement("div");
      heading.className = "track-heading";

      const name = document.createElement("span");
      name.className = "track-name";
      name.textContent = track.name;

      const duration = document.createElement("span");
      duration.className = "track-duration";
      duration.textContent = formatTime(track.duration);

      heading.append(name, duration);

      const controls = document.createElement("div");
      controls.className = "track-controls";

      const volumeLabel = document.createElement("label");
      volumeLabel.textContent = "Volume ";

      const volume = document.createElement("input");
      volume.type = "range";
      volume.min = "0";
      volume.max = "1.5";
      volume.step = "0.01";
      volume.value = String(track.volume);
      volume.setAttribute("aria-label", `Volume ${track.name}`);

      volume.addEventListener("input", () => {
        track.volume = Number(volume.value);
        if (track.gainNode) {
          track.gainNode.gain.setTargetAtTime(
            track.muted ? 0 : track.volume * track.autoGain,
            getAudioContext().currentTime,
            0.015
          );
        }
      });

      volumeLabel.appendChild(volume);

      const panLabel = document.createElement("label");
      panLabel.textContent = "Pan ";

      const pan = document.createElement("input");
      pan.type = "range";
      pan.min = "-1";
      pan.max = "1";
      pan.step = "0.01";
      pan.value = String(track.pan);
      pan.setAttribute("aria-label", `Pan ${track.name}`);

      pan.addEventListener("input", () => {
        track.pan = Number(pan.value);
        if (track.panner) {
          track.panner.pan.setTargetAtTime(
            track.pan,
            getAudioContext().currentTime,
            0.015
          );
        }
      });

      panLabel.appendChild(pan);

      const muteButton = document.createElement("button");
      muteButton.type = "button";
      muteButton.textContent = track.muted ? "Unmute" : "Mute";

      muteButton.addEventListener("click", (event) => {
        event.stopPropagation();

        track.muted = !track.muted;

        if (track.gainNode) {
          track.gainNode.gain.setTargetAtTime(
            track.muted ? 0 : track.volume * track.autoGain,
            getAudioContext().currentTime,
            0.015
          );
        }

        renderTrackList();
      });

      const soloButton = document.createElement("button");
      soloButton.type = "button";
      soloButton.textContent = track.solo ? "Solo ✓" : "Solo";

      soloButton.addEventListener("click", (event) => {
        event.stopPropagation();

        track.solo = !track.solo;

        const anySolo = state.tracks.some((item) => item.solo);

        state.tracks.forEach((item) => {
          const shouldMute =
            item.muted || (anySolo && !item.solo);

          if (item.gainNode) {
            item.gainNode.gain.setTargetAtTime(
              shouldMute ? 0 : item.volume * item.autoGain,
              getAudioContext().currentTime,
              0.015
            );
          }
        });

        renderTrackList();
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "Remove";

      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        removeTrack(track.id);
      });

      controls.append(
        volumeLabel,
        panLabel,
        muteButton,
        soloButton,
        removeButton
      );

      row.append(heading, controls);

      row.addEventListener("click", () => {
        state.activeTrackId = track.id;
        renderTrackList();
        updateTrackDisplay();
      });

      container.appendChild(row);
    });
  }

  function removeTrack(trackId) {
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) return;

    disconnectTrackGraph(track);

    state.tracks = state.tracks.filter((item) => item.id !== trackId);

    if (state.activeTrackId === trackId) {
      state.activeTrackId =
        state.tracks.length > 0 ? state.tracks[0].id : null;
    }

    renderTrackList();
    updateTrackDisplay();
    notify("Track haqameera.", "info");
  }

  function updateTrackDisplay() {
    const track = state.tracks.find(
      (item) => item.id === state.activeTrackId
    );

    const nameElement = $("currentTrackName");
    const durationElement = $("duration");

    if (nameElement) {
      nameElement.textContent = track
        ? track.name
        : state.keyboardEvents.length
          ? "Keyboard Performance"
          : "No track selected";
    }

    if (durationElement) {
      durationElement.textContent = formatTime(getTotalDuration());
    }
  }

  /* =========================================================
     TRACK PLAYBACK
     ========================================================= */

  function stopTrackSources() {
    state.tracks.forEach((track) => {
      if (track.source) {
        try {
          track.source.stop();
        } catch (_) {}

        safeDisconnect(track.source);
        track.source = null;
      }
    });
  }

  function playTrackFrom(track, offset) {
    const ctx = getAudioContext();

    if (!track || !track.buffer || offset >= track.buffer.duration) {
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = track.buffer;

    const speed = clamp(numberValue("speedControl", 1), 0.5, 2);
    source.playbackRate.value = speed;

    source.connect(track.gainNode);

    track.source = source;
    track.startedAt = ctx.currentTime;
    track.startOffset = offset;

    const anySolo = state.tracks.some((item) => item.solo);
    const shouldMute = track.muted || (anySolo && !track.solo);

    track.gainNode.gain.setTargetAtTime(
      shouldMute ? 0 : track.volume * track.autoGain,
      ctx.currentTime,
      0.015
    );

    source.onended = () => {
      if (track.source === source) {
        track.source = null;
      }
    };

    source.start(0, offset);
  }

  function getCurrentPlaybackTime() {
    if (!state.isPlaying || !state.audioContext) {
      return state.playStartOffset;
    }

    const elapsed = state.audioContext.currentTime - state.playStartTime;
    const speed = clamp(numberValue("speedControl", 1), 0.5, 2);

    return state.playStartOffset + elapsed * speed;
  }

  function playAllTracks() {
    if (state.isPlaying) return;

    const ctx = getAudioContext();

    if (!state.tracks.length && !state.keyboardEvents.length) {
      notify("Duraan audio ykn keyboard performance hin jiru.", "error");
      return;
    }

    state.isPlaying = true;
    state.playStartTime = ctx.currentTime;

    state.tracks.forEach((track) => {
      playTrackFrom(track, state.playStartOffset);
    });

    scheduleKeyboardPerformance(state.playStartOffset);

    setStatus("Playing");
    updateTransportButtons();
    updatePlaybackUI();
  }

  function pauseAllTracks() {
    if (!state.isPlaying) return;

    state.playStartOffset = getCurrentPlaybackTime();
    state.isPlaying = false;

    stopTrackSources();
    stopKeyboardPlayback();

    if (state.animationFrame) {
      cancelAnimationFrame(state.animationFrame);
      state.animationFrame = null;
    }

    setStatus("Paused");
    updateTransportButtons();
  }

  function stopAllTracks() {
    state.isPlaying = false;
    state.playStartOffset = 0;

    stopTrackSources();
    stopKeyboardPlayback();

    if (state.animationFrame) {
      cancelAnimationFrame(state.animationFrame);
      state.animationFrame = null;
    }

    updateTransportButtons();
    updatePlaybackUI();
    setStatus("Stopped");
  }

  function updateTransportButtons() {
    const play = $("playBtn");
    const pause = $("pauseBtn");

    if (play) play.disabled = state.isPlaying;
    if (pause) pause.disabled = !state.isPlaying;
  }

  function updatePlaybackUI() {
    if (!state.isPlaying) return;

    const currentTime = getCurrentPlaybackTime();
    const totalDuration = getTotalDuration();

    const currentTimeElement = $("currentTime");
    const durationElement = $("duration");
    const seekBar = $("seekBar");

    if (currentTimeElement) {
      currentTimeElement.textContent = formatTime(currentTime);
    }

    if (durationElement) {
      durationElement.textContent = formatTime(totalDuration);
    }

    if (seekBar && totalDuration > 0) {
      seekBar.value = String((currentTime / totalDuration) * 100);
    }

    if (currentTime >= totalDuration) {
      stopAllTracks();
      return;
    }

    state.animationFrame = requestAnimationFrame(updatePlaybackUI);
  }

  /* =========================================================
     KEYBOARD SYNTH
     ========================================================= */

  function noteFrequency(note, octave) {
    const base = FREQUENCIES[note] || 440;
    return base * Math.pow(2, octave - 4);
  }

  function makeKeyboardVoice(frequency, volume = 0.6, destination = null) {
    const ctx = getAudioContext();

    const oscillator = ctx.createOscillator();
    const harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    const voiceGain = ctx.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;

    harmonic.type = "sine";
    harmonic.frequency.value = frequency * 2;

    harmonicGain.gain.value = 0.12;
    voiceGain.gain.value = 0;

    oscillator.connect(voiceGain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(voiceGain);

    voiceGain.connect(destination || state.eq.bass);

    const now = ctx.currentTime;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, volume),
      now + 0.025
    );

    oscillator.start(now);
    harmonic.start(now);

    return {
      oscillator,
      harmonic,
      gain: voiceGain,
      stop(release = 0.12) {
        const t = ctx.currentTime;

        try {
          voiceGain.gain.cancelScheduledValues(t);
          voiceGain.gain.setTargetAtTime(0.0001, t, Math.max(0.01, release / 4));

          oscillator.stop(t + release);
          harmonic.stop(t + release);
        } catch (_) {}
      }
    };
  }

  function startKeyboardNote(note, octave = 4, keyElement = null) {
    const ctx = getAudioContext();
    const keyId = `${note}${octave}`;

    if (state.activeKeyboardNotes.has(keyId)) return;

    const frequency = noteFrequency(note, octave);
    const volume = clamp(numberValue("keyboardVolume", DEFAULTS.keyboardVolume), 0, 1);

    const voice = makeKeyboardVoice(
      frequency,
      volume * state.keyboardMixGain
    );

    const activeNote = {
      note,
      octave,
      frequency,
      volume,
      voice,
      startedAt: ctx.currentTime,
      recordEvent: null,
      keyElement
    };

    if (state.keyboardRecording) {
      activeNote.recordEvent = {
        note: keyId,
        frequency,
        time: Math.max(0, ctx.currentTime - state.keyboardRecordStart),
        duration: 0,
        volume
      };

      state.keyboardEvents.push(activeNote.recordEvent);
    }

    state.activeKeyboardNotes.set(keyId, activeNote);

    if (keyElement) keyElement.classList.add("active");
  }

  function stopKeyboardNote(note, octave = 4) {
    const keyId = `${note}${octave}`;
    const active = state.activeKeyboardNotes.get(keyId);

    if (!active) return;

    const ctx = getAudioContext();
    const duration = Math.max(0.06, ctx.currentTime - active.startedAt);

    if (active.recordEvent) {
      active.recordEvent.duration = duration;
    }

    active.voice.stop(0.12);

    if (active.keyElement) {
      active.keyElement.classList.remove("active");
    }

    state.activeKeyboardNotes.delete(keyId);
  }

  function stopAllActiveKeyboardNotes() {
    [...state.activeKeyboardNotes.keys()].forEach((keyId) => {
      const match = keyId.match(/^(.+)(\d+)$/);

      if (match) {
        stopKeyboardNote(match[1], Number(match[2]));
      }
    });
  }

  function buildVirtualKeyboard() {
    const container = $("pianoKeyboard");
    if (!container) return;

    if (container.children.length > 0) {
      attachExistingKeyboardKeys(container);
      return;
    }

    container.innerHTML = "";

    const octaves = [3, 4, 5];

    octaves.forEach((octave) => {
      const octaveRow = document.createElement("div");
      octaveRow.className = "piano-octave";

      NOTE_NAMES.forEach((note) => {
        const key = document.createElement("button");
        key.type = "button";
        key.className =
          "piano-key " + (note.includes("#") ? "black-key" : "white-key");

        key.dataset.note = note;
        key.dataset.octave = String(octave);
        key.textContent = `${note}${octave}`;

        key.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          startKeyboardNote(note, octave, key);
        });

        const release = () => stopKeyboardNote(note, octave);

        key.addEventListener("pointerup", release);
        key.addEventListener("pointerleave", (event) => {
          if (event.buttons) release();
        });
        key.addEventListener("pointercancel", release);

        octaveRow.appendChild(key);
      });

      container.appendChild(octaveRow);
    });
  }

  function attachExistingKeyboardKeys(container) {
    const keys = container.querySelectorAll(
      "[data-note], .piano-key, .key"
    );

    keys.forEach((key) => {
      if (key.dataset.naolBound === "true") return;

      const rawNote =
        key.dataset.note ||
        key.getAttribute("data-key") ||
        key.textContent.trim();

      const match = rawNote.match(/^(C#|D#|F#|G#|A#|C|D|E|F|G|A|B)(-?\d+)?$/i);

      if (!match) return;

      const note = match[1].toUpperCase();
      const octave = Number(
        key.dataset.octave || match[2] || 4
      );

      key.dataset.naolBound = "true";

      key.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        startKeyboardNote(note, octave, key);
      });

      const release = () => stopKeyboardNote(note, octave);

      key.addEventListener("pointerup", release);
      key.addEventListener("pointerleave", (event) => {
        if (event.buttons) release();
      });
      key.addEventListener("pointercancel", release);
    });
  }

  /* =========================================================
     KEYBOARD PERFORMANCE PLAYBACK
     ========================================================= */

  function stopKeyboardPlayback() {
    state.keyboardPlaybackNodes.forEach((node) => {
      try {
        node.stop();
      } catch (_) {}

      safeDisconnect(node);
    });

    state.keyboardPlaybackNodes = [];
  }

  function scheduleKeyboardPerformance(offset = 0, destination = null, scale = 1) {
    const ctx = getAudioContext();
    const target = destination || state.eq.bass;

    state.keyboardEvents.forEach((event) => {
      const start = Number(event.time) || 0;
      const duration = Math.max(0.06, Number(event.duration) || 0.2);
      const end = start + duration;

      if (end <= offset) return;

      const eventStart = Math.max(0, start - offset);
      const eventDuration = Math.max(0.04, end - Math.max(start, offset));

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = Number(event.frequency) || 440;

      const volume = clamp(
        (Number(event.volume) || 0.5) * state.keyboardMixGain * scale,
        0,
        1
      );

      gain.gain.setValueAtTime(0.0001, ctx.currentTime + eventStart);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume),
        ctx.currentTime + eventStart + 0.025
      );

      gain.gain.setTargetAtTime(
        0.0001,
        ctx.currentTime + eventStart + Math.max(0.03, eventDuration - 0.03),
        0.02
      );

      oscillator.connect(gain);
      gain.connect(target);

      oscillator.start(ctx.currentTime + eventStart);
      oscillator.stop(ctx.currentTime + eventStart + eventDuration + 0.12);

      state.keyboardPlaybackNodes.push(oscillator, gain);
    });
  }

  /* =========================================================
     KEYBOARD RECORDING
     ========================================================= */

  function startKeyboardRecording() {
    stopAllActiveKeyboardNotes();

    state.keyboardEvents = [];
    state.keyboardRecording = true;
    state.keyboardRecordStart = getAudioContext().currentTime;

    const button = $("recordKeyboardBtn");
    if (button) button.textContent = "Stop Keyboard Recording";

    notify("Keyboard recording jalqabame. Amma piano taphadhu.", "success");
    updateTrackDisplay();
  }

  function stopKeyboardRecording() {
    stopAllActiveKeyboardNotes();
    state.keyboardRecording = false;

    const button = $("recordKeyboardBtn");
    if (button) button.textContent = "Record Keyboard";

    state.keyboardEvents = state.keyboardEvents.filter((event) => {
      event.duration = Math.max(0.06, Number(event.duration) || 0.2);
      return Number.isFinite(event.frequency) && event.frequency > 0;
    });

    updateTrackDisplay();

    notify(
      `Keyboard performance ${state.keyboardEvents.length} note qabatee jira.`,
      "success"
    );
  }

  /* =========================================================
     AUDIO ANALYSIS
     ========================================================= */

  function analyzeAudioBuffer(buffer) {
    if (!buffer || !buffer.numberOfChannels || !buffer.length) {
      return {
        rms: 0,
        peak: 0,
        average: 0,
        duration: 0
      };
    }

    let sumSquares = 0;
    let peak = 0;
    let count = 0;

    const stride = Math.max(
      1,
      Math.floor(buffer.length / 250000)
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);

      for (let i = 0; i < data.length; i += stride) {
        const sample = data[i];
        const absolute = Math.abs(sample);

        sumSquares += sample * sample;
        peak = Math.max(peak, absolute);
        count++;
      }
    }

    const rms = count ? Math.sqrt(sumSquares / count) : 0;

    return {
      rms,
      peak,
      average: rms,
      duration: buffer.duration
    };
  }

  function analyzeKeyboardPerformance() {
    if (!state.keyboardEvents.length) {
      return {
        rms: 0,
        peak: 0,
        average: 0,
        duration: 0,
        noteCount: 0
      };
    }

    let estimatedEnergy = 0;
    let estimatedPeak = 0;
    let totalDuration = 0;

    state.keyboardEvents.forEach((event) => {
      const volume = clamp(Number(event.volume) || 0.5, 0, 1);
      const duration = Math.max(0.06, Number(event.duration) || 0.2);

      estimatedEnergy += volume * volume * duration;
      estimatedPeak = Math.max(estimatedPeak, volume);
      totalDuration = Math.max(
        totalDuration,
        (Number(event.time) || 0) + duration
      );
    });

    const rms = totalDuration > 0
      ? Math.sqrt(estimatedEnergy / totalDuration) * 0.35
      : 0;

    return {
      rms,
      peak: estimatedPeak * 0.35,
      average: rms,
      duration: totalDuration,
      noteCount: state.keyboardEvents.length
    };
  }

  /* =========================================================
     AUTO ADJUST ALL
     Includes audio tracks AND recorded keyboard performance
     ========================================================= */

  function autoAdjustAll() {
    getAudioContext();

    const tracks = state.tracks.filter((track) => track.buffer);
    const keyboardAnalysis = analyzeKeyboardPerformance();

    if (!tracks.length && !state.keyboardEvents.length) {
      notify(
        "Auto Adjust gochuuf duraan audio upload godhi ykn keyboard waraabi.",
        "error"
      );
      return;
    }

    const activeAnalyses = tracks.map((track) => ({
      track,
      analysis: analyzeAudioBuffer(track.buffer)
    }));

    const allRms = activeAnalyses
      .map((item) => item.analysis.rms)
      .filter((rms) => rms > 0);

    if (keyboardAnalysis.rms > 0) {
      allRms.push(keyboardAnalysis.rms);
    }

    const targetRms = 0.16;
    const meanRms = allRms.length
      ? Math.sqrt(
          allRms.reduce((sum, rms) => sum + rms * rms, 0) /
          allRms.length
        )
      : 0.1;

    activeAnalyses.forEach(({ track, analysis }) => {
      if (analysis.rms <= 0.00001) {
        track.autoGain = 1;
        return;
      }

      const desired = targetRms / analysis.rms;

      track.autoGain = clamp(desired, 0.25, 2.5);

      if (track.gainNode) {
        track.gainNode.gain.setTargetAtTime(
          track.muted ? 0 : track.volume * track.autoGain,
          state.audioContext.currentTime,
          0.05
        );
      }
    });

    /*
      Keyboard volume is adjusted separately.
      This is important: keyboard is now a real part of
      the mix and WAV export, not only a visual recording.
    */
    if (state.keyboardEvents.length && keyboardAnalysis.rms > 0.00001) {
      const keyboardDesired = targetRms / keyboardAnalysis.rms;
      state.keyboardMixGain = clamp(keyboardDesired, 0.3, 2.0);
    } else {
      state.keyboardMixGain = 1;
    }

    /*
      Small balanced EQ changes; these are not a substitute
      for listening or professional mastering.
    */
    const overallRms = meanRms;

    let bassDb = 0;
    let midDb = 0;
    let trebleDb = 0;

    if (overallRms < 0.06) {
      bassDb = 1;
      midDb = 0.5;
      trebleDb = 1;
    } else if (overallRms > 0.25) {
      bassDb = -0.5;
      midDb = -0.5;
      trebleDb = 0;
    }

    setValue("bassControl", bassDb);
    setValue("midControl", midDb);
    setValue("trebleControl", trebleDb);
    setValue("compressorControl", 0.6);
    setValue("limiterControl", 0.85);
    setValue("reverbControl", state.keyboardEvents.length ? 0.1 : 0.08);
    setValue("delayControl", 0.06);
    setValue("chorusControl", state.keyboardEvents.length ? 0.08 : 0.04);
    setValue("noiseGateControl", 0.01);
    setValue("masterVolume", 0.8);

    applyAllControls();
    renderTrackList();

    const message = state.keyboardEvents.length
      ? `Auto Adjust tamam. Audio tracks ${tracks.length}, keyboard notes ${state.keyboardEvents.length} waliin mix godhame.`
      : `Auto Adjust tamam. Audio tracks ${tracks.length} sirreeffaman. Keyboard waraabame hin jiru.`;

    notify(message, "success");
    setStatus("Auto Adjust complete");
  }

  function insertAutoAdjustButton() {
    const mastering = $("masteringSection") || $("studioSection");

    if (!mastering || $("autoAdjustAllBtn")) return;

    const button = document.createElement("button");
    button.id = "autoAdjustAllBtn";
    button.type = "button";
    button.className = "auto-adjust-all-btn";
    button.textContent = "✨ AUTO ADJUST ALL";

    button.style.cssText = [
      "display:block",
      "width:100%",
      "max-width:420px",
      "margin:16px auto",
      "padding:14px 20px",
      "border:0",
      "border-radius:14px",
      "font-weight:800",
      "font-size:16px",
      "cursor:pointer",
      "color:#fff",
      "background:linear-gradient(135deg,#7c3aed,#06b6d4)",
      "box-shadow:0 8px 25px rgba(6,182,212,.22)"
    ].join(";");

    button.addEventListener("click", autoAdjustAll);

    mastering.prepend(button);
  }

  /* =========================================================
     EFFECTS AND MIXER CONTROLS
     ========================================================= */

  function applyAllControls() {
    if (!state.audioContext || !state.masterGain) return;

    const ctx = state.audioContext;
    const now = ctx.currentTime;

    const bass = clamp(numberValue("bassControl", 0), -12, 12);
    const mid = clamp(numberValue("midControl", 0), -12, 12);
    const treble = clamp(numberValue("trebleControl", 0), -12, 12);

    state.eq.bass.gain.setTargetAtTime(bass, now, 0.03);
    state.eq.mid.gain.setTargetAtTime(mid, now, 0.03);
    state.eq.treble.gain.setTargetAtTime(treble, now, 0.03);

    const masterVolume = clamp(
      numberValue("masterVolume", DEFAULTS.masterVolume),
      0,
      1
    );

    state.masterGain.gain.setTargetAtTime(
      masterVolume,
      now,
      0.03
    );

    const compressorAmount = clamp(
      numberValue("compressorControl", 0.55),
      0,
      1
    );

    state.effects.compressor.threshold.setTargetAtTime(
      -8 - compressorAmount * 22,
      now,
      0.03
    );

    state.effects.compressor.ratio.setTargetAtTime(
      1 + compressorAmount * 7,
      now,
      0.03
    );

    const limiterAmount = clamp(
      numberValue("limiterControl", 0.85),
      0,
      1
    );

    state.effects.limiter.threshold.setTargetAtTime(
      -1 - limiterAmount * 5,
      now,
      0.03
    );

    state.effects.limiter.ratio.setTargetAtTime(
      8 + limiterAmount * 12,
      now,
      0.03
    );

    state.effects.reverbSend.gain.setTargetAtTime(
      clamp(numberValue("reverbControl", 0.12), 0, 1) * 0.5,
      now,
      0.03
    );

    state.effects.delaySend.gain.setTargetAtTime(
      clamp(numberValue("delayControl", 0.08), 0, 1) * 0.45,
      now,
      0.03
    );

    state.effects.chorusSend.gain.setTargetAtTime(
      clamp(numberValue("chorusControl", 0.08), 0, 1) * 0.5,
      now,
      0.03
    );

    state.effects.delayFeedback.gain.setTargetAtTime(
      clamp(numberValue("delayControl", 0.08), 0, 1) * 0.4,
      now,
      0.03
    );

    const pan = clamp(numberValue("panControl", 0), -1, 1);

    state.tracks.forEach((track) => {
      if (track.panner) {
        track.pan = pan;
        track.panner.pan.setTargetAtTime(pan, now, 0.03);
      }
    });
  }

  function connectControl(id) {
    const element = $(id);
    if (!element) return;

    element.addEventListener("input", () => {
      try {
        getAudioContext();
        applyAllControls();
      } catch (error) {
        console.error(error);
      }
    });
  }

  function resetEffects() {
    setValue("masterVolume", DEFAULTS.masterVolume);
    setValue("bassControl", DEFAULTS.bass);
    setValue("midControl", DEFAULTS.mid);
    setValue("trebleControl", DEFAULTS.treble);
    setValue("reverbControl", DEFAULTS.reverb);
    setValue("delayControl", DEFAULTS.delay);
    setValue("compressorControl", DEFAULTS.compressor);
    setValue("noiseGateControl", DEFAULTS.noiseGate);
    setValue("chorusControl", DEFAULTS.chorus);
    setValue("limiterControl", DEFAULTS.limiter);
    setValue("pitchControl", DEFAULTS.pitch);
    setValue("speedControl", DEFAULTS.speed);
    setValue("panControl", DEFAULTS.pan);
    setValue("keyboardVolume", DEFAULTS.keyboardVolume);

    state.tracks.forEach((track) => {
      track.volume = 1;
      track.pan = 0;
      track.autoGain = 1;
      track.muted = false;
      track.solo = false;

      if (track.gainNode) track.gainNode.gain.value = 1;
      if (track.panner) track.panner.pan.value = 0;
    });

    state.keyboardMixGain = 1;

    if (state.audioContext) applyAllControls();

    renderTrackList();
    notify("Effects fi mixer settings reset godhaman.", "success");
  }

  function applyVocalPreset() {
    const preset = $("vocalPreset");
    const choice = preset ? preset.value : "balanced";

    const presets = {
      balanced: {
        bass: 0,
        mid: 1,
        treble: 1.5,
        reverb: 0.12,
        delay: 0.04,
        compressor: 0.6,
        noiseGate: 0.02,
        chorus: 0.03,
        limiter: 0.85
      },

      clear: {
        bass: -1,
        mid: 1.5,
        treble: 2,
        reverb: 0.06,
        delay: 0.02,
        compressor: 0.7,
        noiseGate: 0.025,
        chorus: 0,
        limiter: 0.9
      },

      warm: {
        bass: 2,
        mid: 0.5,
        treble: -0.5,
        reverb: 0.1,
        delay: 0.05,
        compressor: 0.55,
        noiseGate: 0.015,
        chorus: 0.05,
        limiter: 0.85
      },

      studio: {
        bass: 0,
        mid: 1,
        treble: 1,
        reverb: 0.15,
        delay: 0.08,
        compressor: 0.75,
        noiseGate: 0.02,
        chorus: 0.04,
        limiter: 0.9
      }
    };

    const settings = presets[choice] || presets.balanced;

    setValue("bassControl", settings.bass);
    setValue("midControl", settings.mid);
    setValue("trebleControl", settings.treble);
    setValue("reverbControl", settings.reverb);
    setValue("delayControl", settings.delay);
    setValue("compressorControl", settings.compressor);
    setValue("noiseGateControl", settings.noiseGate);
    setValue("chorusControl", settings.chorus);
    setValue("limiterControl", settings.limiter);

    getAudioContext();
    applyAllControls();

    notify(`Preset "${choice}" hojii irra oole.`, "success");
  }

  /* =========================================================
     KEYBOARD + AUDIO MIX WAV EXPORT
     ========================================================= */

  async function exportWav() {
    if (state.exportInProgress) {
      notify("Export amma hojjetamaa jira.", "info");
      return;
    }

    const hasTracks = state.tracks.some((track) => track.buffer);
    const hasKeyboard = state.keyboardEvents.length > 0;

    if (!hasTracks && !hasKeyboard) {
      notify("Export gochuuf audio ykn keyboard recording barbaachisa.", "error");
      return;
    }

    state.exportInProgress = true;
    setStatus("Preparing WAV mix...");

    try {
      const sampleRate = 44100;
      const duration = Math.min(
        600,
        Math.max(1, getTotalDuration() + 0.5)
      );

      const frameCount = Math.ceil(duration * sampleRate);

      const OfflineContext =
        window.OfflineAudioContext || window.webkitOfflineAudioContext;

      if (!OfflineContext) {
        throw new Error("OfflineAudioContext hin deeggaramu.");
      }

      const offline = new OfflineContext(2, frameCount, sampleRate);

      const master = offline.createGain();
      master.gain.value = clamp(
        numberValue("masterVolume", DEFAULTS.masterVolume),
        0,
        1
      );

      const bass = offline.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 150;
      bass.gain.value = clamp(numberValue("bassControl", 0), -12, 12);

      const mid = offline.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.8;
      mid.gain.value = clamp(numberValue("midControl", 0), -12, 12);

      const treble = offline.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 5000;
      treble.gain.value = clamp(numberValue("trebleControl", 0), -12, 12);

      const compressor = offline.createDynamicsCompressor();
      const compressionAmount = clamp(
        numberValue("compressorControl", 0.55),
        0,
        1
      );

      compressor.threshold.value = -8 - compressionAmount * 22;
      compressor.ratio.value = 1 + compressionAmount * 7;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.18;

      const limiter = offline.createDynamicsCompressor();
      const limiterAmount = clamp(
        numberValue("limiterControl", 0.85),
        0,
        1
      );

      limiter.threshold.value = -1 - limiterAmount * 5;
      limiter.ratio.value = 8 + limiterAmount * 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;

      bass.connect(mid);
      mid.connect(treble);
      treble.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(master);
      master.connect(offline.destination);

      /*
        Upload audio tracks are rendered with their own gain
        and pan settings, in the same offline mix.
      */
      const anySolo = state.tracks.some((track) => track.solo);

      state.tracks.forEach((track) => {
        if (!track.buffer) return;
        if (track.muted || (anySolo && !track.solo)) return;

        const source = offline.createBufferSource();
        const gain = offline.createGain();
        const panner = offline.createStereoPanner();

        source.buffer = track.buffer;
        source.playbackRate.value = clamp(
          numberValue("speedControl", 1),
          0.5,
          2
        );

        gain.gain.value = clamp(
          track.volume * track.autoGain,
          0,
          3
        );

        panner.pan.value = clamp(track.pan, -1, 1);

        source.connect(gain);
        gain.connect(panner);
        panner.connect(bass);

        source.start(0);
      });

      /*
        IMPORTANT FIX:
        Recorded keyboard notes are rendered into the SAME
        OfflineAudioContext as uploaded audio tracks.
        So the exported WAV contains both sources.
      */
      state.keyboardEvents.forEach((event) => {
        const startTime = Math.max(0, Number(event.time) || 0);
        const noteDuration = Math.max(
          0.06,
          Number(event.duration) || 0.2
        );

        if (startTime >= duration) return;

        const oscillator = offline.createOscillator();
        const harmonic = offline.createOscillator();
        const harmonicGain = offline.createGain();
        const noteGain = offline.createGain();
        const panner = offline.createStereoPanner();

        const frequency = Number(event.frequency) || 440;

        oscillator.type = "triangle";
        oscillator.frequency.value = frequency;

        harmonic.type = "sine";
        harmonic.frequency.value = frequency * 2;
        harmonicGain.gain.value = 0.1;

        const baseVolume = clamp(
          (Number(event.volume) || 0.5) * state.keyboardMixGain,
          0,
          1
        );

        noteGain.gain.setValueAtTime(
          0.0001,
          startTime
        );

        noteGain.gain.exponentialRampToValueAtTime(
          Math.max(0.0002, baseVolume),
          startTime + Math.min(0.025, noteDuration / 3)
        );

        const releaseStart = Math.max(
          startTime + 0.03,
          startTime + noteDuration - 0.04
        );

        noteGain.gain.setTargetAtTime(
          0.0001,
          releaseStart,
          0.02
        );

        panner.pan.value = 0;

        oscillator.connect(noteGain);
        harmonic.connect(harmonicGain);
        harmonicGain.connect(noteGain);

        noteGain.connect(panner);
        panner.connect(bass);

        oscillator.start(startTime);
        harmonic.start(startTime);

        const stopTime = Math.min(
          duration,
          startTime + noteDuration + 0.15
        );

        oscillator.stop(Math.max(startTime + 0.05, stopTime));
        harmonic.stop(Math.max(startTime + 0.05, stopTime));
      });

      const renderedBuffer = await offline.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);

      downloadBlob(wavBlob, "Naol-Music-Studio-Mix.wav");

      setStatus("WAV export complete");

      notify(
        `WAV mix xumurame. Audio tracks ${state.tracks.length}, keyboard notes ${state.keyboardEvents.length}.`,
        "success"
      );
    } catch (error) {
      console.error(error);
      setStatus("WAV export failed");
      notify(`WAV export hin milkoofne: ${error.message}`, "error");
    } finally {
      state.exportInProgress = false;
    }
  }

  function audioBufferToWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;

    const interleaved = new Float32Array(length * channels);

    if (channels === 1) {
      interleaved.set(buffer.getChannelData(0));
    } else {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);

      for (let i = 0; i < length; i++) {
        interleaved[i * 2] = left[i];
        interleaved[i * 2 + 1] = right[i];
      }
    }

    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = interleaved.length * bytesPerSample;

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

    let offset = 44;

    for (let i = 0; i < interleaved.length; i++) {
      const sample = clamp(interleaved[i], -1, 1);

      view.setInt16(
        offset,
        sample < 0 ? sample * 32768 : sample * 32767,
        true
      );

      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  /* =========================================================
     WEBM EXPORT
     ========================================================= */

  async function exportWebM() {
    const ctx = getAudioContext();

    if (state.exportInProgress) return;

    if (!state.tracks.length && !state.keyboardEvents.length) {
      notify("Export gochuuf audio ykn keyboard recording barbaachisa.", "error");
      return;
    }

    if (!window.MediaRecorder || !ctx.createMediaStreamDestination) {
      notify("Browser kun WebM export hin deeggaru. WAV export yaali.", "error");
      return;
    }

    state.exportInProgress = true;

    let streamDestination;

    try {
      stopAllTracks();

      streamDestination = ctx.createMediaStreamDestination();
      state.masterGain.connect(streamDestination);

      const recorder = new MediaRecorder(streamDestination.stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm"
      });

      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });

        downloadBlob(blob, "Naol-Music-Studio-Mix.webm");

        safeDisconnect(streamDestination);

        state.exportInProgress = false;
        setStatus("WebM export complete");

        notify("WebM mix export xumurame.", "success");
      };

      recorder.start();

      state.isPlaying = true;
      state.playStartOffset = 0;
      state.playStartTime = ctx.currentTime;

      state.tracks.forEach((track) => {
        playTrackFrom(track, 0);
      });

      scheduleKeyboardPerformance(0);

      setStatus("Recording mix to WebM...");

      setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }

        stopAllTracks();
      }, Math.max(1000, getTotalDuration() * 1000 + 250));
    } catch (error) {
      console.error(error);

      if (streamDestination) {
        safeDisconnect(streamDestination);
      }

      state.exportInProgress = false;
      setStatus("WebM export failed");

      notify(`WebM export hin milkoofne: ${error.message}`, "error");
    }
  }

  /* =========================================================
     MICROPHONE RECORDING
     ========================================================= */

  async function startMicrophoneRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify("Browser kee microphone recording hin deeggaru.", "error");
      return;
    }

    try {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        }
      });

      state.recordedChunks = [];

      const preferredMimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      state.mediaRecorder = new MediaRecorder(state.mediaStream, {
        mimeType: preferredMimeType
      });

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.recordedChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordedChunks, {
          type: state.mediaRecorder.mimeType
        });

        downloadBlob(blob, "Naol-Microphone-Recording.webm");

        if (state.mediaStream) {
          state.mediaStream.getTracks().forEach((track) => track.stop());
          state.mediaStream = null;
        }

        const status = $("recordStatus");
        if (status) status.textContent = "Recording saved";

        notify("Microphone recording save godhame.", "success");
      };

      state.mediaRecorder.start();

      const status = $("recordStatus");
      if (status) status.textContent = "Recording...";

      const button = $("recordBtn");
      if (button) button.disabled = true;

      const stopButton = $("stopRecordBtn");
      if (stopButton) stopButton.disabled = false;

      notify("Microphone recording jalqabame.", "success");
    } catch (error) {
      console.error(error);
      notify("Microphone argachuuf hayyama kenni.", "error");
    }
  }

  function stopMicrophoneRecording() {
    if (
      state.mediaRecorder &&
      state.mediaRecorder.state !== "inactive"
    ) {
      state.mediaRecorder.stop();
    }

    const button = $("recordBtn");
    if (button) button.disabled = false;

    const stopButton = $("stopRecordBtn");
    if (stopButton) stopButton.disabled = true;
  }

  /* =========================================================
     MASTER METER
     ========================================================= */

  function startMasterMeter() {
    const analyser = state.masterAnalyser;
    if (!analyser) return;

    const data = new Uint8Array(analyser.fftSize);

    function drawMeter() {
      if (!state.masterAnalyser) return;

      state.masterAnalyser.getByteTimeDomainData(data);

      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / data.length);
      const level = clamp(rms * 320, 0, 100);

      const meter = $("masterMeter");

      if (meter) {
        if (meter.tagName.toLowerCase() === "meter") {
          meter.value = level;
        } else if (meter.tagName.toLowerCase() === "progress") {
          meter.value = level;
        } else {
          meter.style.width = `${level}%`;
          meter.style.setProperty("--meter-level", `${level}%`);
        }
      }

      requestAnimationFrame(drawMeter);
    }

    drawMeter();
  }

  /* =========================================================
     PROJECT SETTINGS SAVE
     ========================================================= */

  function saveProjectSettings() {
    const project = {
      projectName: "Naol Music Studio",
      savedAt: new Date().toISOString(),

      tracks: state.tracks.map((track) => ({
        name: track.name,
        duration: track.duration,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        autoGain: track.autoGain
      })),

      keyboardEvents: state.keyboardEvents.map((event) => ({
        note: event.note,
        frequency: event.frequency,
        time: event.time,
        duration: event.duration,
        volume: event.volume
      })),

      keyboardMixGain: state.keyboardMixGain,

      settings: {
        masterVolume: numberValue("masterVolume", DEFAULTS.masterVolume),
        bass: numberValue("bassControl", DEFAULTS.bass),
        mid: numberValue("midControl", DEFAULTS.mid),
        treble: numberValue("trebleControl", DEFAULTS.treble),
        reverb: numberValue("reverbControl", DEFAULTS.reverb),
        delay: numberValue("delayControl", DEFAULTS.delay),
        compressor: numberValue("compressorControl", DEFAULTS.compressor),
        noiseGate: numberValue("noiseGateControl", DEFAULTS.noiseGate),
        chorus: numberValue("chorusControl", DEFAULTS.chorus),
        limiter: numberValue("limiterControl", DEFAULTS.limiter),
        keyboardVolume: numberValue("keyboardVolume", DEFAULTS.keyboardVolume),
        speed: numberValue("speedControl", DEFAULTS.speed),
        pan: numberValue("panControl", DEFAULTS.pan)
      }
    };

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    downloadBlob(blob, "Naol-Music-Studio-Project.json");

    notify(
      "Project settings fi keyboard performance save godhaman. Audio file mataa ofumaan JSON keessatti hin kuufamu.",
      "success"
    );
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item[data-section]");

    navItems.forEach((item) => {
      item.addEventListener("click", () => {
        const targetId = item.dataset.section;

        document.querySelectorAll(".nav-item").forEach((nav) => {
          nav.classList.remove("active");
        });

        item.classList.add("active");

        document.querySelectorAll(
          ".studio-section, .content-section, .app-section"
        ).forEach((section) => {
          section.classList.remove("active");
          section.hidden = true;
        });

        const target = $(targetId);

        if (target) {
          target.classList.add("active");
          target.hidden = false;
        }
      });
    });
  }

  /* =========================================================
     SEEK BAR
     ========================================================= */

  function setupSeekBar() {
    const seekBar = $("seekBar");
    if (!seekBar) return;

    seekBar.min = "0";
    seekBar.max = "100";
    seekBar.step = "0.1";

    seekBar.addEventListener("input", () => {
      const total = getTotalDuration();
      const targetTime = (Number(seekBar.value) / 100) * total;

      const wasPlaying = state.isPlaying;

      stopAllTracks();
      state.playStartOffset = targetTime;

      const currentTimeElement = $("currentTime");
      if (currentTimeElement) {
        currentTimeElement.textContent = formatTime(targetTime);
      }

      if (wasPlaying) playAllTracks();
    });
  }

  /* =========================================================
     EVENT WIRING
     ========================================================= */

  function setupUpload() {
    const upload = $("audioUpload");
    if (!upload) return;

    upload.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);

      for (const file of files) {
        await addAudioFile(file);
      }

      upload.value = "";
    });
  }

  function setupButtons() {
    const addTrackButton = $("addTrackBtn");

    if (addTrackButton && !$("audioUpload")) {
      addTrackButton.addEventListener("click", () => {
        notify("Audio upload input HTML keessatti hin argamne.", "error");
      });
    }

    if ($("playBtn")) {
      $("playBtn").addEventListener("click", playAllTracks);
    }

    if ($("pauseBtn")) {
      $("pauseBtn").addEventListener("click", pauseAllTracks);
    }

    if ($("stopBtn")) {
      $("stopBtn").addEventListener("click", stopAllTracks);
    }

    if ($("recordBtn")) {
      $("recordBtn").addEventListener("click", startMicrophoneRecording);
    }

    if ($("stopRecordBtn")) {
      $("stopRecordBtn").addEventListener("click", stopMicrophoneRecording);
      $("stopRecordBtn").disabled = true;
    }

    if ($("recordKeyboardBtn")) {
      $("recordKeyboardBtn").addEventListener("click", () => {
        if (state.keyboardRecording) {
          stopKeyboardRecording();
        } else {
          startKeyboardRecording();
        }
      });
    }

    if ($("resetEffectsBtn")) {
      $("resetEffectsBtn").addEventListener("click", resetEffects);
    }

    if ($("applyPresetBtn")) {
      $("applyPresetBtn").addEventListener("click", applyVocalPreset);
    }

    if ($("exportBtn")) {
      $("exportBtn").addEventListener("click", () => {
        const format = $("exportFormat")
          ? $("exportFormat").value
          : "wav";

        if (format.toLowerCase().includes("webm")) {
          exportWebM();
        } else {
          exportWav();
        }
      });
    }

    if ($("masterExportBtn")) {
      $("masterExportBtn").addEventListener("click", exportWav);
    }

    if ($("saveProjectBtn")) {
      $("saveProjectBtn").addEventListener("click", saveProjectSettings);
    }
  }

  function setupControls() {
    [
      "masterVolume",
      "panControl",
      "bassControl",
      "midControl",
      "trebleControl",
      "reverbControl",
      "delayControl",
      "compressorControl",
      "noiseGateControl",
      "chorusControl",
      "limiterControl",
      "pitchControl",
      "speedControl",
      "fadeInControl",
      "fadeOutControl",
      "keyboardVolume"
    ].forEach(connectControl);
  }

  function setupComputerKeyboard() {
    const keyMap = {
      a: ["C", 4],
      w: ["C#", 4],
      s: ["D", 4],
      e: ["D#", 4],
      d: ["E", 4],
      f: ["F", 4],
      t: ["F#", 4],
      g: ["G", 4],
      y: ["G#", 4],
      h: ["A", 4],
      u: ["A#", 4],
      j: ["B", 4],
      k: ["C", 5]
    };

    const held = new Set();

    document.addEventListener("keydown", (event) => {
      if (
        event.repeat ||
        event.target.matches("input, textarea, select")
      ) {
        return;
      }

      const entry = keyMap[event.key.toLowerCase()];
      if (!entry) return;

      event.preventDefault();

      const keyId = `${entry[0]}${entry[1]}`;
      if (held.has(keyId)) return;

      held.add(keyId);
      startKeyboardNote(entry[0], entry[1]);
    });

    document.addEventListener("keyup", (event) => {
      const entry = keyMap[event.key.toLowerCase()];
      if (!entry) return;

      const keyId = `${entry[0]}${entry[1]}`;

      held.delete(keyId);
      stopKeyboardNote(entry[0], entry[1]);
    });

    window.addEventListener("blur", () => {
      held.forEach((keyId) => {
        const match = keyId.match(/^(.+)(\d+)$/);

        if (match) {
          stopKeyboardNote(match[1], Number(match[2]));
        }
      });

      held.clear();
    });
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  function initialize() {
    setupUpload();
    setupButtons();
    setupControls();
    setupNavigation();
    setupSeekBar();

    buildVirtualKeyboard();
    setupComputerKeyboard();
    insertAutoAdjustButton();

    updateTrackDisplay();
    updateTransportButtons();

    if ($("stopRecordBtn")) {
      $("stopRecordBtn").disabled = true;
    }

    setStatus("Ready");

    console.log(
      "Naol Music Studio ready. Audio + keyboard performance mixing enabled."
    );
  }

  initialize();
});
