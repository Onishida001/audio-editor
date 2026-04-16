/* ──────────────────────────────────────────
   WAVECUT — app.js
   Audio Editor: cut, split, speed, pitch,
   reverb, bass boost, volume
   Export: WAV + MP3 (via lamejs)
────────────────────────────────────────── */

"use strict";

// ── STATE ────────────────────────────────
let audioCtx = null;
let origBuffer = null;
let workBuffer = null;
let history = []; // undo stack (AudioBuffer[])
let splitPoints = []; // seconds[]
let selStart = -1;
let selEnd = -1;
let isSelMode = false;
let isDragging = false;

// playback
let srcNode = null;
let gainNode = null;
let bassFilter = null;
let dryGain = null;
let wetGain = null;
let convolver = null;
let isPlaying = false;
let startedAt = 0;
let pausedAt = 0;
let animFrameId = null;

// ── DOM ──────────────────────────────────
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const editorEl = document.getElementById("editor");
const fileNameEl = document.getElementById("fileName");
const fileDurEl = document.getElementById("fileDur");
const waveCanvas = document.getElementById("waveCanvas");
const waveBox = document.getElementById("waveBox");
const selOverlay = document.getElementById("selOverlay");
const playheadEl = document.getElementById("playhead");
const posDisplay = document.getElementById("posDisplay");

const btnPlay = document.getElementById("btnPlay");
const btnStop = document.getElementById("btnStop");
const btnSelMode = document.getElementById("btnSelMode");
const btnCut = document.getElementById("btnCut");
const btnSplit = document.getElementById("btnSplit");
const btnUndo = document.getElementById("btnUndo");
const btnReset = document.getElementById("btnReset");
const btnNewFile = document.getElementById("btnNewFile");
const btnResetFx = document.getElementById("btnResetFx");
const btnClearSplits = document.getElementById("btnClearSplits");
const btnPreview = document.getElementById("btnPreview");
const btnExport = document.getElementById("btnExport");

const splitBanner = document.getElementById("splitBanner");
const splitText = document.getElementById("splitText");
const selBanner = document.getElementById("selBanner");
const selInfo = document.getElementById("selInfo");

const sVol = document.getElementById("sVol");
const sSpeed = document.getElementById("sSpeed");
const sPitch = document.getElementById("sPitch");
const sBass = document.getElementById("sBass");
const sReverb = document.getElementById("sReverb");
const sDecay = document.getElementById("sDecay");

const mp3Opts = document.getElementById("mp3Opts");
const mp3Quality = document.getElementById("mp3Quality");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

const fxDot = document.getElementById("fxDot");

// ── FILE LOADING ─────────────────────────
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("over");
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});
btnNewFile.addEventListener("click", () => {
  stopAudio(true);
  editorEl.style.display = "none";
  dropZone.style.display = "";
  workBuffer = origBuffer = null;
  fileInput.value = "";
});

async function loadFile(file) {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const ab = await file.arrayBuffer();
    origBuffer = await audioCtx.decodeAudioData(ab);
    workBuffer = cloneBuffer(origBuffer);
    history = [];
    splitPoints = [];
    selStart = selEnd = -1;
    pausedAt = 0;

    const shortName =
      file.name.length > 36 ? file.name.slice(0, 34) + "…" : file.name;
    fileNameEl.textContent = shortName;
    fileDurEl.textContent = fmt(origBuffer.duration);

    dropZone.style.display = "none";
    editorEl.style.display = "";

    drawWave(workBuffer);
    updateAll();
  } catch (err) {
    alert(
      "Não foi possível decodificar este arquivo de áudio. Tente outro formato.",
    );
  }
}

// ── WAVEFORM DRAWING ─────────────────────
function drawWave(buf) {
  const dpr = window.devicePixelRatio || 1;
  const W = waveCanvas.parentElement.clientWidth || 800;
  const H = 90;
  waveCanvas.width = W * dpr;
  waveCanvas.height = H * dpr;
  waveCanvas.style.width = W + "px";
  waveCanvas.style.height = H + "px";

  const ctx = waveCanvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const data = buf.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const mid = H / 2;
  const color = "#4fa8e8";
  const colorDim = "rgba(79,168,232,0.3)";

  for (let i = 0; i < W; i++) {
    let min = 1,
      max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const top = mid + max * (mid - 5);
    const bottom = mid + min * (mid - 5);
    ctx.strokeStyle = Math.abs(max) > 0.5 ? color : colorDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(i + 0.5, top);
    ctx.lineTo(i + 0.5, bottom);
    ctx.stroke();
  }

  // Draw split lines
  splitPoints.forEach((sp) => {
    const x = (sp / buf.duration) * W;
    ctx.save();
    ctx.strokeStyle = "#f05c5c";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.restore();
  });

  updateTimeline(buf);
}

