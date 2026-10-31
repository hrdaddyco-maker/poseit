import { POSES } from './poses.js';
const $ = id => document.getElementById(id);
const views = ['home','guide','cam','result'];
let pose = null, stream = null, facing = 'user', landmarker = null, raf = 0, voice = true, auto = true;
let lastSpoken = '', lastSpeakT = 0, holdStart = 0, counting = false, smooth = 0, lastStep = -1;

function show(v) { views.forEach(x => $(x).hidden = x !== v); $('backBtn').hidden = v === 'home'; window.scrollTo(0,0); const h = $(v).querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); } }

// Home list
$('poseList').innerHTML = POSES.map(p => `<li><button class="card" data-id="${p.id}"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="${p.icon}" fill="none" stroke="#ffcf4a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg><b>${p.name}</b><small>${p.blurb}</small></button></li>`).join('');
$('poseList').addEventListener('click', e => { const b = e.target.closest('.card'); if (b) openGuide(b.dataset.id); });

function openGuide(id) {
  pose = POSES.find(p => p.id === id);
  $('guideTitle').textContent = pose.name;
  $('guideSteps').innerHTML = [pose.frame, ...pose.steps.map(s => s.text), ...pose.tips].map(t => `<li>${t}</li>`).join('');
  show('guide'); playDemo();
}

// Stick figure drawing
const BONES = [['n','ls'],['n','rs'],['ls','le'],['le','lw'],['rs','re'],['re','rw'],['ls','lh'],['rs','rh'],['lh','rh'],['lh','lk'],['lk','la'],['rh','rk'],['rk','ra'],['h','n']];
function drawFig(ctx, f, w, h, color, lw, ox = 0, oy = 0, skip = null) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); for (const [a,b] of BONES) { if (a === 'h' || skip && (skip.has(a) || skip.has(b))) continue; ctx.moveTo(ox + f[a][0]*w, oy + f[a][1]*h); ctx.lineTo(ox + f[b][0]*w, oy + f[b][1]*h); } ctx.stroke();
  const r = Math.hypot((f.n[0]-f.h[0])*w, (f.n[1]-f.h[1])*h) * .75;
  ctx.beginPath(); ctx.arc(ox + f.h[0]*w, oy + f.h[1]*h, r, 0, 7); ctx.stroke();
}
const figs = t => t.multi || [t];
const lerpFig = (a, b, t) => { const r = {}; for (const k in a) r[k] = [a[k][0] + (b[k][0]-a[k][0])*t, a[k][1] + (b[k][1]-a[k][1])*t]; return r; };
let demoRaf = 0;
function playDemo() {
  cancelAnimationFrame(demoRaf);
  const c = $('demoCanvas'), ctx = c.getContext('2d'), s = figs(pose.start), e = figs(pose.target);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, t0 = performance.now(), dur = 2600;
  const frame = now => {
    let t = reduce ? 1 : Math.min(1, (now - t0) / dur); const ease = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    ctx.clearRect(0,0,c.width,c.height); ctx.save(); ctx.beginPath(); ctx.rect(0,0,c.width,c.height); ctx.clip();
    e.forEach(f => drawFig(ctx, f, c.width, c.height, 'rgba(255,255,255,.18)', 10));
    s.forEach((f,i) => drawFig(ctx, lerpFig(f, e[i], ease), c.width, c.height, '#ffcf4a', 5));
    ctx.restore();
    ctx.fillStyle = '#b5b8c2'; ctx.font = '14px system-ui'; ctx.fillText(t < 1 ? 'Moving into the pose...' : 'Target pose', 12, 22);
    if (t < 1) demoRaf = requestAnimationFrame(frame);
  };
  demoRaf = requestAnimationFrame(frame);
}
$('replayBtn').onclick = playDemo;

// Voice
function speak(text, force) {
  const now = performance.now();
  if (!voice || !('speechSynthesis' in window)) return;
  if (!force && (text === lastSpoken && now - lastSpeakT < 6000 || now - lastSpeakT < 2500)) return;
  lastSpoken = text; lastSpeakT = now;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; speechSynthesis.speak(u);
}
$('voiceBtn').onclick = () => { voice = !voice; $('voiceBtn').setAttribute('aria-pressed', voice); $('voiceBtn').setAttribute('aria-label', `Spoken instructions ${voice ? 'on' : 'off'}`); $('voiceBtn').innerHTML = voice ? '&#128266;' : '&#128263;'; if (!voice) speechSynthesis?.cancel(); };
$('autoBtn').onclick = () => { auto = !auto; $('autoBtn').setAttribute('aria-pressed', auto); $('autoBtn').textContent = `Auto capture: ${auto ? 'on' : 'off'}`; };

