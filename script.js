"use strict";

/* ============================================================
   NAOL MUSIC STUDIO
   Complete Browser-Based Audio Studio
   Main Feature: ONE BUTTON — AUTO ADJUST ALL

   Features:
   - Upload multiple audio files
   - Multi-track playback and mixing
   - Individual track volume
   - Master volume and pan
   - Bass, Mid, Treble EQ
   - Compressor and limiter
   - Noise gate
   - Reverb, delay and chorus
   - Vocal enhancement preset
   - Virtual piano keyboard
   - Keyboard recording
   - Microphone recording
   - Automatic audio analysis
   - Automatic volume balancing
   - Automatic EQ adjustment
   - Automatic mixing and mastering
   - WAV and WebM export
   - Project settings save
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    /* ========================================================
       HELPERS
       ======================================================== */

    const $ = (id) => document.getElementById(id);

    const clamp = (value, min, max) =>
        Math.min(max, Math.max(min, value));

    const safeNumber = (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    };

    const sleep = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
            seconds = 0;
        }

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };

    const escapeHTML = (value) => {
        return String(value).replace(/[&<>"']/g, (character) => {
            const map = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            };

            return map[character];
        });
    };

    /* ========================================================
       APP STATE
       ======================================================== */

    const state = {
        audioContext: null,
        tracks: [],
        activeTrackId: null,
        trackCounter: 0,

        masterGain: null,
        masterCompressor: null,
        limiter: null,

        eqLow: null,
        eqMid: null,
        eqHigh: null,

        masterPanner: null,

        reverbSend: null,
        reverbGain: null,
        reverbNode: null,

        delaySend: null,
        delayNode: null,
        delayFeedback: null,
        delayGain: null,

        chorusOscillator: null,
        chorusDepth: null,
        chorusDelay: null,
        chorusGain: null,

        noiseGate: null,

        keyboardOscillators: new Map(),
        keyboardEvents: [],
        keyboardRecording: false,
        keyboardRecordingStart: 0,

        microphoneStream: null,
        microphoneRecorder: null,
        microphoneChunks: [],

        recordingStartedAt: 0,
        recordingTimer: null,

        animationFrame: null,

        isPlaying: false,
        autoAdjusting: false,

        autoAdjustSnapshot: null,

        toastTimer: null
    };

    /* ========================================================
       STATUS AND TOAST
       ======================================================== */

    function showToast(message, type = "info") {
        const toast = $("toast");

        if (toast) {
            toast.textContent = message;
            toast.classList.remove(
                "success",
                "error",
                "warning",
                "info"
            );

            toast.classList.add(type);
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
        const appStatus = $("appStatus");

        if (appStatus) {
            appStatus.textContent = message;
        }

        console.log(`[Naol Music Studio] ${message}`);
    }

    /* ========================================================
       AUDIO CONTEXT
       ======================================================== */

    function getAudioContext() {
        if (state.audioContext) {
            return state.audioContext;
        }

        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            throw new Error(
                "Web Audio API browser kana keessatti hin deeggaramu."
            );
        }

        state.audioContext = new AudioContextClass();

        createMasterAudioGraph();

        return state.audioContext;
    }

    async function resumeAudioContext() {
        const context = getAudioContext();

        if (context.state === "suspended") {
            await context.resume();
        }

        return context;
    }

    /* ========================================================
       MASTER AUDIO GRAPH
       ======================================================== */

    function createMasterAudioGraph() {
        const ctx = state.audioContext;

        if (!ctx || state.masterGain) {
            return;
        }

        /*
         * Main signal path:
         *
         * Tracks -> EQ -> Noise Gate -> Compressor
         * -> Limiter -> Master Volume -> Destination
         *
         * Reverb and delay use parallel effect sends.
         */

        state.eqLow = ctx.createBiquadFilter();
        state.eqLow.type = "lowshelf";
        state.eqLow.frequency.value = 120;
        state.eqLow.gain.value = 0;

        state.eqMid = ctx.createBiquadFilter();
        state.eqMid.type = "peaking";
        state.eqMid.frequency.value = 1000;
        state.eqMid.Q.value = 0.8;
        state.eqMid.gain.value = 0;

        state.eqHigh = ctx.createBiquadFilter();
        state.eqHigh.type = "highshelf";
        state.eqHigh.frequency.value = 8000;
        state.eqHigh.gain.value = 0;

        /*
         * Noise gate approximation.
         * This attenuates low-level audio; it is not AI denoising.
         */

        state.noiseGate = ctx.createDynamicsCompressor();
        state.noiseGate.threshold.value = -55;
        state.noiseGate.knee.value = 0;
        state.noiseGate.ratio.value = 8;
        state.noiseGate.attack.value = 0.005;
        state.noiseGate.release.value = 0.12;

        state.masterCompressor = ctx.createDynamicsCompressor();
        state.masterCompressor.threshold.value = -18;
        state.masterCompressor.knee.value = 20;
        state.masterCompressor.ratio.value = 3;
        state.masterCompressor.attack.value = 0.01;
        state.masterCompressor.release.value = 0.25;

        /*
         * Limiter approximation.
         */

        state.limiter = ctx.createDynamicsCompressor();
        state.limiter.threshold.value = -3;
        state.limiter.knee.value = 0;
        state.limiter.ratio.value = 20;
        state.limiter.attack.value = 0.003;
        state.limiter.release.value = 0.1;

        state.masterGain = ctx.createGain();
        state.masterGain.gain.value = 0.8;

        state.masterPanner = ctx.createStereoPanner();
        state.masterPanner.pan.value = 0;

        /*
         * Reverb bus.
         */

        state.reverbSend = ctx.createGain();
        state.reverbSend.gain.value = 0;

        state.reverbNode = ctx.createConvolver();
        state.reverbNode.buffer = createReverbImpulse(ctx, 2.2, 2.0);

        state.reverbGain = ctx.createGain();
        state.reverbGain.gain.value = 0.22;

        /*
         * Delay bus.
         */

        state.delaySend = ctx.createGain();
        state.delaySend.gain.value = 0;

        state.delayNode = ctx.createDelay(2.0);
        state.delayNode.delayTime.value = 0.28;

        state.delayFeedback = ctx.createGain();
        state.delayFeedback.gain.value = 0.22;

        state.delayGain = ctx.createGain();
        state.delayGain.gain.value = 0.25;

        /*
         * Chorus bus.
         */

        state.chorusDelay = ctx.createDelay(0.1);
        state.chorusDelay.delayTime.value = 0.025;

        state.chorusDepth = ctx.createGain();
        state.chorusDepth.gain.value = 0.004;

        state.chorusOscillator = ctx.createOscillator();
        state.chorusOscillator.type = "sine";
        state.chorusOscillator.frequency.value = 0.8;

        state.chorusGain = ctx.createGain();
        state.chorusGain.gain.value = 0;

        state.chorusOscillator.connect(state.chorusDepth);
        state.chorusDepth.connect(state.chorusDelay.delayTime);
        state.chorusOscillator.start();

        /*
         * Main dry signal.
         */

        state.eqLow.connect(state.eqMid);
        state.eqMid.connect(state.eqHigh);
        state.eqHigh.connect(state.noiseGate);
        state.noiseGate.connect(state.masterCompressor);
        state.masterCompressor.connect(state.limiter);
        state.limiter.connect(state.masterPanner);
        state.masterPanner.connect(state.masterGain);
        state.masterGain.connect(ctx.destination);

        /*
         * Reverb parallel signal.
         */

        state.eqHigh.connect(state.reverbSend);
        state.reverbSend.connect(state.reverbNode);
        state.reverbNode.connect(state.reverbGain);
        state.reverbGain.connect(state.masterGain);

        /*
         * Delay parallel signal.
         */

        state.eqHigh.connect(state.delaySend);
        state.delaySend.connect(state.delayNode);
        state.delayNode.connect(state.delayGain);
        state.delayGain.connect(state.masterGain);

        /*
         * Delay feedback.
         */

        state.delayNode.connect(state.delayFeedback);
        state.delayFeedback.connect(state.delayNode);

        /*
         * Chorus parallel signal.
         */

        state.eqHigh.connect(state.chorusDelay);
        state.chorusDelay.connect(state.chorusGain);
        state.chorusGain.connect(state.masterGain);

        /*
         * Audio output starts at a safe volume.
         */

        updateAudioControls();

        startMasterMeter();
    }

    function createReverbImpulse(ctx, duration, decay) {
        const sampleRate = ctx.sampleRate;
        const length = Math.floor(sampleRate * duration);

        const impulse = ctx.createBuffer(
            2,
            length,
            sampleRate
        );

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);

            for (let i = 0; i < length; i++) {
                const fade = Math.pow(1 - i / length, decay);
                data[i] = (Math.random() * 2 - 1) * fade;
            }
        }

        return impulse;
    }

    /* ========================================================
       AUDIO TRACKS
       ======================================================== */

    function createTrack(file, buffer = null) {
        const ctx = getAudioContext();

        const audio = new Audio();
        audio.preload = "auto";
        audio.controls = false;
        audio.crossOrigin = "anonymous";
        audio.src = URL.createObjectURL(file);

        const track = {
            id: ++state.trackCounter,
            name: file.name || `Track ${state.trackCounter}`,
            file,
            audio,
            buffer,

            source: null,
            gain: ctx.createGain(),
            panner: ctx.createStereoPanner(),

            volume: 1,
            pan: 0,
            muted: false,
            solo: false,

            duration: 0,
            ready: false
        };

        track.gain.gain.value = track.volume;
        track.panner.pan.value = track.pan;

        /*
         * Important:
         * Each HTML audio element gets only one MediaElementSource.
         */

        track.source = ctx.createMediaElementSource(audio);

        track.source.connect(track.gain);
        track.gain.connect(track.panner);

        /*
         * Track output enters the main EQ chain.
         */

        track.panner.connect(state.eqLow);

        /*
         * Parallel effect sends.
         */

        track.panner.connect(state.reverbSend);
        track.panner.connect(state.delaySend);
        track.panner.connect(state.chorusDelay);

        audio.addEventListener("loadedmetadata", () => {
            track.duration = audio.duration || 0;
            track.ready = true;

            updateTrackList();
            updateDurationDisplay();
        });

        audio.addEventListener("timeupdate", () => {
            if (track.id === state.activeTrackId) {
                updatePlaybackDisplay(track);
            }
        });

        audio.addEventListener("ended", () => {
            const anyPlaying = state.tracks.some(
                (item) => !item.audio.paused && !item.audio.ended
            );

            if (!anyPlaying) {
                state.isPlaying = false;
                updateTransportButtons();
            }
        });

        audio.addEventListener("error", () => {
            showToast(
                `Sagalee track kanaa banuun hin danda'amne: ${track.name}`,
                "error"
            );
        });

        state.tracks.push(track);

        if (state.activeTrackId === null) {
            state.activeTrackId = track.id;
        }

        updateTrackList();
        updateCurrentTrackName();

        return track;
    }

    async function decodeAudioFile(file) {
        const ctx = getAudioContext();

        const arrayBuffer = await file.arrayBuffer();

        return await ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    async function handleAudioFiles(files) {
        const audioFiles = Array.from(files || []).filter((file) => {
            return (
                file.type.startsWith("audio/") ||
                /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(file.name)
            );
        });

        if (!audioFiles.length) {
            showToast("Faayila audio sirrii filadhu.", "warning");
            return;
        }

        try {
            await resumeAudioContext();

            setStatus("Audio files loading...");

            for (const file of audioFiles) {
                const track = createTrack(file);

                try {
                    track.buffer = await decodeAudioFile(file);
                } catch (error) {
                    console.warn(
                        "Audio analysis buffer unavailable:",
                        file.name,
                        error
                    );
                }
            }

            setStatus("Audio ready");

            showToast(
                `${audioFiles.length} track fe'ame.`,
                "success"
            );
        } catch (error) {
            console.error(error);

            setStatus("Audio loading failed");

            showToast(
                error.message || "Audio fe'uun hin danda'amne.",
                "error"
            );
        }
    }

    function removeTrack(trackId) {
        const index = state.tracks.findIndex(
            (track) => track.id === trackId
        );

        if (index < 0) {
            return;
        }

        const track = state.tracks[index];

        track.audio.pause();

        try {
            track.source.disconnect();
            track.gain.disconnect();
            track.panner.disconnect();
        } catch (error) {
            console.warn(error);
        }

        if (track.audio.src.startsWith("blob:")) {
            URL.revokeObjectURL(track.audio.src);
        }

        track.audio.removeAttribute("src");
        track.audio.load();

        state.tracks.splice(index, 1);

        if (state.activeTrackId === trackId) {
            state.activeTrackId =
                state.tracks.length > 0
                    ? state.tracks[0].id
                    : null;
        }

        updateTrackList();
        updateCurrentTrackName();
        updateDurationDisplay();

        showToast("Track haqameera.", "success");
    }

    /* ========================================================
       TRACK LIST UI
       ======================================================== */

    function updateTrackList() {
        const trackList = $("trackList");

        if (!trackList) {
            return;
        }

        if (state.tracks.length === 0) {
            trackList.innerHTML = `
                <div class="empty-tracks">
                    <p>No audio tracks yet.</p>
                    <p>Upload audio to start your studio.</p>
                </div>
            `;

            return;
        }

        trackList.innerHTML = state.tracks.map((track) => {
            const selected =
                track.id === state.activeTrackId ? "active" : "";

            const muted = track.muted ? "checked" : "";
            const solo = track.solo ? "checked" : "";

            return `
                <div class="track-item ${selected}"
                     data-track-id="${track.id}">

                    <div class="track-header">
                        <button
                            type="button"
                            class="track-select"
                            data-action="select"
                            data-id="${track.id}"
                            title="Select track">
                            🎵
                        </button>

                        <div class="track-title">
                            <strong>${escapeHTML(track.name)}</strong>
                            <small>
                                ${formatTime(track.duration)}
                            </small>
                        </div>

                        <button
                            type="button"
                            class="track-delete"
                            data-action="delete"
                            data-id="${track.id}"
                            aria-label="Delete track">
                            ✕
                        </button>
                    </div>

                    <div class="track-controls">
                        <label>
                            Volume
                            <input
                                type="range"
                                min="0"
                                max="1.5"
                                step="0.01"
                                value="${track.volume}"
                                data-action="volume"
                                data-id="${track.id}">
                        </label>

                        <label>
                            Pan
                            <input
                                type="range"
                                min="-1"
                                max="1"
                                step="0.01"
                                value="${track.pan}"
                                data-action="pan"
                                data-id="${track.id}">
                        </label>

                        <label>
                            <input
                                type="checkbox"
                                data-action="mute"
                                data-id="${track.id}"
                                ${muted}>
                            Mute
                        </label>

                        <label>
                            <input
                                type="checkbox"
                                data-action="solo"
                                data-id="${track.id}"
                                ${solo}>
                            Solo
                        </label>
                    </div>
                </div>
            `;
        }).join("");

        updateTrackAudibility();
    }

    function updateTrackAudibility() {
        const anySolo = state.tracks.some((track) => track.solo);

        for (const track of state.tracks) {
            const shouldMute =
                track.muted || (anySolo && !track.solo);

            const targetGain = shouldMute ? 0 : track.volume;

            track.gain.gain.setTargetAtTime(
                targetGain,
                state.audioContext.currentTime,
                0.025
            );
        }
    }

    function findTrack(id) {
        return state.tracks.find(
            (track) => track.id === Number(id)
        );
    }

    /* ========================================================
       TRACK LIST EVENTS
       ======================================================== */

    const trackListElement = $("trackList");

    if (trackListElement) {
        trackListElement.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            const action = button.dataset.action;
            const trackId = Number(button.dataset.id);

            if (action === "select") {
                state.activeTrackId = trackId;

                updateTrackList();
                updateCurrentTrackName();
                updateDurationDisplay();

                return;
            }

            if (action === "delete") {
                removeTrack(trackId);
            }
        });

        trackListElement.addEventListener("input", (event) => {
            const input = event.target;

            if (!input.dataset.action) {
                return;
            }

            const track = findTrack(input.dataset.id);

            if (!track) {
                return;
            }

            const action = input.dataset.action;

            if (action === "volume") {
                track.volume = clamp(
                    safeNumber(input.value, 1),
                    0,
                    1.5
                );

                updateTrackAudibility();
            }

            if (action === "pan") {
                track.pan = clamp(
                    safeNumber(input.value, 0),
                    -1,
                    1
                );

                track.panner.pan.setTargetAtTime(
                    track.pan,
                    state.audioContext.currentTime,
                    0.025
                );
            }
        });

        trackListElement.addEventListener("change", (event) => {
            const input = event.target;

            if (!input.dataset.action) {
                return;
            }

            const track = findTrack(input.dataset.id);

            if (!track) {
                return;
            }

            if (input.dataset.action === "mute") {
                track.muted = input.checked;
                updateTrackAudibility();
                return;
            }

            if (input.dataset.action === "solo") {
                track.solo = input.checked;
                updateTrackAudibility();
            }
        });
    }

    /* ========================================================
       TRANSPORT CONTROLS
       ======================================================== */

    function getActiveTrack() {
        return state.tracks.find(
            (track) => track.id === state.activeTrackId
        ) || state.tracks[0] || null;
    }

    function updateCurrentTrackName() {
        const element = $("currentTrackName");
        const track = getActiveTrack();

        if (element) {
            element.textContent = track
                ? track.name
                : "No track selected";
        }
    }

    function updateDurationDisplay() {
        const track = getActiveTrack();

        const durationElement = $("duration");

        if (durationElement) {
            durationElement.textContent = formatTime(
                track ? track.duration : 0
            );
        }
    }

    function updatePlaybackDisplay(track) {
        const currentTimeElement = $("currentTime");
        const durationElement = $("duration");
        const seekBar = $("seekBar");

        if (currentTimeElement) {
            currentTimeElement.textContent = formatTime(
                track.audio.currentTime
            );
        }

        if (durationElement) {
            durationElement.textContent = formatTime(
                track.duration
            );
        }

        if (seekBar && track.duration > 0) {
            seekBar.value =
                (track.audio.currentTime / track.duration) * 100;
        }
    }

    async function playAllTracks() {
        if (!state.tracks.length) {
            showToast("Jalqaba audio upload godhi.", "warning");
            return;
        }

        try {
            await resumeAudioContext();

            const activeTrack = getActiveTrack();

            if (
                activeTrack &&
                activeTrack.audio.ended
            ) {
                state.tracks.forEach((track) => {
                    track.audio.currentTime = 0;
                });
            }

            const results = await Promise.allSettled(
                state.tracks.map((track) => {
                    if (track.audio.ended) {
                        track.audio.currentTime = 0;
                    }

                    return track.audio.play();
                })
            );

            const successful = results.some(
                (result) => result.status === "fulfilled"
            );

            if (!successful) {
                throw new Error(
                    "Audio playback browser keessatti hin jalqabne."
                );
            }

            state.isPlaying = true;

            updateTransportButtons();
            setStatus("Playing");
        } catch (error) {
            console.error(error);

            showToast(
                error.message || "Play gochuun hin danda'amne.",
                "error"
            );
        }
    }

    function pauseAllTracks() {
        state.tracks.forEach((track) => {
            track.audio.pause();
        });

        state.isPlaying = false;

        updateTransportButtons();
        setStatus("Paused");
    }

    function stopAllTracks() {
        state.tracks.forEach((track) => {
            track.audio.pause();

            try {
                track.audio.currentTime = 0;
            } catch (error) {
                console.warn(error);
            }
        });

        state.isPlaying = false;

        updateTransportButtons();

        const seekBar = $("seekBar");
        const currentTimeElement = $("currentTime");

        if (seekBar) {
            seekBar.value = 0;
        }

        if (currentTimeElement) {
            currentTimeElement.textContent = "00:00";
        }

        setStatus("Stopped");
    }

    function updateTransportButtons() {
        const playBtn = $("playBtn");
        const pauseBtn = $("pauseBtn");

        if (playBtn) {
            playBtn.disabled = state.isPlaying;
        }

        if (pauseBtn) {
            pauseBtn.disabled = !state.isPlaying;
        }
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

    if ($("seekBar")) {
        $("seekBar").addEventListener("input", () => {
            const track = getActiveTrack();

            if (!track || !track.duration) {
                return;
            }

            const percentage = clamp(
                safeNumber($("seekBar").value, 0),
                0,
                100
            );

            const newTime =
                (percentage / 100) * track.duration;

            state.tracks.forEach((item) => {
                if (Number.isFinite(item.duration)) {
                    item.audio.currentTime = clamp(
                        newTime,
                        0,
                        Math.max(0, item.duration - 0.01)
                    );
                }
            });
        });
    }

    /* ========================================================
       UPLOAD INPUTS
       ======================================================== */

    if ($("audioUpload")) {
        $("audioUpload").addEventListener("change", async (event) => {
            await handleAudioFiles(event.target.files);

            /*
             * Allow selecting the same file again.
             */

            event.target.value = "";
        });
    }

    if ($("addTrackBtn")) {
        $("addTrackBtn").addEventListener("click", () => {
            if ($("audioUpload")) {
                $("audioUpload").click();
            }
        });
    }

    /* ========================================================
       MIXER AND EFFECT CONTROLS
       ======================================================== */

    function setParam(param, value, min, max) {
        if (!param || !state.audioContext) {
            return;
        }

        const target = clamp(
            safeNumber(value, param.value),
            min,
            max
        );

        param.setTargetAtTime(
            target,
            state.audioContext.currentTime,
            0.025
        );
    }

    function connectControl(id, callback) {
        const element = $(id);

        if (!element) {
            return;
        }

        element.addEventListener("input", () => {
            try {
                callback(safeNumber(element.value, 0));
            } catch (error) {
                console.error(
                    `Control error: ${id}`,
                    error
                );
            }
        });
    }

    function updateAudioControls() {
        if (!state.audioContext) {
            return;
        }

        const ctx = state.audioContext;

        if ($("masterVolume") && state.masterGain) {
            setParam(
                state.masterGain.gain,
                safeNumber($("masterVolume").value, 0.8),
                0,
                1.5
            );
        }

        if ($("panControl") && state.masterPanner) {
            setParam(
                state.masterPanner.pan,
                safeNumber($("panControl").value, 0),
                -1,
                1
            );
        }

        if ($("bassControl") && state.eqLow) {
            setParam(
                state.eqLow.gain,
                safeNumber($("bassControl").value, 0),
                -18,
                18
            );
        }

        if ($("midControl") && state.eqMid) {
            setParam(
                state.eqMid.gain,
                safeNumber($("midControl").value, 0),
                -18,
                18
            );
        }

        if ($("trebleControl") && state.eqHigh) {
            setParam(
                state.eqHigh.gain,
                safeNumber($("trebleControl").value, 0),
                -18,
                18
            );
        }

        if ($("reverbControl") && state.reverbSend) {
            const amount = clamp(
                safeNumber($("reverbControl").value, 0),
                0,
                1
            );

            setParam(state.reverbSend.gain, amount, 0, 1);
        }

        if ($("delayControl") && state.delaySend) {
            const amount = clamp(
                safeNumber($("delayControl").value, 0),
                0,
                1
            );

            setParam(state.delaySend.gain, amount, 0, 1);
        }

        if ($("compressorControl") && state.masterCompressor) {
            const amount = clamp(
                safeNumber($("compressorControl").value, 50),
                0,
                100
            );

            state.masterCompressor.threshold.value =
                -6 - amount * 0.24;

            state.masterCompressor.ratio.value =
                1 + amount * 0.09;
        }

        if ($("noiseGateControl") && state.noiseGate) {
            const amount = clamp(
                safeNumber($("noiseGateControl").value, 30),
                0,
                100
            );

            state.noiseGate.threshold.value =
                -75 + amount * 0.5;

            state.noiseGate.ratio.value =
                1 + amount * 0.12;
        }

        if ($("chorusControl") && state.chorusGain) {
            setParam(
                state.chorusGain.gain,
                clamp(
                    safeNumber($("chorusControl").value, 0),
                    0,
                    1
                ) * 0.35,
                0,
                0.35
            );
        }

        if ($("limiterControl") && state.limiter) {
            const amount = clamp(
                safeNumber($("limiterControl").value, 70),
                0,
                100
            );

            state.limiter.threshold.value =
                -1 - amount * 0.08;

            state.limiter.ratio.value =
                5 + amount * 0.3;
        }
    }

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
        "limiterControl"
    ].forEach((id) => {
        connectControl(id, () => updateAudioControls());
    });

    /* ========================================================
       VOCAL PRESETS
       ======================================================== */

    function setControlValue(id, value) {
        const element = $(id);

        if (!element) {
            return;
        }

        element.value = String(value);

        element.dispatchEvent(
            new Event("input", { bubbles: true })
        );
    }

    function applyPreset(presetName) {
        const presets = {
            clean: {
                bass: 0,
                mid: 0,
                treble: 0,
                reverb: 0.05,
                delay: 0,
                compressor: 35,
                gate: 25,
                chorus: 0,
                limiter: 65
            },

            vocal: {
                bass: -2,
                mid: 2,
                treble: 3,
                reverb: 0.12,
                delay: 0.04,
                compressor: 55,
                gate: 35,
                chorus: 0.05,
                limiter: 75
            },

            podcast: {
                bass: -2,
                mid: 2,
                treble: 2,
                reverb: 0,
                delay: 0,
                compressor: 65,
                gate: 40,
                chorus: 0,
                limiter: 75
            },

            warm: {
                bass: 3,
                mid: 1,
                treble: -1,
                reverb: 0.15,
                delay: 0.03,
                compressor: 45,
                gate: 20,
                chorus: 0.1,
                limiter: 70
            },

            bright: {
                bass: -1,
                mid: 1,
                treble: 4,
                reverb: 0.08,
                delay: 0.02,
                compressor: 45,
                gate: 25,
                chorus: 0.03,
                limiter: 70
            }
        };

        const preset = presets[presetName] || presets.clean;

        setControlValue("bassControl", preset.bass);
        setControlValue("midControl", preset.mid);
        setControlValue("trebleControl", preset.treble);
        setControlValue("reverbControl", preset.reverb);
        setControlValue("delayControl", preset.delay);
        setControlValue("compressorControl", preset.compressor);
        setControlValue("noiseGateControl", preset.gate);
        setControlValue("chorusControl", preset.chorus);
        setControlValue("limiterControl", preset.limiter);

        updateAudioControls();

        showToast(
            `Preset applied: ${presetName}`,
            "success"
        );
    }

    if ($("applyPresetBtn")) {
        $("applyPresetBtn").addEventListener("click", () => {
            const presetName = $("vocalPreset")
                ? $("vocalPreset").value
                : "clean";

            applyPreset(presetName);
        });
    }

    if ($("resetEffectsBtn")) {
        $("resetEffectsBtn").addEventListener("click", () => {
            setControlValue("bassControl", 0);
            setControlValue("midControl", 0);
            setControlValue("trebleControl", 0);
            setControlValue("reverbControl", 0);
            setControlValue("delayControl", 0);
            setControlValue("compressorControl", 35);
            setControlValue("noiseGateControl", 20);
            setControlValue("chorusControl", 0);
            setControlValue("limiterControl", 65);

            updateAudioControls();

            showToast("Effects reset godhameera.", "success");
        });
    }

    /* ========================================================
       AUTOMATIC AUDIO ANALYSIS
       ======================================================== */

    function analyzeAudioBuffer(buffer) {
        if (!buffer) {
            return null;
        }

        let sumSquares = 0;
        let peak = 0;
        let count = 0;

        const sampleLimit = 200000;
        const totalSamples = buffer.length;

        const stride = Math.max(
            1,
            Math.floor(totalSamples / sampleLimit)
        );

        for (
            let channel = 0;
            channel < buffer.numberOfChannels;
            channel++
        ) {
            const samples = buffer.getChannelData(channel);

            for (let i = 0; i < samples.length; i += stride) {
                const sample = samples[i];

                sumSquares += sample * sample;
                peak = Math.max(peak, Math.abs(sample));
                count++;
            }
        }

        const rms = count > 0
            ? Math.sqrt(sumSquares / count)
            : 0;

        const rmsDb = rms > 0
            ? 20 * Math.log10(rms)
            : -100;

        const peakDb = peak > 0
            ? 20 * Math.log10(peak)
            : -100;

        return {
            rms,
            rmsDb,
            peak,
            peakDb,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels
        };
    }

    function calculateTrackTargetGain(analysis) {
        if (!analysis || analysis.rms < 0.00001) {
            return 1;
        }

        /*
         * Aim for a reasonable RMS target.
         * This is a practical heuristic, not LUFS mastering.
         */

        const targetRms = 0.12;

        let gain = targetRms / analysis.rms;

        /*
         * Protect peaks from excessive gain.
         */

        if (analysis.peak > 0) {
            const peakSafetyGain = 0.82 / analysis.peak;
            gain = Math.min(gain, peakSafetyGain);
        }

        return clamp(gain, 0.15, 1.5);
    }

    function updateTrackVolumeUI(track) {
        const input = document.querySelector(
            `[data-action="volume"][data-id="${track.id}"]`
        );

        if (input) {
            input.value = String(track.volume);
        }
    }

    function updateMasterVolumeUI(value) {
        const input = $("masterVolume");

        if (input) {
            input.value = String(value);
        }
    }

    function updateEffectsUI(values) {
        const controls = {
            bassControl: values.bass,
            midControl: values.mid,
            trebleControl: values.treble,
            reverbControl: values.reverb,
            delayControl: values.delay,
            compressorControl: values.compressor,
            noiseGateControl: values.gate,
            chorusControl: values.chorus,
            limiterControl: values.limiter
        };

        Object.entries(controls).forEach(([id, value]) => {
            if ($(id)) {
                $(id).value = String(value);
            }
        });

        updateAudioControls();
    }

    function getSnapshot() {
        return {
            tracks: state.tracks.map((track) => ({
                id: track.id,
                volume: track.volume,
                pan: track.pan,
                muted: track.muted,
                solo: track.solo
            })),

            controls: {
                masterVolume: $("masterVolume")
                    ? $("masterVolume").value
                    : "0.8",

                panControl: $("panControl")
                    ? $("panControl").value
                    : "0",

                bassControl: $("bassControl")
                    ? $("bassControl").value
                    : "0",

                midControl: $("midControl")
                    ? $("midControl").value
                    : "0",

                trebleControl: $("trebleControl")
                    ? $("trebleControl").value
                    : "0",

                reverbControl: $("reverbControl")
                    ? $("reverbControl").value
                    : "0",

                delayControl: $("delayControl")
                    ? $("delayControl").value
                    : "0",

                compressorControl: $("compressorControl")
                    ? $("compressorControl").value
                    : "35",

                noiseGateControl: $("noiseGateControl")
                    ? $("noiseGateControl").value
                    : "20",

                chorusControl: $("chorusControl")
                    ? $("chorusControl").value
                    : "0",

                limiterControl: $("limiterControl")
                    ? $("limiterControl").value
                    : "65"
            }
        };
    }

    function restoreSnapshot(snapshot) {
        if (!snapshot) {
            return;
        }

        for (const item of snapshot.tracks) {
            const track = findTrack(item.id);

            if (!track) {
                continue;
            }

            track.volume = item.volume;
            track.pan = item.pan;
            track.muted = item.muted;
            track.solo = item.solo;

            track.panner.pan.value = item.pan;

            updateTrackVolumeUI(track);
        }

        Object.entries(snapshot.controls).forEach(([id, value]) => {
            if ($(id)) {
                $(id).value = value;
            }
        });

        updateAudioControls();
        updateTrackAudibility();
        updateTrackList();
    }

    /* ========================================================
       AUTO ADJUST ALL
       ======================================================== */

    async function autoAdjustAll() {
        if (state.autoAdjusting) {
            return;
        }

        if (!state.tracks.length) {
            showToast(
                "Jalqaba audio upload godhi; achii Auto Adjust All cuqaasi.",
                "warning"
            );

            return;
        }

        state.autoAdjusting = true;

        const button = $("autoAdjustAllBtn");

        if (button) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = "🔍 ANALYZING AUDIO...";
        }

        state.autoAdjustSnapshot = getSnapshot();

        try {
            await resumeAudioContext();

            setStatus("Analyzing audio...");

            showToast("Sagalee xiinxamaa jira...", "info");

            const analyses = [];

            for (let i = 0; i < state.tracks.length; i++) {
                const track = state.tracks[i];

                if (!track.buffer) {
                    try {
                        track.buffer = await decodeAudioFile(track.file);
                    } catch (error) {
                        console.warn(
                            `Could not decode ${track.name}`,
                            error
                        );
                    }
                }

                const analysis = analyzeAudioBuffer(track.buffer);

                if (analysis) {
                    analyses.push({
                        track,
                        analysis
                    });
                }

                if (button) {
                    button.textContent =
                        `🔍 ANALYZING ${i + 1}/${state.tracks.length}...`;
                }

                await sleep(15);
            }

            if (!analyses.length) {
                throw new Error(
                    "Audio xiinxaluuf buffer hin argamne. Faayila biraa yaali."
                );
            }

            setStatus("Balancing track volumes...");

            if (button) {
                button.textContent = "🎚️ BALANCING VOLUMES...";
            }

            /*
             * Automatically balance the tracks.
             */

            const gains = analyses.map(({ analysis }) => {
                return calculateTrackTargetGain(analysis);
            });

            const averageGain = gains.reduce(
                (sum, gain) => sum + gain,
                0
            ) / gains.length;

            analyses.forEach(({ track, analysis }, index) => {
                const rawGain = gains[index];

                /*
                 * Keep track differences under control.
                 */

                const balancedGain = clamp(
                    rawGain / Math.max(0.5, averageGain),
                    0.25,
                    1.5
                );

                track.volume = balancedGain;

                /*
                 * Audio with very high peaks receives conservative gain.
                 */

                if (analysis.peak > 0.98) {
                    track.volume = Math.min(track.volume, 0.85);
                }

                track.gain.gain.setTargetAtTime(
                    track.muted ? 0 : track.volume,
                    state.audioContext.currentTime,
                    0.08
                );

                updateTrackVolumeUI(track);
            });

            /*
             * AUTO EQ
             *
             * Browser-side RMS analysis cannot reliably identify
             * every frequency problem. Use conservative EQ values.
             */

            setStatus("Applying automatic EQ...");

            if (button) {
                button.textContent = "🎛️ OPTIMIZING EQ...";
            }

            const averageRms = analyses.reduce(
                (sum, item) => sum + item.analysis.rms,
                0
            ) / analyses.length;

            const averagePeak = analyses.reduce(
                (sum, item) => sum + item.analysis.peak,
                0
            ) / analyses.length;

            let bass = 0;
            let mid = 0;
            let treble = 0;

            if (averageRms < 0.06) {
                bass = 1;
                mid = 1;
                treble = 1.5;
            } else if (averagePeak > 0.95) {
                bass = -1;
                mid = 0;
                treble = 0.5;
            } else {
                bass = 0;
                mid = 1;
                treble = 1;
            }

            /*
             * AUTO MIX AND MASTERING SETTINGS
             */

            setStatus("Applying compression and mastering...");

            if (button) {
                button.textContent = "💎 MASTERING AUDIO...";
            }

            const masterVolume = clamp(
                0.82 / Math.max(0.55, averagePeak),
                0.45,
                0.95
            );

            updateMasterVolumeUI(masterVolume);

            /*
             * Choose conservative settings to avoid over-processing.
             */

            const effects = {
                bass,
                mid,
                treble,

                reverb: 0.08,
                delay: 0.025,

                compressor: 42,
                gate: 20,

                chorus: 0,
                limiter: 75
            };

            updateEffectsUI(effects);

            /*
             * Vocal enhancement preset can be applied separately.
             * Do not assume every track is a vocal recording.
             */

            setStatus("Finalizing mix...");

            if (button) {
                button.textContent = "✨ FINALIZING...";
            }

            updateTrackAudibility();
            updateTrackList();

            await sleep(250);

            setStatus("Auto adjustment complete");

            showToast(
                "✅ Auto Adjust All xumurameera! Volume, mixing, EQ fi mastering sirreeffamaniiru.",
                "success"
            );
        } catch (error) {
            console.error("Auto Adjust All error:", error);

            setStatus("Auto adjustment failed");

            showToast(
                error.message || "Auto Adjustment hin milkoofne.",
                "error"
            );
        } finally {
            state.autoAdjusting = false;

            if (button) {
                button.disabled = false;
                button.textContent = "✨ AUTO ADJUST ALL";
            }
        }
    }

    /*
     * Create the single automatic adjustment button.
     * It is inserted into the mastering section if one exists.
     */

    function createAutoAdjustButton() {
        if ($("autoAdjustAllBtn")) {
            return;
        }

        const button = document.createElement("button");

        button.id = "autoAdjustAllBtn";
        button.type = "button";
        button.textContent = "✨ AUTO ADJUST ALL";

        button.style.cssText = `
            display: block;
            width: 100%;
            min-height: 58px;
            margin: 18px 0;
            padding: 16px 22px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 16px;
            color: #ffffff;
            background: linear-gradient(135deg, #7c3aed, #2563eb, #06b6d4);
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 1px;
            cursor: pointer;
            box-shadow: 0 8px 25px rgba(37,99,235,0.25);
            transition: transform 0.2s ease, opacity 0.2s ease;
        `;

        button.addEventListener("mouseenter", () => {
            if (!button.disabled) {
                button.style.transform = "translateY(-2px)";
            }
        });

        button.addEventListener("mouseleave", () => {
            button.style.transform = "translateY(0)";
        });

        button.addEventListener("click", autoAdjustAll);

        const masteringSection = $("masteringSection");

        if (masteringSection) {
            const heading = masteringSection.querySelector("h1, h2, h3");

            if (heading && heading.parentElement) {
                heading.parentElement.insertBefore(
                    button,
                    heading.nextSibling
                );
            } else {
                masteringSection.prepend(button);
            }
        } else {
            const main =
                document.querySelector("main") ||
                document.querySelector(".main-content") ||
                document.body;

            main.prepend(button);
        }
    }

    createAutoAdjustButton();

    /* ========================================================
       VIRTUAL PIANO KEYBOARD
       ======================================================== */

    const pianoNotes = [
        { key: "A", note: "C4", frequency: 261.63 },
        { key: "W", note: "C#4", frequency: 277.18, black: true },
        { key: "S", note: "D4", frequency: 293.66 },
        { key: "E", note: "D#4", frequency: 311.13, black: true },
        { key: "D", note: "E4", frequency: 329.63 },
        { key: "F", note: "F4", frequency: 349.23 },
        { key: "T", note: "F#4", frequency: 369.99, black: true },
        { key: "G", note: "G4", frequency: 392.00 },
        { key: "Y", note: "G#4", frequency: 415.30, black: true },
        { key: "H", note: "A4", frequency: 440.00 },
        { key: "U", note: "A#4", frequency: 466.16, black: true },
        { key: "J", note: "B4", frequency: 493.88 },
        { key: "K", note: "C5", frequency: 523.25 }
    ];

    function createKeyboardUI() {
        const keyboard = $("pianoKeyboard");

        if (!keyboard) {
            return;
        }

        if (keyboard.children.length > 0) {
            return;
        }

        keyboard.innerHTML = "";

        keyboard.style.display = "flex";
        keyboard.style.alignItems = "stretch";
        keyboard.style.gap = "3px";
        keyboard.style.overflowX = "auto";
        keyboard.style.padding = "12px";
        keyboard.style.minHeight = "160px";

        pianoNotes.forEach((note) => {
            const key = document.createElement("button");

            key.type = "button";
            key.className = note.black
                ? "piano-key black-key"
                : "piano-key white-key";

            key.dataset.frequency = String(note.frequency);
            key.dataset.note = note.note;
            key.dataset.key = note.key;

            key.textContent = `${note.note}\n${note.key}`;

            key.style.cssText = `
                flex: 1 0 42px;
                min-width: 42px;
                min-height: 120px;
                border: 1px solid #777;
                border-radius: 0 0 7px 7px;
                white-space: pre-line;
                font-size: 11px;
                cursor: pointer;
                color: ${note.black ? "#fff" : "#111"};
                background: ${note.black ? "#252535" : "#f9fafb"};
                box-shadow: 0 3px 5px rgba(0,0,0,0.2);
            `;

            key.addEventListener("pointerdown", async (event) => {
                event.preventDefault();

                await startKeyboardNote(
                    note.note,
                    note.frequency
                );

                key.style.transform = "translateY(2px)";
            });

            const release = () => {
                stopKeyboardNote(note.note);
                key.style.transform = "translateY(0)";
            };

            key.addEventListener("pointerup", release);
            key.addEventListener("pointerleave", release);
            key.addEventListener("pointercancel", release);

            keyboard.appendChild(key);
        });
    }

    async function startKeyboardNote(noteName, frequency) {
        try {
            await resumeAudioContext();

            if (state.keyboardOscillators.has(noteName)) {
                return;
            }

            const ctx = state.audioContext;

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = "triangle";
            oscillator.frequency.value = frequency;

            const volume = $("keyboardVolume")
                ? clamp(
                    safeNumber($("keyboardVolume").value, 0.3),
                    0,
                    1
                )
                : 0.3;

            gain.gain.value = 0;

            oscillator.connect(gain);

            /*
             * Keyboard notes go through the main mix and effects.
             */

            gain.connect(state.eqLow);
            gain.connect(state.reverbSend);
            gain.connect(state.delaySend);

            oscillator.start();

            gain.gain.setTargetAtTime(
                volume,
                ctx.currentTime,
                0.015
            );

            state.keyboardOscillators.set(noteName, {
                oscillator,
                gain,
                startedAt: ctx.currentTime
            });

            if (state.keyboardRecording) {
                state.keyboardEvents.push({
                    note: noteName,
                    frequency,
                    time:
                        ctx.currentTime -
                        state.keyboardRecordingStart,
                    duration: null,
                    volume
                });
            }
        } catch (error) {
            console.error(error);

            showToast(
                "Keyboard taphachuun hin danda'amne.",
                "error"
            );
        }
    }

    function stopKeyboardNote(noteName) {
        const item = state.keyboardOscillators.get(noteName);

        if (!item) {
            return;
        }

        const ctx = state.audioContext;
        const now = ctx.currentTime;

        item.gain.gain.cancelScheduledValues(now);
        item.gain.gain.setTargetAtTime(0, now, 0.025);

        try {
            item.oscillator.stop(now + 0.15);
        } catch (error) {
            console.warn(error);
        }

        const elapsed = now - item.startedAt;

        if (state.keyboardRecording) {
            const event = [...state.keyboardEvents]
                .reverse()
                .find((entry) => {
                    return (
                        entry.note === noteName &&
                        entry.duration === null
                    );
                });

            if (event) {
                event.duration = Math.max(0.08, elapsed);
            }
        }

        state.keyboardOscillators.delete(noteName);
    }

    const activeComputerKeys = new Set();

    window.addEventListener("keydown", async (event) => {
        if (event.repeat) {
            return;
        }

        const tag = event.target && event.target.tagName;

        if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            event.target.isContentEditable
        ) {
            return;
        }

        const key = event.key.toUpperCase();

        const note = pianoNotes.find(
            (item) => item.key === key
        );

        if (!note || activeComputerKeys.has(key)) {
            return;
        }

        activeComputerKeys.add(key);

        await startKeyboardNote(
            note.note,
            note.frequency
        );
    });

    window.addEventListener("keyup", (event) => {
        const key = event.key.toUpperCase();

        const note = pianoNotes.find(
            (item) => item.key === key
        );

        if (!note) {
            return;
        }

        activeComputerKeys.delete(key);
        stopKeyboardNote(note.note);
    });

    window.addEventListener("blur", () => {
        activeComputerKeys.clear();

        for (const noteName of state.keyboardOscillators.keys()) {
            stopKeyboardNote(noteName);
        }
    });

    createKeyboardUI();

    /* ========================================================
       KEYBOARD PERFORMANCE RECORDING
       ======================================================== */

    function startKeyboardRecording() {
        state.keyboardEvents = [];
        state.keyboardRecording = true;

        state.keyboardRecordingStart =
            state.audioContext.currentTime;

        showToast(
            "Keyboard recording started. Play your notes.",
            "success"
        );

        if ($("recordKeyboardBtn")) {
            $("recordKeyboardBtn").textContent =
                "⏹ Stop Keyboard Recording";
        }
    }

    function stopKeyboardRecording() {
        state.keyboardRecording = false;

        for (const noteName of state.keyboardOscillators.keys()) {
            stopKeyboardNote(noteName);
        }

        if ($("recordKeyboardBtn")) {
            $("recordKeyboardBtn").textContent =
                "🎹 Record Keyboard";
        }

        showToast(
            `${state.keyboardEvents.length} keyboard events recorded.`,
            "success"
        );
    }

    if ($("recordKeyboardBtn")) {
        $("recordKeyboardBtn").addEventListener("click", async () => {
            await resumeAudioContext();

            if (state.keyboardRecording) {
                stopKeyboardRecording();
            } else {
                startKeyboardRecording();
            }
        });
    }

    /* ========================================================
       MICROPHONE RECORDING
       ======================================================== */

    async function startMicrophoneRecording() {
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {
            showToast(
                "Microphone recording browser kana keessatti hin deeggaramu.",
                "error"
            );

            return;
        }

        try {
            await resumeAudioContext();

            state.microphoneStream =
                await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

            state.microphoneChunks = [];

            const options = {};

            if (
                window.MediaRecorder &&
                MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ) {
                options.mimeType = "audio/webm;codecs=opus";
            }

            state.microphoneRecorder = new MediaRecorder(
                state.microphoneStream,
                options
            );

            state.microphoneRecorder.addEventListener(
                "dataavailable",
                (event) => {
                    if (event.data && event.data.size > 0) {
                        state.microphoneChunks.push(event.data);
                    }
                }
            );

            state.microphoneRecorder.addEventListener(
                "stop",
                async () => {
                    const blob = new Blob(
                        state.microphoneChunks,
                        {
                            type:
                                state.microphoneRecorder.mimeType ||
                                "audio/webm"
                        }
                    );

                    const file = new File(
                        [blob],
                        `naol-recording-${Date.now()}.webm`,
                        {
                            type: blob.type
                        }
                    );

                    await handleAudioFiles([file]);

                    if (state.microphoneStream) {
                        state.microphoneStream
                            .getTracks()
                            .forEach((track) => track.stop());

                        state.microphoneStream = null;
                    }

                    setStatus("Recording saved");
                }
            );

            state.microphoneRecorder.start();

            state.recordingStartedAt = Date.now();

            state.recordingTimer = setInterval(() => {
                const elapsed =
                    (Date.now() - state.recordingStartedAt) / 1000;

                const recordStatus = $("recordStatus");

                if (recordStatus) {
                    recordStatus.textContent =
                        `Recording: ${formatTime(elapsed)}`;
                }
            }, 250);

            if ($("recordBtn")) {
                $("recordBtn").disabled = true;
            }

            if ($("stopRecordBtn")) {
                $("stopRecordBtn").disabled = false;
            }

            setStatus("Recording microphone");
            showToast("Microphone recording started.", "success");
        } catch (error) {
            console.error(error);

            showToast(
                error.message ||
                "Microphone access hin argamne. Permission ilaali.",
                "error"
            );
        }
    }

    function stopMicrophoneRecording() {
        if (
            state.microphoneRecorder &&
            state.microphoneRecorder.state !== "inactive"
        ) {
            state.microphoneRecorder.stop();
        }

        clearInterval(state.recordingTimer);

        if ($("recordBtn")) {
            $("recordBtn").disabled = false;
        }

        if ($("stopRecordBtn")) {
            $("stopRecordBtn").disabled = true;
        }

        if ($("recordStatus")) {
            $("recordStatus").textContent = "Recording stopped";
        }
    }

    if ($("recordBtn")) {
        $("recordBtn").addEventListener(
            "click",
            startMicrophoneRecording
        );
    }

    if ($("stopRecordBtn")) {
        $("stopRecordBtn").disabled = true;

        $("stopRecordBtn").addEventListener(
            "click",
            stopMicrophoneRecording
        );
    }

    /* ========================================================
       SAVE PROJECT SETTINGS
       ======================================================== */

    function saveProject() {
        const project = {
            application: "Naol Music Studio",
            version: "3.0",
            savedAt: new Date().toISOString(),

            tracks: state.tracks.map((track) => ({
                name: track.name,
                volume: track.volume,
                pan: track.pan,
                muted: track.muted,
                solo: track.solo
            })),

            controls: {
                masterVolume: $("masterVolume")
                    ? $("masterVolume").value
                    : "0.8",

                panControl: $("panControl")
                    ? $("panControl").value
                    : "0",

                bassControl: $("bassControl")
                    ? $("bassControl").value
                    : "0",

                midControl: $("midControl")
                    ? $("midControl").value
                    : "0",

                trebleControl: $("trebleControl")
                    ? $("trebleControl").value
                    : "0",

                reverbControl: $("reverbControl")
                    ? $("reverbControl").value
                    : "0",

                delayControl: $("delayControl")
                    ? $("delayControl").value
                    : "0",

                compressorControl: $("compressorControl")
                    ? $("compressorControl").value
                    : "35",

                noiseGateControl: $("noiseGateControl")
                    ? $("noiseGateControl").value
                    : "20",

                chorusControl: $("chorusControl")
                    ? $("chorusControl").value
                    : "0",

                limiterControl: $("limiterControl")
                    ? $("limiterControl").value
                    : "65"
            },

            keyboardEvents: state.keyboardEvents
        };

        const blob = new Blob(
            [JSON.stringify(project, null, 2)],
            { type: "application/json" }
        );

        downloadBlob(
            blob,
            `naol-music-project-${Date.now()}.json`
        );

        showToast(
            "Project settings saved. Audio files separately save godhi.",
            "success"
        );
    }

    if ($("saveProjectBtn")) {
        $("saveProjectBtn").addEventListener(
            "click",
            saveProject
        );
    }

    /* ========================================================
       FILE DOWNLOAD HELPER
       ======================================================== */

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1500);
    }

    /* ========================================================
       WEBM EXPORT
       ======================================================== */

    async function exportWebM() {
        if (!state.tracks.length) {
            showToast(
                "Export dura audio upload godhi.",
                "warning"
            );

            return;
        }

        try {
            await resumeAudioContext();

            if (!state.masterGain) {
                throw new Error("Audio engine hin jalqabne.");
            }

            if (!state.audioContext.createMediaStreamDestination) {
                throw new Error(
                    "Browser kun WebM audio export hin deeggaru."
                );
            }

            const destination =
                state.audioContext.createMediaStreamDestination();

            state.masterGain.connect(destination);

            const mimeType =
                MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                    ? "audio/webm;codecs=opus"
                    : "audio/webm";

            const recorder = new MediaRecorder(
                destination.stream,
                { mimeType }
            );

            const chunks = [];

            recorder.addEventListener("dataavailable", (event) => {
                if (event.data && event.data.size > 0) {
                    chunks.push(event.data);
                }
            });

            recorder.addEventListener("stop", () => {
                const blob = new Blob(chunks, {
                    type: mimeType
                });

                downloadBlob(
                    blob,
                    `naol-mix-${Date.now()}.webm`
                );

                try {
                    state.masterGain.disconnect(destination);
                } catch (error) {
                    console.warn(error);
                }

                showToast("WebM export xumurameera.", "success");
            });

            recorder.start();

            const startingTimes = state.tracks.map(
                (track) => track.audio.currentTime
            );

            await playAllTracks();

            const longestDuration = Math.max(
                ...state.tracks.map((track) => {
                    return Math.max(
                        0,
                        track.duration - track.audio.currentTime
                    );
                })
            );

            await sleep(Math.max(100, longestDuration * 1000));

            pauseAllTracks();

            if (recorder.state !== "inactive") {
                recorder.stop();
            }

            state.tracks.forEach((track, index) => {
                track.audio.currentTime =
                    startingTimes[index] || 0;
            });
        } catch (error) {
            console.error(error);

            showToast(
                error.message || "WebM export hin milkoofne.",
                "error"
            );
        }
    }

    /* ========================================================
       WAV EXPORT — OFFLINE RENDER
       ======================================================== */

    async function exportWav() {
        if (!state.tracks.length) {
            showToast(
                "Jalqaba audio upload godhi.",
                "warning"
            );

            return;
        }

        try {
            setStatus("Preparing WAV export...");

            showToast("WAV render jalqabame...", "info");

            const OfflineContextClass =
                window.OfflineAudioContext ||
                window.webkitOfflineAudioContext;

            if (!OfflineContextClass) {
                throw new Error(
                    "Browser kun offline WAV rendering hin deeggaru."
                );
            }

            const decodedTracks = [];

            for (const track of state.tracks) {
                let buffer = track.buffer;

                if (!buffer) {
                    buffer = await decodeAudioFile(track.file);
                    track.buffer = buffer;
                }

                decodedTracks.push({
                    track,
                    buffer
                });
            }

            const duration = Math.max(
                ...decodedTracks.map(({ buffer }) => buffer.duration)
            );

            const sampleRate = 44100;

            /*
             * Additional time allows short effect tails.
             */

            const renderDuration = Math.min(
                duration + 2.5,
                600
            );

            const frameCount = Math.ceil(
                renderDuration * sampleRate
            );

            const offline = new OfflineContextClass(
                2,
                frameCount,
                sampleRate
            );

            const low = offline.createBiquadFilter();
            low.type = "lowshelf";
            low.frequency.value = 120;
            low.gain.value = $("bassControl")
                ? safeNumber($("bassControl").value, 0)
                : 0;

            const mid = offline.createBiquadFilter();
            mid.type = "peaking";
            mid.frequency.value = 1000;
            mid.Q.value = 0.8;
            mid.gain.value = $("midControl")
                ? safeNumber($("midControl").value, 0)
                : 0;

            const high = offline.createBiquadFilter();
            high.type = "highshelf";
            high.frequency.value = 8000;
            high.gain.value = $("trebleControl")
                ? safeNumber($("trebleControl").value, 0)
                : 0;

            const compressor = offline.createDynamicsCompressor();

            const compressorAmount = $("compressorControl")
                ? safeNumber($("compressorControl").value, 42)
                : 42;

            compressor.threshold.value =
                -6 - clamp(compressorAmount, 0, 100) * 0.24;

            compressor.ratio.value =
                1 + clamp(compressorAmount, 0, 100) * 0.09;

            const limiter = offline.createDynamicsCompressor();

            limiter.threshold.value = -3;
            limiter.knee.value = 0;
            limiter.ratio.value = 20;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.1;

            const master = offline.createGain();

            master.gain.value = $("masterVolume")
                ? clamp(
                    safeNumber($("masterVolume").value, 0.8),
                    0,
                    1.5
                )
                : 0.8;

            const pan = offline.createStereoPanner();

            pan.pan.value = $("panControl")
                ? clamp(
                    safeNumber($("panControl").value, 0),
                    -1,
                    1
                )
                : 0;

            low.connect(mid);
            mid.connect(high);
            high.connect(compressor);
            compressor.connect(limiter);
            limiter.connect(pan);
            pan.connect(master);
            master.connect(offline.destination);

            decodedTracks.forEach(({ track, buffer }) => {
                const source = offline.createBufferSource();

                source.buffer = buffer;

                const gain = offline.createGain();

                gain.gain.value =
                    track.muted ||
                    (
                        decodedTracks.some((item) => item.track.solo) &&
                        !track.solo
                    )
                        ? 0
                        : clamp(track.volume, 0, 1.5);

                const panner = offline.createStereoPanner();
                panner.pan.value = clamp(track.pan, -1, 1);

                source.connect(gain);
                gain.connect(panner);
                panner.connect(low);

                source.start(0);
            });

            /*
             * Reverb and delay are deliberately omitted from this
             * simple offline WAV render. The live preview uses them.
             */

            setStatus("Rendering WAV...");

            const renderedBuffer = await offline.startRendering();

            const wavBlob = audioBufferToWav(renderedBuffer);

            downloadBlob(
                wavBlob,
                `naol-mastered-${Date.now()}.wav`
            );

            setStatus("WAV export complete");

            showToast(
                "WAV export xumurameera.",
                "success"
            );
        } catch (error) {
            console.error(error);

            setStatus("WAV export failed");

            showToast(
                error.message || "WAV export hin milkoofne.",
                "error"
            );
        }
    }

    function audioBufferToWav(buffer) {
        const channels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bitsPerSample = 16;

        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = channels * bytesPerSample;

        const dataLength =
            buffer.length * channels * bytesPerSample;

        const arrayBuffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(arrayBuffer);

        function writeString(offset, text) {
            for (let i = 0; i < text.length; i++) {
                view.setUint8(offset + i, text.charCodeAt(i));
            }
        }

        writeString(0, "RIFF");
        view.setUint32(4, 36 + dataLength, true);
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
        view.setUint16(34, bitsPerSample, true);
        writeString(36, "data");
        view.setUint32(40, dataLength, true);

        const channelData = [];

        for (let channel = 0; channel < channels; channel++) {
            channelData.push(buffer.getChannelData(channel));
        }

        let offset = 44;

        for (let i = 0; i < buffer.length; i++) {
            for (let channel = 0; channel < channels; channel++) {
                let sample = clamp(
                    channelData[channel][i],
                    -1,
                    1
                );

                sample = sample < 0
                    ? sample * 32768
                    : sample * 32767;

                view.setInt16(offset, sample, true);

                offset += 2;
            }
        }

        return new Blob(
            [arrayBuffer],
            { type: "audio/wav" }
        );
    }

    /* ========================================================
       EXPORT BUTTONS
       ======================================================== */

    async function exportSelectedFormat() {
        const format = $("exportFormat")
            ? $("exportFormat").value.toLowerCase()
            : "wav";

        if (format.includes("webm")) {
            await exportWebM();
        } else {
            await exportWav();
        }
    }

    if ($("exportBtn")) {
        $("exportBtn").addEventListener(
            "click",
            exportSelectedFormat
        );
    }

    if ($("masterExportBtn")) {
        $("masterExportBtn").addEventListener(
            "click",
            exportWav
        );
    }

    /* ========================================================
       LIVE MASTER LEVEL METER
       ======================================================== */

    function startMasterMeter() {
        if (!state.audioContext || state.animationFrame) {
            return;
        }

        const analyser = state.audioContext.createAnalyser();

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        /*
         * Connect an analyser without interrupting audio output.
         */

        state.masterGain.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        function drawMeter() {
            analyser.getByteFrequencyData(data);

            let sum = 0;

            for (const value of data) {
                sum += value * value;
            }

            const rms = Math.sqrt(sum / data.length);
            const level = clamp(rms / 150, 0, 1);

            const meter = $("masterMeter");

            if (meter) {
                if (meter.tagName === "METER" ||
                    meter.tagName === "PROGRESS") {
                    meter.value = level;
                } else {
                    meter.style.width = `${level * 100}%`;

                    meter.setAttribute(
                        "aria-valuenow",
                        String(Math.round(level * 100))
                    );
                }
            }

            state.animationFrame =
                requestAnimationFrame(drawMeter);
        }

        drawMeter();
    }

    /* ========================================================
       NAVIGATION
       ======================================================== */

    const navItems = document.querySelectorAll(
        ".nav-item[data-section]"
    );

    navItems.forEach((item) => {
        item.addEventListener("click", () => {
            const sectionName = item.dataset.section;

            navItems.forEach((nav) => {
                nav.classList.toggle("active", nav === item);
            });

            document.querySelectorAll(
                "#studioSection, #effectsSection, #vocalSection, #keyboardSection, #masteringSection"
            ).forEach((section) => {
                section.hidden = true;
                section.style.display = "none";
            });

            const target = $(sectionName);

            if (target) {
                target.hidden = false;
                target.style.display = "";
            }
        });
    });

    /* ========================================================
       DRAG AND DROP AUDIO
       ======================================================== */

    document.addEventListener("dragover", (event) => {
        event.preventDefault();
    });

    document.addEventListener("drop", async (event) => {
        event.preventDefault();

        const files = Array.from(event.dataTransfer.files || []);

        if (files.some((file) => {
            return (
                file.type.startsWith("audio/") ||
                /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(file.name)
            );
        })) {
            await handleAudioFiles(files);
        }
    });

    /* ========================================================
       INITIALIZATION
       ======================================================== */

    updateTransportButtons();
    updateCurrentTrackName();
    updateDurationDisplay();

    if ($("stopRecordBtn")) {
        $("stopRecordBtn").disabled = true;
    }

    setStatus("Naol Music Studio ready");

    console.log(
        "%cNaol Music Studio ready!",
        "font-size:16px;font-weight:bold;color:#7c3aed"
    );

    console.log(
        "Upload audio and click ✨ AUTO ADJUST ALL."
    );
});