function updateTimeline(buf) {
  const d = buf.duration;
  const ids = ["tA", "tB", "tC", "tD", "tE"];
  const vals = [0, d * 0.25, d * 0.5, d * 0.75, d];
  ids.forEach((id, i) => {
    document.getElementById(id).textContent = fmt(vals[i]);
  });
}

// ── WAVEFORM INTERACTION ─────────────────
waveBox.addEventListener("mousedown", (e) => {
  if (!workBuffer || !isSelMode) return;
  isDragging = true;
  const t = xToTime(e.offsetX);
  selStart = selEnd = t;
  updateSelOverlay();
});

waveBox.addEventListener("mousemove", (e) => {
  if (!workBuffer) return;
  const t = xToTime(e.offsetX);
  posDisplay.textContent = fmt(t);
  if (!isDragging || !isSelMode) return;
  selEnd = t;
  updateSelOverlay();
});

waveBox.addEventListener("mouseup", () => {
  isDragging = false;
  updateAll();
});

waveBox.addEventListener("click", (e) => {
  if (!workBuffer || isSelMode) return;
  pausedAt = xToTime(e.offsetX);
  playheadEl.style.left = e.offsetX + "px";
});

function xToTime(x) {
  const W = waveCanvas.clientWidth || waveCanvas.offsetWidth;
  return Math.max(
    0,
    Math.min(workBuffer.duration, (x / W) * workBuffer.duration),
  );
}

function updateSelOverlay() {
  if (selStart < 0 || selEnd < 0 || !workBuffer) {
    selOverlay.style.display = "none";
    return;
  }
  const s = Math.min(selStart, selEnd);
  const en = Math.max(selStart, selEnd);
  const W = waveCanvas.clientWidth;
  const left = (s / workBuffer.duration) * W;
  const right = (en / workBuffer.duration) * W;
  selOverlay.style.display = "";
  selOverlay.style.left = left + "px";
  selOverlay.style.width = right - left + "px";
}

// ── TRANSPORT ────────────────────────────
btnPlay.addEventListener("click", () => {
  if (!workBuffer) return;
  isPlaying ? pauseAudio() : playAudio(pausedAt);
});

btnStop.addEventListener("click", () => stopAudio(true));

btnSelMode.addEventListener("click", () => {
  isSelMode = !isSelMode;
  btnSelMode.classList.toggle("active", isSelMode);
  waveBox.style.cursor = isSelMode ? "crosshair" : "pointer";
  if (!isSelMode) {
    selStart = selEnd = -1;
    selOverlay.style.display = "none";
    updateAll();
  }
});

btnCut.addEventListener("click", () => {
  if (!hasSel()) return;
  saveHistory();
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  workBuffer = cutRegion(workBuffer, s, e);
  splitPoints = splitPoints
    .filter((sp) => sp < s || sp > e)
    .map((sp) => (sp > e ? sp - (e - s) : sp));
  selStart = selEnd = -1;
  selOverlay.style.display = "none";
  drawWave(workBuffer);
  updateAll();
});

btnSplit.addEventListener("click", () => {
  if (selStart < 0) return;
  const t = Math.min(selStart, selEnd < 0 ? selStart : selEnd);
  if (!splitPoints.includes(t)) {
    splitPoints.push(t);
    splitPoints.sort((a, b) => a - b);
  }
  drawWave(workBuffer);
  updateAll();
});

btnUndo.addEventListener("click", () => {
  if (!history.length) return;
  workBuffer = history.pop();
  drawWave(workBuffer);
  updateAll();
});

btnReset.addEventListener("click", () => {
  if (!origBuffer) return;
  stopAudio(true);
  history = [];
  workBuffer = cloneBuffer(origBuffer);
  splitPoints = [];
  selStart = selEnd = -1;
  selOverlay.style.display = "none";
  splitBanner.style.display = "none";
  resetSliders();
  drawWave(workBuffer);
  updateAll();
});

btnClearSplits.addEventListener("click", () => {
  splitPoints = [];
  drawWave(workBuffer);
  updateAll();
});

btnResetFx.addEventListener("click", () => {
  resetSliders();
  updateAll();
});