// Camera
async function startCam() {
  stopCam();
  $('instruction').textContent = 'Starting camera...';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
  } catch (err) {
    $('instruction').textContent = 'Camera not available. Allow camera access in your browser settings, then try again.'; return;
  }
  const v = $('video'); v.srcObject = stream; await v.play().catch(() => {});
  const mirror = facing === 'user'; v.classList.toggle('mirror', mirror); $('overlay').classList.toggle('mirror', mirror);
  if (!landmarker) await loadModel();
  loop();
}
function stopCam() { cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); stream = null; }
async function loadModel() {
  $('instruction').textContent = 'Loading pose detection (about 6 MB, first time only)...';
  try {
    const { FilesetResolver, PoseLandmarker } = await import('./vendor/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', location.href).href);
    const opts = d => ({ baseOptions: { modelAssetPath: new URL('./vendor/pose_landmarker_lite.task', location.href).href, delegate: d }, runningMode: 'VIDEO', numPoses: pose.people || 1, minPoseDetectionConfidence: .5 });
    try { landmarker = await PoseLandmarker.createFromOptions(files, opts('GPU')); } catch { landmarker = await PoseLandmarker.createFromOptions(files, opts('CPU')); }
    landmarker.people = pose.people || 1;
  } catch (e) { console.error(e); $('instruction').textContent = 'Pose detection could not load on this device. You can still use the outline and take photos.'; }
}

