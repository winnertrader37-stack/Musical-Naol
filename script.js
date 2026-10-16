/* =========================================================
   NAOL MUSIC STUDIO
   Vocal Processing and Keyboard Accompaniment
   ========================================================= */
"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const state = {
    ctx: null,
    master: null,
    compressor: null,
    limiter: null,
    tracks: [],
    nextTrackId: 1,
    playing: false,
    startedAt: 0,
    offset: 0,
    timer: null,
    keyboardEvents: [],
    keyboardNodes: [],
    selectedTrackId: null,
    recording: false,
    mediaRecorder: null,
    recordedChunks: [],
    micStream: null,
    autoProducing: false,
    generatedCount: 0
  };

  const NOTE_NAMES = [
    "C", "C#", "D", "D#", "E", "F",
    "F#", "G", "G#", "A", "A#", "B"
  ];

  const noteHz = midi =>
    440 * Math.pow(2, (midi - 69) / 12);

  function toast(message, error = false) {
    const el = $("toast");

    if (el) {
      el.textContent = message;
      el.classList.add("show");
      el.style.background = error ? "#7f1d1d" : "";

      clearTimeout(el._timer);

      el._timer = setTimeout(
        () => el.classList.remove("show"),
        3600
      );
    } else {
      console.info("[Naol Music Studio]", message);
    }

    setStatus(message);
  }

  function setStatus(message) {
    if ($("appStatus")) {
      $("appStatus").textContent = message;
    }
  }

  function value(id, fallback) {
    const el = $(id);

    return el && Number.isFinite(Number(el.value))
      ? Number(el.value)
      : fallback;
  }

  function ensureAudio() {
    if (!state.ctx) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Web Audio is not supported.");
      }

      state.ctx = new AudioContextClass();

      state.master = state.ctx.createGain();

      state.compressor =
        state.ctx.createDynamicsCompressor();

      state.compressor.threshold.value = -20;
      state.compressor.knee.value = 18;
      state.compressor.ratio.value = 2.8;
      state.compressor.attack.value = 0.012;
      state.compressor.release.value = 0.24;

      state.limiter =
        state.ctx.createDynamicsCompressor();

      state.limiter.threshold.value = -3;
      state.limiter.knee.value = 0;
      state.limiter.ratio.value = 16;
      state.limiter.attack.value = 0.003;
      state.limiter.release.value = 0.12;

      const output = state.ctx.createGain();
      output.gain.value = 0.88;

      state.master.connect(state.compressor);
      state.compressor.connect(state.limiter);
      state.limiter.connect(output);
      output.connect(state.ctx.destination);

      applyMasterControls();
    }

    if (state.ctx.state === "suspended") {
      state.ctx.resume();
    }

    return state.ctx;
  }

  function makeTrackGraph(track) {
    const ctx = ensureAudio();

    track.gainNode = ctx.createGain();

    track.panner = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : ctx.createGain();

    track.filter = ctx.createBiquadFilter();
    track.filter.type = "highpass";
    track.filter.frequency.value = 65;

    track.compressor =
      ctx.createDynamicsCompressor();

    track.gainNode.connect(track.filter);
    track.filter.connect(track.compressor);
    track.compressor.connect(track.panner);
    track.panner.connect(state.master);

    applyTrackControls(track);
  }

  function applyTrackControls(track) {
    if (!track || !track.gainNode) return;

    const target = track.muted
      ? 0
      : (track.autoGain || 1) * (track.volume ?? 1);

    track.gainNode.gain.setTargetAtTime(
      target,
      state.ctx.currentTime,
      0.06
    );

    if ("pan" in track.panner) {
      track.panner.pan.setTargetAtTime(
        track.pan || 0,
        state.ctx.currentTime,
        0.06
      );
    }

    track.compressor.threshold.value = -22;
    track.compressor.ratio.value = 2.2;
  }

  function applyMasterControls() {
    if (!state.ctx || !state.master) return;

    const volume = clamp(
      value("masterVolume", 82) / 100,
      0,
      1.2
    );

    state.master.gain.setTargetAtTime(
      volume,
      state.ctx.currentTime,
      0.08
    );

    if (state.limiter) {
      state.limiter.threshold.value = clamp(
        value("limiterControl", 85) * -0.06,
        -6,
        -1
      );
    }
  }

  function audioDuration() {
    return state.tracks.reduce(
      (max, track) =>
        Math.max(max, track.buffer.duration),
      0
    );
  }

  function getTotalDuration() {
    const keyboardDuration = state.keyboardEvents.map(
      event => event.time + event.duration
    );

    return Math.max(
      audioDuration(),
      ...keyboardDuration,
      0
    );
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);

    return `${Math.floor(seconds / 60)}:${String(
      Math.floor(seconds % 60)
    ).padStart(2, "0")}`;
  }

  function currentTime() {
    if (!state.playing || !state.ctx) {
      return state.offset;
    }

    const speed = clamp(
      value("speedControl", 100) / 100,
      0.5,
      1.5
    );

    return state.offset +
      (state.ctx.currentTime - state.startedAt) * speed;
  }

  function updateTime(time = currentTime()) {
    const total = getTotalDuration();

    if ($("currentTime")) {
      $("currentTime").textContent = formatTime(time);
    }

    if ($("duration")) {
      $("duration").textContent = formatTime(total);
    }

    if ($("seekBar")) {
      $("seekBar").max = String(Math.max(total, 0.01));
      $("seekBar").value = String(
        clamp(time, 0, total || 0)
      );
    }
  }

  async function decodeFile(file) {
    const ctx = ensureAudio();
    const arrayBuffer = await file.arrayBuffer();

    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  async function addFiles(files) {
    if (!files || !files.length) return;

    ensureAudio();

    for (const file of Array.from(files)) {
      const supported =
        file.type.startsWith("audio/") ||
        /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(
          file.name
        );

      if (!supported) {
        toast(`Unsupported audio file: ${file.name}`, true);
        continue;
      }

      try {
        const buffer = await decodeFile(file);

        const track = {
          id: state.nextTrackId++,
          name: file.name,
          buffer,
          volume: 1,
          pan: 0,
          muted: false,
          solo: false,
          autoGain: 1,
          generated: false
        };

        makeTrackGraph(track);

        state.tracks.push(track);
        state.selectedTrackId = track.id;
      } catch (error) {
        console.error(error);

        toast(
          `Could not open ${file.name}. Try WAV or MP3.`,
          true
        );
      }
    }

    renderTracks();
    updateTime(0);

    toast(
      "Audio loaded. Use AUTO PRODUCE + MIX to process it."
    );
  }

  function renderTracks() {
    const list = $("trackList");

    if (!list) return;

    list.innerHTML = "";

    state.tracks.forEach(track => {
      const row = document.createElement("div");

      row.className = "track-row";
      row.dataset.trackId = track.id;

      row.style.cssText =
        "display:grid;grid-template-columns:minmax(100px,1fr) auto auto auto;gap:8px;align-items:center;padding:10px;border-bottom:1px solid #333";

      const name = document.createElement("button");

      name.textContent = track.name;
      name.title = "Select track";

      name.style.cssText =
        "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;color:inherit;border:0;text-align:left";

      name.onclick = () => {
        state.selectedTrackId = track.id;
        toast(`Selected: ${track.name}`);
      };

      const volume = document.createElement("input");

      volume.type = "range";
      volume.min = "0";
      volume.max = "150";
      volume.value = String(
        Math.round(track.volume * 100)
      );
      volume.title = "Track volume";

      volume.oninput = () => {
        track.volume = Number(volume.value) / 100;
        applyTrackControls(track);
      };

      const mute = document.createElement("button");

      mute.textContent = track.muted ? "Unmute" : "Mute";

      mute.onclick = () => {
        track.muted = !track.muted;
        applyTrackControls(track);
        renderTracks();
      };

      const remove = document.createElement("button");

      remove.textContent = "×";
      remove.title = "Remove track";

      remove.onclick = () => {
        stopAll();

        [
          track.gainNode,
          track.filter,
          track.compressor,
          track.panner
        ].forEach(node => {
          try {
            node.disconnect();
          } catch {}
        });

        state.tracks = state.tracks.filter(
          item => item.id !== track.id
        );

        if (state.selectedTrackId === track.id) {
          state.selectedTrackId =
            state.tracks[0]?.id ?? null;
        }

        renderTracks();
        updateTime(0);
      };

      row.append(name, volume, mute, remove);
      list.appendChild(row);
    });
  }

  function stopKeyboardNodes() {
    state.keyboardNodes.forEach(node => {
      try {
        node.stop();
      } catch {}

      try {
        node.disconnect();
      } catch {}
    });

    state.keyboardNodes = [];
  }

  function stopAll() {
    state.playing = false;
    clearInterval(state.timer);

    state.tracks.forEach(track => {
      if (track.source) {
        try {
          track.source.stop();
        } catch {}

        try {
          track.source.disconnect();
        } catch {}

        track.source = null;
      }
    });

    stopKeyboardNodes();

    state.offset = 0;
    updateTime(0);

    if ($("playBtn")) {
      $("playBtn").disabled = false;
    }
  }

  function stopPlaybackKeepOffset() {
    state.playing = false;
    clearInterval(state.timer);

    state.tracks.forEach(track => {
      if (track.source) {
        try {
          track.source.stop();
        } catch {}

        try {
          track.source.disconnect();
        } catch {}

        track.source = null;
      }
    });

    stopKeyboardNodes();

    if ($("playBtn")) {
      $("playBtn").disabled = false;
    }
  }

  function playAllTracks() {
    const ctx = ensureAudio();

    if (!state.tracks.length &&
        !state.keyboardEvents.length) {
      toast("Upload a vocal or audio file first.", true);
      return;
    }

    if (state.playing) return;

    if (state.offset >= getTotalDuration()) {
      state.offset = 0;
    }

    state.playing = true;
    state.startedAt = ctx.currentTime;

    const rate = clamp(
      value("speedControl", 100) / 100,
      0.5,
      1.5
    );

    const anySolo = state.tracks.some(
      track => track.solo
    );

    state.tracks.forEach(track => {
      if (track.muted || (anySolo && !track.solo)) {
        return;
      }

      const source = ctx.createBufferSource();

      source.buffer = track.buffer;
      source.playbackRate.value = rate;
      source.connect(track.gainNode);

      track.source = source;

      const offset = clamp(
        state.offset,
        0,
        Math.max(0, track.buffer.duration - 0.001)
      );

      if (offset < track.buffer.duration) {
        source.start(0, offset);
      }
    });

    scheduleKeyboard(state.offset, rate);

    if ($("playBtn")) {
      $("playBtn").disabled = true;
    }

    clearInterval(state.timer);

    state.timer = setInterval(() => {
      const time = currentTime();

      updateTime(time);

      if (time >= getTotalDuration() - 0.02) {
        state.playing = false;
        clearInterval(state.timer);

        if ($("playBtn")) {
          $("playBtn").disabled = false;
        }
      }
    }, 100);
  }

  function scheduleKeyboard(offset, rate = 1) {
    const ctx = ensureAudio();

    const keyboardVolume = clamp(
      value("keyboardVolume", 28) / 100,
      0,
      1
    );

    state.keyboardEvents
      .filter(event =>
        event.time + event.duration > offset
      )
      .forEach(event => {
        const start = Math.max(
          0,
          (event.time - offset) / rate
        );

        const duration = Math.max(
          0.04,
          event.duration / rate
        );

        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        oscillator.type = "triangle";
        oscillator.frequency.value =
          event.frequency || noteHz(event.midi || 60);

        filter.type = "lowpass";
        filter.frequency.value = 3200;

        const volume = clamp(
          (event.volume ?? 0.2) * keyboardVolume,
          0,
          0.4
        );

        gain.gain.setValueAtTime(
          0.0001,
          ctx.currentTime + start
        );

        gain.gain.linearRampToValueAtTime(
          volume,
          ctx.currentTime + start +
            Math.min(0.035, duration / 3)
        );

        gain.gain.setTargetAtTime(
          0.0001,
          ctx.currentTime + start + duration * 0.78,
          Math.max(0.025, duration * 0.12)
        );

        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(state.master);

        oscillator.start(ctx.currentTime + start);

        oscillator.stop(
          ctx.currentTime + start + duration + 0.08
        );

        state.keyboardNodes.push(
          oscillator,
          gain,
          filter
        );
      });
  }

  function estimatePitch(
    buffer,
    startSeconds,
    frameSeconds = 0.18
  ) {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const start = Math.floor(startSeconds * sampleRate);

    const size = Math.min(
      Math.floor(frameSeconds * sampleRate),
      data.length - start
    );

    if (size < 2048) return null;

    const minLag = Math.floor(sampleRate / 700);

    const maxLag = Math.min(
      Math.floor(sampleRate / 75),
      size - 1
    );

    let rms = 0;

    for (let i = 0; i < size; i++) {
      rms += data[start + i] * data[start + i];
    }

    rms = Math.sqrt(rms / size);

    if (rms < 0.012) return null;

    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < size - lag; i += 2) {
        const a = data[start + i];
        const b = data[start + i + lag];

        sum += a * b;
        normA += a * a;
        normB += b * b;
      }

      const correlation =
        sum / Math.sqrt((normA * normB) || 1);

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < 0.58) {
      return null;
    }

    const frequency = sampleRate / bestLag;

    if (frequency < 75 || frequency > 700) {
      return null;
    }

    return {
      frequency,
      midi: Math.round(
        69 + 12 * Math.log2(frequency / 440)
      ),
      confidence: bestCorrelation,
      rms
    };
  }

  function estimateKey(pitches) {
    const counts = Array(12).fill(0);

    pitches.forEach(pitch => {
      if (pitch && pitch.midi >= 36 && pitch.midi <= 88) {
        counts[(pitch.midi % 12 + 12) % 12]++;
      }
    });

    if (counts.every(count => count === 0)) {
      return 0;
    }

    const majorProfile = [
      6, 2, 4, 2, 5, 4,
      2, 5, 2, 3, 1, 4
    ];

    let bestKey = 0;
    let bestScore = -1;

    for (let key = 0; key < 12; key++) {
      let score = 0;

      for (let pc = 0; pc < 12; pc++) {
        score += counts[pc] *
          majorProfile[(pc - key + 12) % 12];
      }

      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    return bestKey;
  }

  function clearGeneratedKeyboard() {
    state.keyboardEvents =
      state.keyboardEvents.filter(
        event => !event.generated
      );
  }

  function generateAccompaniment(track) {
    clearGeneratedKeyboard();

    const duration = track.buffer.duration;
    const pitchSamples = [];

    for (
      let time = 0.25;
      time < Math.min(duration, 24);
      time += 0.35
    ) {
      pitchSamples.push(
        estimatePitch(track.buffer, time)
      );
    }

    const key = estimateKey(pitchSamples);

    const progression = [0, 7, 9, 5];

    const bpm = clamp(
      value("autoTempo", 88),
      62,
      118
    );

    const beat = 60 / bpm;
    const bar = beat * 4;

    const chordIntervals = [
      [0, 4, 7],
      [0, 4, 7],
      [0, 3, 7],
      [0, 4, 7]
    ];

    const totalBars = Math.ceil(duration / bar);
    const rootMidi = 48 + key;
    const events = [];

    for (let barIndex = 0;
         barIndex < totalBars;
         barIndex++) {

      const chordIndex = barIndex % 4;

      const root =
        rootMidi + progression[chordIndex];

      const tones = chordIntervals[chordIndex]
        .map(interval => root + interval);

      const barStart = barIndex * bar;

      tones.forEach((midi, index) => {
        events.push({
          midi,
          frequency: noteHz(midi),
          note: NOTE_NAMES[midi % 12],
          time: barStart + index * 0.018,
          duration: Math.min(
            bar * 0.92,
            duration - barStart
          ),
          volume: 0.17,
          generated: true
        });
      });

      for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
        const toneIndex =
          beatIndex === 0 || beatIndex === 2
            ? 0
            : beatIndex === 1
              ? 1
              : 2;

        const midi = tones[toneIndex] + 12;
        const time = barStart + beatIndex * beat;

        if (time < duration) {
          events.push({
            midi,
            frequency: noteHz(midi),
            note: NOTE_NAMES[midi % 12],
            time,
            duration: Math.min(
              beat * 0.72,
              duration - time
            ),
            volume: 0.105,
            generated: true
          });
        }
      }
    }

    state.keyboardEvents.push(...events);
    state.generatedCount = events.length;

    return {
      key: NOTE_NAMES[key],
      bpm,
      count: events.length,
      pitchCount: pitchSamples.filter(Boolean).length
    };
  }

  function analyseRms(buffer) {
    const data = buffer.getChannelData(0);

    const stride = Math.max(
      1,
      Math.floor(data.length / 250000)
    );

    let sum = 0;
    let peak = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += stride) {
      const sample = Math.abs(data[i]);

      peak = Math.max(peak, sample);
      sum += sample * sample;
      count++;
    }

    return {
      rms: Math.sqrt(sum / Math.max(count, 1)),
      peak
    };
  }

  function smoothVocal(track) {
    const { rms, peak } = analyseRms(track.buffer);

    track.autoGain = clamp(
      0.13 / Math.max(rms, 0.018),
      0.55,
      2.6
    );

    if (peak * track.autoGain > 0.88) {
      track.autoGain =
        0.88 / Math.max(peak, 0.001);
    }

    track.volume = 1;

    applyTrackControls(track);

    track.filter.frequency.setTargetAtTime(
      72,
      state.ctx.currentTime,
      0.08
    );

    track.compressor.threshold.value = -23;
    track.compressor.knee.value = 22;
    track.compressor.ratio.value = 2.5;
    track.compressor.attack.value = 0.018;
    track.compressor.release.value = 0.25;
  }

  async function autoProduce() {
    if (state.autoProducing) return;

    const track =
      state.tracks.find(
        item => item.id === state.selectedTrackId
      ) || state.tracks[0];

    if (!track) {
      toast("Upload your vocal audio first.", true);
      return;
    }

    state.autoProducing = true;

    const button =
      $("autoProduceBtn") || $("autoAdjustBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "ANALYZING VOCAL...";
    }

    try {
      ensureAudio();

      toast("Analyzing the vocal and creating accompaniment...");

      await new Promise(resolve => setTimeout(resolve, 40));

      const result = generateAccompaniment(track);

      smoothVocal(track);

      if ($("keyboardVolume")) {
        $("keyboardVolume").value = "28";
      }

      if ($("masterVolume")) {
        $("masterVolume").value = "82";
      }

      applyMasterControls();
      renderTracks();
      updateTime(0);

      toast(
        `Production complete. Estimated key: ${result.key}. ` +
        `Tempo: ${result.bpm} BPM. ` +
        `${result.count} keyboard notes generated.`
      );
    } catch (error) {
      console.error(error);

      toast(
        "Auto Produce failed. Try another audio file.",
        true
      );
    } finally {
      state.autoProducing = false;

      if (button) {
        button.disabled = false;
        button.textContent = "AUTO PRODUCE + MIX";
      }
    }
  }

  function autoAdjustAll() {
    ensureAudio();

    state.tracks.forEach(smoothVocal);

    applyMasterControls();

    toast(
      "Smooth vocal leveling and compression applied."
    );
  }

  async function exportWav() {
    if (!state.tracks.length &&
        !state.keyboardEvents.length) {
      toast("Nothing to export.", true);
      return;
    }

    stopAll();

    toast("Rendering WAV audio...");

    const sampleRate = 44100;
    const duration = Math.max(
      0.2,
      getTotalDuration() + 0.15
    );

    const frames = Math.ceil(duration * sampleRate);

    const offline = new OfflineAudioContext(
      2,
      frames,
      sampleRate
    );

    const master = offline.createGain();

    master.gain.value = clamp(
      value("masterVolume", 82) / 100,
      0,
      1
    );

    const compressor =
      offline.createDynamicsCompressor();

    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;

    const limiter =
      offline.createDynamicsCompressor();

    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    master.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(offline.destination);

    const anySolo = state.tracks.some(
      track => track.solo
    );

    state.tracks.forEach(track => {
      if (track.muted || (anySolo && !track.solo)) {
        return;
      }

      const source = offline.createBufferSource();
      source.buffer = track.buffer;

      source.playbackRate.value = clamp(
        value("speedControl", 100) / 100,
        0.5,
        1.5
      );

      const gain = offline.createGain();

      gain.gain.value = clamp(
        (track.autoGain || 1) *
          (track.volume ?? 1),
        0,
        2.5
      );

      const highpass = offline.createBiquadFilter();

      highpass.type = "highpass";
      highpass.frequency.value = 72;

      const comp = offline.createDynamicsCompressor();

      comp.threshold.value = -23;
      comp.knee.value = 22;
      comp.ratio.value = 2.5;
      comp.attack.value = 0.018;
      comp.release.value = 0.25;

      source.connect(gain);
      gain.connect(highpass);
      highpass.connect(comp);
      comp.connect(master);

      source.start(0);
    });

    const keyboardVolume = clamp(
      value("keyboardVolume", 28) / 100,
      0,
      1
    );

    state.keyboardEvents.forEach(event => {
      if (event.time >= duration) return;

      const oscillator = offline.createOscillator();
      const gain = offline.createGain();
      const filter = offline.createBiquadFilter();

      oscillator.type = "triangle";
      oscillator.frequency.value =
        event.frequency || noteHz(event.midi || 60);

      filter.type = "lowpass";
      filter.frequency.value = 3200;

      const start = Math.max(0, event.time);

      const noteDuration = Math.max(
        0.04,
        Math.min(event.duration, duration - start)
      );

      gain.gain.setValueAtTime(0.0001, start);

      gain.gain.linearRampToValueAtTime(
        clamp(
          (event.volume ?? 0.2) * keyboardVolume,
          0,
          0.4
        ),
        start + Math.min(0.035, noteDuration / 3)
      );

      gain.gain.setTargetAtTime(
        0.0001,
        start + noteDuration * 0.78,
        Math.max(0.025, noteDuration * 0.12)
      );

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(master);

      oscillator.start(start);
      oscillator.stop(start + noteDuration + 0.05);
    });

    try {
      const rendered = await offline.startRendering();
      const wav = encodeWav(rendered);

      const url = URL.createObjectURL(
        new Blob([wav], { type: "audio/wav" })
      );

      const link = document.createElement("a");

      link.href = url;
      link.download = "Naol_Music_Studio_Smooth_Mix.wav";
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 10000);

      toast("WAV export completed.");
    } catch (error) {
      console.error(error);
      toast("WAV export failed.", true);
    }
  }

  function encodeWav(buffer) {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const bytes = 44 + length * channels * 2;

    const output = new ArrayBuffer(bytes);
    const view = new DataView(output);

    const writeString = (offset, text) => {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, bytes - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);

    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);

    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(
      28,
      buffer.sampleRate * channels * 2,
      true
    );

    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);

    writeString(36, "data");
    view.setUint32(40, bytes - 44, true);

    const data = Array.from(
      { length: channels },
      (_, index) => buffer.getChannelData(index)
    );

    let offset = 44;

    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = clamp(data[channel][i], -1, 1);

        view.setInt16(
          offset,
          sample < 0
            ? sample * 32768
            : sample * 32767,
          true
        );

        offset += 2;
      }
    }

    return output;
  }

  async function recordMic() {
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder
      ) {
        throw new Error(
          "Microphone recording is not supported."
        );
      }

      state.micStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

      state.recordedChunks = [];

      state.mediaRecorder = new MediaRecorder(
        state.micStream
      );

      state.mediaRecorder.ondataavailable = event => {
        if (event.data.size) {
          state.recordedChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = () => {
        const blob = new Blob(
          state.recordedChunks,
          {
            type:
              state.mediaRecorder.mimeType ||
              "audio/webm"
          }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "Naol_Vocal_Recording.webm";
        link.click();

        setTimeout(() => URL.revokeObjectURL(url), 10000);

        state.micStream?.getTracks().forEach(track => {
          track.stop();
        });

        state.micStream = null;

        if ($("recordStatus")) {
          $("recordStatus").textContent = "Recording saved";
        }
      };

      state.mediaRecorder.start();
      state.recording = true;

      if ($("recordStatus")) {
        $("recordStatus").textContent = "Recording...";
      }

      if ($("recordBtn")) {
        $("recordBtn").disabled = true;
      }

      if ($("stopRecordBtn")) {
        $("stopRecordBtn").disabled = false;
      }

      toast("Recording started.");
    } catch (error) {
      console.error(error);

      toast(
        error.message || "Microphone permission required.",
        true
      );
    }
  }

  function stopMic() {
    if (
      state.mediaRecorder &&
      state.mediaRecorder.state !== "inactive"
    ) {
      state.mediaRecorder.stop();
    }

    state.recording = false;

    if ($("recordBtn")) {
      $("recordBtn").disabled = false;
    }

    if ($("stopRecordBtn")) {
      $("stopRecordBtn").disabled = true;
    }
  }

  function saveProject() {
    const project = {
      name: "Naol Music Studio Project",
      version: 2,

      keyboardEvents: state.keyboardEvents,

      tracks: state.tracks.map(track => ({
        name: track.name,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        autoGain: track.autoGain
      })),

      settings: {
        masterVolume: value("masterVolume", 82),
        keyboardVolume: value("keyboardVolume", 28),
        speed: value("speedControl", 100)
      }
    };

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "Naol_Music_Studio_Project.json";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 10000);

    toast(
      "Project settings saved. Audio files are not embedded."
    );
  }

  function bind(id, event, handler) {
    const element = $(id);

    if (element) {
      element.addEventListener(event, handler);
    }
  }

  function insertAutoProduceButton() {
    if ($("autoProduceBtn")) return;

    const button = document.createElement("button");

    button.id = "autoProduceBtn";
    button.type = "button";
    button.textContent = "🎹 AUTO PRODUCE + MIX";

    button.style.cssText =
      "padding:12px 18px;border:0;border-radius:12px;" +
      "font-weight:700;cursor:pointer;" +
      "background:linear-gradient(135deg,#10b981,#0f766e);" +
      "color:white;box-shadow:0 5px 18px #0005;margin:8px 4px";

    button.addEventListener("click", autoProduce);

    const anchor =
      $("autoAdjustBtn") ||
      $("masterExportBtn") ||
      $("exportBtn") ||
      $("trackList");

    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(
        button,
        anchor.nextSibling
      );
    } else {
      document.body.appendChild(button);
    }
  }

  function bindKeyboard() {
    const keys = {
      a: 60, w: 61, s: 62, e: 63,
      d: 64, f: 65, t: 66, g: 67,
      y: 68, h: 69, u: 70, j: 71, k: 72
    };

    const held = new Set();

    window.addEventListener("keydown", event => {
      if (
        event.repeat ||
        /INPUT|TEXTAREA|SELECT/.test(
          document.activeElement?.tagName || ""
        )
      ) {
        return;
      }

      const midi = keys[event.key.toLowerCase()];

      if (midi == null || held.has(event.key)) {
        return;
      }

      held.add(event.key);

      const ctx = ensureAudio();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = noteHz(midi);

      gain.gain.value =
        clamp(value("keyboardVolume", 28) / 100, 0, 1) *
        0.16;

      oscillator.connect(gain);
      gain.connect(state.master);
      oscillator.start();

      state.keyboardNodes.push(oscillator, gain);

      state._liveKeys ||= {};

      state._liveKeys[event.key] = {
        oscillator,
        gain,
        start: ctx.currentTime,
        midi
      };
    });

    window.addEventListener("keyup", event => {
      held.delete(event.key);

      const item = state._liveKeys?.[event.key];

      if (!item) return;

      const duration = Math.max(
        0.1,
        ensureAudio().currentTime - item.start
      );

      state.keyboardEvents.push({
        midi: item.midi,
        frequency: noteHz(item.midi),
        note: NOTE_NAMES[item.midi % 12],
        time: state.playing ? currentTime() : state.offset,
        duration,
        volume: 0.18
      });

      try {
        item.gain.gain.setTargetAtTime(
          0.0001,
          ensureAudio().currentTime,
          0.08
        );

        item.oscillator.stop(
          ensureAudio().currentTime + 0.3
        );
      } catch {}

      delete state._liveKeys[event.key];
    });
  }

  function init() {
    bind("audioUpload", "change", event => {
      addFiles(event.target.files);
    });

    bind("addTrackBtn", "click", () => {
      $("audioUpload")?.click();
    });

    bind("playBtn", "click", playAllTracks);

    bind("pauseBtn", "click", () => {
      if (state.playing) {
        state.offset = currentTime();
        stopPlaybackKeepOffset();
      }
    });

    bind("stopBtn", "click", stopAll);

    bind("seekBar", "input", event => {
      const time = Number(event.target.value) || 0;
      const wasPlaying = state.playing;

      stopPlaybackKeepOffset();

      state.offset = time;
      updateTime(time);

      if (wasPlaying) {
        playAllTracks();
      }
    });

    bind("masterVolume", "input", applyMasterControls);

    bind("autoAdjustBtn", "click", autoAdjustAll);
    bind("masterExportBtn", "click", exportWav);
    bind("exportBtn", "click", exportWav);
    bind("saveProjectBtn", "click", saveProject);
    bind("recordBtn", "click", recordMic);
    bind("stopRecordBtn", "click", stopMic);

    bind("resetEffectsBtn", "click", () => {
      const defaults = {
        masterVolume: 82,
        keyboardVolume: 28,
        speedControl: 100,
        pitchControl: 0
      };

      [
        "masterVolume",
        "keyboardVolume",
        "speedControl",
        "pitchControl",
        "bassControl",
        "midControl",
        "trebleControl",
        "reverbControl",
        "delayControl",
        "compressorControl",
        "noiseGateControl",
        "chorusControl",
        "limiterControl"
      ].forEach(id => {
        const element = $(id);

        if (element) {
          element.value = String(
            defaults[id] ?? element.defaultValue ?? 0
          );
        }
      });

      applyMasterControls();

      toast("Controls reset.");
    });

    bind("applyPresetBtn", "click", () => {
      const preset = $("vocalPreset")?.value || "smooth";

      const presets = {
        smooth: { masterVolume: 82, keyboardVolume: 28 },
        warm: { masterVolume: 80, keyboardVolume: 24 },
        bright: { masterVolume: 82, keyboardVolume: 25 },
        intimate: { masterVolume: 78, keyboardVolume: 20 }
      };

      Object.entries(presets[preset] || presets.smooth)
        .forEach(([id, setting]) => {
          if ($(id)) {
            $(id).value = String(setting);
          }
        });

      applyMasterControls();
      autoAdjustAll();
    });

    document
      .querySelectorAll(".nav-item[data-section]")
      .forEach(item => {
        item.addEventListener("click", () => {
          const sectionId = item.dataset.section;

          document
            .querySelectorAll(
              ".studio-section, section[id$='Section']"
            )
            .forEach(section => {
              section.style.display = "none";
            });

          if ($(sectionId)) {
            $(sectionId).style.display = "";
          }

          document
            .querySelectorAll(".nav-item")
            .forEach(nav => nav.classList.remove("active"));

          item.classList.add("active");
        });
      });

    insertAutoProduceButton();
    bindKeyboard();

    if ($("stopRecordBtn")) {
      $("stopRecordBtn").disabled = true;
    }

    setStatus(
      "Ready — upload a vocal, then select AUTO PRODUCE + MIX."
    );
  }

  document.addEventListener("DOMContentLoaded", init);
})();