// ── PLAYBACK ─────────────────────────────
function playAudio(offset = 0) {
  if (!audioCtx || !workBuffer) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  stopAudio(false);

  const speed = parseInt(sSpeed.value) / 100;
  const vol = parseInt(sVol.value) / 100;
  const bass = parseInt(sBass.value);
  const revWet = parseInt(sReverb.value) / 100;
  const decay = parseInt(sDecay.value) / 10;

  srcNode = audioCtx.createBufferSource();
  srcNode.buffer = workBuffer;
  srcNode.playbackRate.value = speed;

  gainNode = audioCtx.createGain();
  gainNode.gain.value = vol;

  bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = "lowshelf";
  bassFilter.frequency.value = 200;
  bassFilter.gain.value = bass;

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 1 - revWet * 0.7;

  wetGain = audioCtx.createGain();
  wetGain.gain.value = revWet;

  convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulse(audioCtx, decay);

  srcNode.connect(gainNode);
  gainNode.connect(bassFilter);
  bassFilter.connect(dryGain);
  bassFilter.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(audioCtx.destination);
  wetGain.connect(audioCtx.destination);

  srcNode.start(0, offset);
  startedAt = audioCtx.currentTime - offset;
  isPlaying = true;
  setPlayState(true);

  srcNode.onended = () => {
    if (isPlaying) {
      isPlaying = false;
      pausedAt = 0;
      setPlayState(false);
    }
  };

  animPlayhead();
}

function pauseAudio() {
  if (!srcNode) return;
  pausedAt = audioCtx.currentTime - startedAt;
  try {
    srcNode.stop();
  } catch (e) {}
  srcNode = null;
  isPlaying = false;
  setPlayState(false);
  cancelAnimationFrame(animFrameId);
}

function stopAudio(resetPos = true) {
  if (srcNode) {
    try {
      srcNode.stop();
    } catch (e) {}
    srcNode = null;
  }
  isPlaying = false;
  if (resetPos) pausedAt = 0;
  setPlayState(false);
  cancelAnimationFrame(animFrameId);
  if (resetPos) {
    playheadEl.style.left = "0px";
    posDisplay.textContent = "0:00";
  }
}

function setPlayState(playing) {
  document.getElementById("iPlay").style.display = playing ? "none" : "";
  document.getElementById("iPause").style.display = playing ? "" : "none";
  document.getElementById("playLabel").textContent = playing
    ? "Pausar"
    : "Play";
}

function animPlayhead() {
  if (!isPlaying) return;
  const cur = audioCtx.currentTime - startedAt;
  posDisplay.textContent = fmt(cur);
  const W = waveCanvas.clientWidth;
  const x = (cur / workBuffer.duration) * W;
  playheadEl.style.left = Math.min(x, W) + "px";
  animFrameId = requestAnimationFrame(animPlayhead);
}

// ── EXPORT ───────────────────────────────
document.querySelectorAll('input[name="fmt"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    mp3Opts.style.display = radio.value === "mp3" ? "flex" : "none";
  });
});

btnPreview.addEventListener("click", () => {
  stopAudio();
  playAudio(0);
});

btnExport.addEventListener("click", async () => {
  if (!workBuffer) return;
  const format = document.querySelector('input[name="fmt"]:checked').value;
  const segs = splitPoints.length ? getSegments(workBuffer) : [workBuffer];

  showProgress(
    0,
    `Renderizando${segs.length > 1 ? " " + segs.length + " segmentos" : ""}...`,
  );

  for (let i = 0; i < segs.length; i++) {
    const pct = (i / segs.length) * 100;
    showProgress(pct, `Renderizando parte ${i + 1}/${segs.length}...`);

    const rendered = await renderOffline(segs[i]);
    const suffix = segs.length > 1 ? `_parte_${i + 1}` : "";

    if (format === "mp3") {
      showProgress(pct + 40 / segs.length, "Codificando MP3...");
      const mp3Blob = encodeToMp3(rendered, parseInt(mp3Quality.value));
      downloadBlob(mp3Blob, `audio_editado${suffix}.mp3`);
    } else {
      const wavBlob = new Blob([bufferToWav(rendered)], { type: "audio/wav" });
      downloadBlob(wavBlob, `audio_editado${suffix}.wav`);
    }

    await sleep(120);
  }

  showProgress(100, "Concluído!");
  setTimeout(() => {
    progressWrap.style.display = "none";
  }, 2000);
});