let lastT = -1;
function loop() {
  raf = requestAnimationFrame(loop);
  const v = $('video'), c = $('overlay'); if (!v.videoWidth) return;
  const rect = c.getBoundingClientRect(); const W = Math.round(rect.width * devicePixelRatio), H = Math.round(rect.height * devicePixelRatio);
  if (c.width !== W) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d'); ctx.clearRect(0,0,W,H);
  // Mapping from video coords to cover-fit canvas
  const sc = Math.max(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth*sc, dh = v.videoHeight*sc, ox = (W-dw)/2, oy = (H-dh)/2;
  const toC = l => ({ x: (ox + l.x*dw) / W, y: (oy + l.y*dh) / H, visibility: l.visibility });
  let people = [];
  if (landmarker && v.currentTime !== lastT) {
    lastT = v.currentTime;
    try { const r = landmarker.detectForVideo(v, performance.now()); people = (r.landmarks || []).map(p => p.map(toC)); } catch {}
    window.__people = people;
  } else people = window.__people || [];
  // Target outline
  figs(pose.target).forEach(f => drawFig(ctx, f, W, H, 'rgba(255,255,255,.35)', 14*devicePixelRatio));
  // Detected skeleton
  const M = {n:null}; const map = {h:0, ls:11, rs:12, le:13, re:14, lw:15, rw:16, lh:23, rh:24, lk:25, rk:26, la:27, ra:28};
  // Score
  const { score, stepIdx } = evaluate(people);
  const col = score > .85 ? '#3ddc84' : score > .5 ? '#ffcf4a' : '#ff6b6b';
  people.forEach(p => { const f = {}; const bad = new Set(Object.keys(map).filter(k => (p[map[k]].visibility ?? 1) < .5)); for (const k in map) f[k] = [p[map[k]].x, p[map[k]].y]; f.n = [(f.ls[0]+f.rs[0])/2, (f.ls[1]+f.rs[1])/2]; f.h = [p[0].x, p[0].y - .02]; drawFig(ctx, f, W, H, col, 4*devicePixelRatio, 0, 0, bad); });
  smooth = smooth * .85 + score * .15; const pct = Math.round(smooth * 100);
  $('meterBar').style.width = pct + '%'; $('meterText').textContent = `Match ${pct}%`; $('meter').setAttribute('aria-valuenow', pct);
  if (auto && !counting && landmarker) {
    if (pct >= 85) { holdStart ||= performance.now(); if (performance.now() - holdStart > 800) countdown(); } else holdStart = 0;
  }
}
function evaluate(people) {
  const items = pose.steps; let res = [];
  if (!landmarker) return { score: 0, stepIdx: -1 };
  const framed = people.length && pose.need.every(k => true) && checkNeed(people);
  res = items.map(s => { if (!framed) return 0; try { const v = s.fn(people); return Number.isFinite(v) ? v : 0; } catch { return 0; } });
  $('checklist').innerHTML = [`<li class="${framed ? 'ok' : 'no'}">${pose.frame}</li>`, ...items.map((s,i) => `<li class="${res[i] > .8 ? 'ok' : 'no'}">${s.text}</li>`)].join('');
  let msg, idx;
  if (!people.length) { msg = 'Step into the frame'; idx = -2; }
  else if (!framed) { msg = pose.frame; idx = -1; }
  else { idx = res.findIndex(v => v <= .8); msg = idx === -1 ? 'Perfect, hold still!' : items[idx].text; }
  if ($('instruction').textContent !== msg && !counting) { $('instruction').textContent = msg; }
  if (!counting && idx !== lastStep) { lastStep = idx; speak(msg); } else if (!counting) speak(msg);
  const score = framed ? (.25 + .75 * res.reduce((a,b) => a+b, 0) / items.length) : 0;
  return { score, stepIdx: idx };
}
function checkNeed(people) {
  const idx = {nose:0, le:2, re:5, lsh:11, rsh:12, lhip:23, rhip:24, lkn:25, rkn:26, lan:27, ran:28};
  const ok = p => pose.need.every(k => { const l = p[idx[k]]; return (l.visibility ?? 1) > .5 && l.x > -.02 && l.x < 1.02 && l.y > -.02 && l.y < 1.02; });
  return pose.people ? people.some(ok) : ok(people[0]);
}
async function countdown() {
  counting = true; holdStart = 0; speak('Hold it. 3, 2, 1', true);
  for (const n of [3,2,1]) { $('countdown').textContent = n; await new Promise(r => setTimeout(r, 800)); }
  $('countdown').textContent = ''; capture(); counting = false;
}
function capture() {
  const v = $('video'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const ctx = c.getContext('2d');
  if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(v, 0, 0);
  $('flash').style.opacity = 1; setTimeout(() => $('flash').style.opacity = 0, 150);
  c.toBlob(b => {
    const url = URL.createObjectURL(b); $('photo').src = url; $('saveBtn').href = url;
    const file = new File([b], 'poseit.jpg', { type: 'image/jpeg' });
    $('shareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    $('shareBtn').onclick = () => navigator.share({ files: [file] }).catch(() => {});
    stopCam(); show('result'); speak('Photo taken', true);
  }, 'image/jpeg', .92);
}
$('startBtn').onclick = () => { if (landmarker && landmarker.people !== (pose.people || 1)) { landmarker.close?.(); landmarker = null; } show('cam'); lastStep = -9; startCam(); };
$('flipBtn').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCam(); };
$('snapBtn').onclick = () => { if (!counting) countdown(); };
$('againBtn').onclick = () => { show('cam'); startCam(); };
$('backBtn').onclick = () => { stopCam(); speechSynthesis?.cancel(); cancelAnimationFrame(demoRaf); show($('cam').hidden && $('result').hidden ? 'home' : 'guide'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); });
// Optional AI coach (opt-in, one small frame per tap)
$('aiBtn').onclick = async () => {
  const v = $('video'); if (!v.videoWidth) return;
  const out = $('aiOut'); out.textContent = 'Asking the AI coach...'; $('aiBtn').disabled = true;
  const c = document.createElement('canvas'); const s = 384 / Math.max(v.videoWidth, v.videoHeight); c.width = v.videoWidth*s; c.height = v.videoHeight*s;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const prompt = `You are a friendly photo pose coach. The person wants a "${pose.name}" photo. Look at the image and give exactly 3 short, specific posing corrections, each under 10 words, as a numbered list. No commentary about appearance.`;
  try {
    const r = await fetch('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'Qwen2.5-VL-72B-Instruct', max_tokens: 120, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: c.toDataURL('image/jpeg', .7) } }] }] }) });
    if (r.status === 429) throw new Error('busy');
    const j = await r.json(); const t = j.choices?.[0]?.message?.content?.trim();
    out.textContent = t || 'No tip this time, try again.'; if (t) speak(t.replace(/\d\.\s*/g, ''), true);
  } catch (e) { out.textContent = e.message === 'busy' ? 'The free AI coach is busy (limit about 2 per minute). Try again shortly.' : 'AI coach is unavailable right now. The live guide still works offline.'; }
  setTimeout(() => $('aiBtn').disabled = false, 3000);
};