async function renderOffline(buf) {
  const speed = parseInt(sSpeed.value) / 100;
  const vol = parseInt(sVol.value) / 100;
  const bass = parseInt(sBass.value);
  const revWet = parseInt(sReverb.value) / 100;
  const decay = parseInt(sDecay.value) / 10;
  const pitch = parseInt(sPitch.value);

  const outLen = Math.ceil(buf.length / speed);
  const offCtx = new OfflineAudioContext(
    buf.numberOfChannels,
    outLen,
    buf.sampleRate,
  );

  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = speed;

  const g = offCtx.createGain();
  g.gain.value = vol;

  const bf = offCtx.createBiquadFilter();
  bf.type = "lowshelf";
  bf.frequency.value = 200;
  bf.gain.value = bass;

  const dry = offCtx.createGain();
  dry.gain.value = 1 - revWet * 0.7;

  const wet = offCtx.createGain();
  wet.gain.value = revWet;

  const conv = offCtx.createConvolver();
  conv.buffer = makeImpulse(offCtx, decay);

  src.connect(g);
  g.connect(bf);
  bf.connect(dry);
  bf.connect(conv);
  conv.connect(wet);
  dry.connect(offCtx.destination);
  wet.connect(offCtx.destination);
  src.start(0);

  let rendered = await offCtx.startRendering();
  if (pitch !== 0) rendered = applyPitchShift(rendered, pitch);
  return rendered;
}

// ── MP3 ENCODING ─────────────────────────
function encodeToMp3(buf, quality = 2) {
  if (typeof lamejs === "undefined") {
    alert(
      "Biblioteca MP3 (lamejs) não carregou. Verifique a conexão e recarregue a página.",
    );
    return null;
  }

  const nc = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;

  const mp3enc = new lamejs.Mp3Encoder(
    nc,
    sr,
    quality === 0 ? 320 : quality === 2 ? 192 : quality === 4 ? 128 : 96,
  );
  const blockSize = 1152;
  const mp3Data = [];

  const left = float32ToInt16(buf.getChannelData(0));
  const right = nc > 1 ? float32ToInt16(buf.getChannelData(1)) : left;

  for (let i = 0; i < len; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right.subarray(i, i + blockSize);
    const chunk = nc > 1 ? mp3enc.encodeBuffer(l, r) : mp3enc.encodeBuffer(l);
    if (chunk.length > 0) mp3Data.push(new Int8Array(chunk));
  }

  const end = mp3enc.flush();
  if (end.length > 0) mp3Data.push(new Int8Array(end));

  return new Blob(mp3Data, { type: "audio/mp3" });
}

function float32ToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ── PITCH SHIFT ───────────────────────────
function applyPitchShift(buf, semitones) {
  const ratio = Math.pow(2, semitones / 12);
  const nc = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const newLen = Math.round(buf.length / ratio);
  const nb = audioCtx.createBuffer(nc, newLen, sr);
  for (let c = 0; c < nc; c++) {
    const od = buf.getChannelData(c);
    const nd = nb.getChannelData(c);
    for (let i = 0; i < newLen; i++) {
      const pos = i * ratio;
      const pi = Math.floor(pos);
      const frac = pos - pi;
      nd[i] = (od[pi] || 0) * (1 - frac) + (od[pi + 1] || 0) * frac;
    }
  }
  return nb;
}

// ── AUDIO HELPERS ─────────────────────────
function cloneBuffer(buf) {
  const nb = audioCtx.createBuffer(
    buf.numberOfChannels,
    buf.length,
    buf.sampleRate,
  );
  for (let c = 0; c < buf.numberOfChannels; c++)
    nb.copyToChannel(buf.getChannelData(c), c);
  return nb;
}

function cutRegion(buf, s, e) {
  const sr = buf.sampleRate;
  const nc = buf.numberOfChannels;
  const si = Math.floor(s * sr);
  const ei = Math.floor(e * sr);
  const len = buf.length - (ei - si);
  if (len <= 0) return buf;
  const nb = audioCtx.createBuffer(nc, len, sr);
  for (let c = 0; c < nc; c++) {
    const od = buf.getChannelData(c);
    const nd = nb.getChannelData(c);
    nd.set(od.subarray(0, si), 0);
    nd.set(od.subarray(ei), si);
  }
  return nb;
}

function sliceBuffer(buf, s, e) {
  const sr = buf.sampleRate;
  const nc = buf.numberOfChannels;
  const si = Math.floor(s * sr);
  const ei = Math.min(Math.floor(e * sr), buf.length);
  const nb = audioCtx.createBuffer(nc, ei - si, sr);
  for (let c = 0; c < nc; c++)
    nb.copyToChannel(buf.getChannelData(c).subarray(si, ei), c);
  return nb;
}

function getSegments(buf) {
  const pts = [0, ...splitPoints, buf.duration];
  return pts.slice(0, -1).map((s, i) => sliceBuffer(buf, s, pts[i + 1]));
}

function makeImpulse(ctx, duration) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * Math.max(0.1, duration));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return buf;
}

// ── WAV ENCODING ─────────────────────────
function bufferToWav(buf) {
  const nc = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const out = new ArrayBuffer(44 + len * nc * 2);
  const v = new DataView(out);
  const ws = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  ws(0, "RIFF");
  v.setUint32(4, 36 + len * nc * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  ws(36, "data");
  v.setUint32(40, len * nc * 2, true);

  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
      v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

// ── UI HELPERS ────────────────────────────
function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + (sec < 10 ? "0" : "") + sec;
}

function hasSel() {
  return selStart >= 0 && selEnd >= 0 && Math.abs(selEnd - selStart) > 0.01;
}

function saveHistory() {
  history.push(cloneBuffer(workBuffer));
  if (history.length > 20) history.shift();
}

function resetSliders() {
  sVol.value = 100;
  sSpeed.value = 100;
  sPitch.value = 0;
  sBass.value = 0;
  sReverb.value = 0;
  sDecay.value = 15;
  updateSliderLabels();
}

function updateSliderLabels() {
  document.getElementById("vVol").textContent = sVol.value + "%";
  document.getElementById("vSpeed").textContent =
    (parseInt(sSpeed.value) / 100).toFixed(2) + "×";
  document.getElementById("vPitch").textContent =
    (parseInt(sPitch.value) > 0 ? "+" : "") + sPitch.value + " st";
  document.getElementById("vBass").textContent =
    (parseInt(sBass.value) > 0 ? "+" : "") + sBass.value + " dB";
  document.getElementById("vReverb").textContent = sReverb.value + "%";
  document.getElementById("vDecay").textContent =
    (parseInt(sDecay.value) / 10).toFixed(1) + "s";
}

function updateAll() {
  if (!workBuffer) return;

  // timeline + status dur
  document.getElementById("sDur").textContent =
    fmt(workBuffer.duration) + " duração";
  fileDurEl.textContent = fmt(workBuffer.duration);

  // selection
  const hs = hasSel();
  btnCut.disabled = !hs;
  btnSplit.disabled = selStart < 0;
  btnUndo.disabled = history.length === 0;

  selBanner.style.display = hs ? "" : "none";
  if (hs)
    selInfo.textContent =
      fmt(Math.min(selStart, selEnd)) +
      " → " +
      fmt(Math.max(selStart, selEnd)) +
      "  (" +
      fmt(Math.abs(selEnd - selStart)) +
      ")";

  document.getElementById("sSel").textContent = hs
    ? fmt(Math.min(selStart, selEnd)) + " → " + fmt(Math.max(selStart, selEnd))
    : "sem seleção";

  // splits
  splitBanner.style.display = splitPoints.length ? "" : "none";
  splitText.textContent =
    splitPoints.length +
    " ponto" +
    (splitPoints.length !== 1 ? "s" : "") +
    " de divisão";

  // fx status
  const fxActive = [];
  if (parseInt(sVol.value) !== 100) fxActive.push("vol");
  if (parseInt(sSpeed.value) !== 100) fxActive.push("speed");
  if (parseInt(sPitch.value) !== 0) fxActive.push("pitch");
  if (parseInt(sBass.value) !== 0) fxActive.push("bass");
  if (parseInt(sReverb.value) !== 0) fxActive.push("reverb");
  document.getElementById("sFx").textContent = fxActive.length
    ? fxActive.join(", ") + " ativo(s)"
    : "efeitos neutros";
  fxDot.classList.toggle("on", fxActive.length > 0);
}

function showProgress(pct, label) {
  progressWrap.style.display = "";
  progressFill.style.width = pct + "%";
  progressLabel.textContent = label;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── SLIDER EVENTS ─────────────────────────
[sVol, sSpeed, sPitch, sBass, sReverb, sDecay].forEach((el) => {
  el.addEventListener("input", () => {
    updateSliderLabels();
    updateAll();
  });
});

// ── INIT ──────────────────────────────────
editorEl.style.display = "none";
updateSliderLabels();
