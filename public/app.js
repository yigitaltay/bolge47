const TRACKS = {
  "neon-pulse": { title: "NEON PULSE", artist: "Kairo Unit", bpm: 128, duration: 62, color: "#9cff3b", index: "01", seed: 47 },
  "glass-horizon": { title: "GLASS HORIZON", artist: "Aerline", bpm: 150, duration: 64, color: "#56e7ff", index: "02", seed: 131 },
  overdrive: { title: "OVERDRIVE", artist: "Zero//Signal", bpm: 174, duration: 60, color: "#ff4da6", index: "03", seed: 909 },
};
const DIFFICULTY = {
  easy: { label: "KOLAY", division: 1, density: .86, approach: 1.2, radius: 46 },
  normal: { label: "NORMAL", division: 2, density: .62, approach: 1.0, radius: 40 },
  hard: { label: "ZOR", division: 2, density: .84, approach: .82, radius: 35 },
  expert: { label: "UZMAN", division: 4, density: .66, approach: .68, radius: 31 },
};
const TARGET_COLORS = ["#9cff3b", "#56e7ff", "#bd72ff", "#ff4da6", "#ffbe3d"];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const homeView = $("#homeView");
const gameView = $("#gameView");
const canvas = $("#gameCanvas");
const ctx = canvas.getContext("2d");

let selectedTrack = "neon-pulse";
let selectedDifficulty = "normal";
let authMode = "login";
let currentUser = null;
let currentStats = null;
let game = null;
let audioContext = null;
let toastTimer = 0;

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
    return data;
  });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

function formatScore(value) {
  return Math.max(0, Math.round(value)).toString().padStart(7, "0");
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function generateChart(trackId, difficultyId) {
  const track = TRACKS[trackId];
  const config = DIFFICULTY[difficultyId];
  const random = seeded(track.seed + difficultyId.length * 997);
  const beat = 60 / track.bpm;
  const step = beat / config.division;
  const notes = [];
  let last = { x: .5, y: .5 };
  let tick = 0;
  for (let time = 3.2; time < track.duration - 1.8; time += step) {
    const onBeat = tick % config.division === 0;
    let shouldAdd = random() < config.density;
    if (difficultyId === "easy") shouldAdd = onBeat && random() < .91;
    if (!shouldAdd) { tick++; continue; }
    let x, y;
    if (trackId === "neon-pulse") {
      const angle = tick * 1.37 + random() * .55;
      const radius = .24 + random() * .22;
      x = .5 + Math.cos(angle) * radius;
      y = .5 + Math.sin(angle) * radius;
    } else if (trackId === "glass-horizon") {
      x = .12 + ((tick * .23 + random() * .16) % .76);
      y = .5 + Math.sin(tick * 1.18) * (.22 + random() * .16);
    } else {
      x = .09 + random() * .82;
      y = .1 + random() * .8;
    }
    let attempts = 0;
    while (Math.hypot(x - last.x, y - last.y) < .2 && attempts++ < 6) {
      x = .09 + random() * .82; y = .1 + random() * .8;
    }
    const radius = config.radius + (onBeat ? 4 : 0) + Math.round(random() * 5);
    notes.push({ time, x, y, radius, color: TARGET_COLORS[(tick + track.seed) % TARGET_COLORS.length], judged: false, result: null });
    last = { x, y };
    tick++;
  }
  return notes.sort((a, b) => a.time - b.time);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function synthTone(time, frequency, duration, type, gainValue, destination = null) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(gainValue, time + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
  oscillator.connect(gain).connect(destination || audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + duration + .03);
}

function kick(time, master) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(150, time);
  oscillator.frequency.exponentialRampToValueAtTime(42, time + .14);
  gain.gain.setValueAtTime(.8, time);
  gain.gain.exponentialRampToValueAtTime(.001, time + .28);
  oscillator.connect(gain).connect(master); oscillator.start(time); oscillator.stop(time + .3);
}

function noiseHit(time, duration, gainValue, master) {
  const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * duration), audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = buffer; filter.type = "highpass"; filter.frequency.value = 2500;
  gain.gain.setValueAtTime(gainValue, time); gain.gain.exponentialRampToValueAtTime(.001, time + duration);
  source.connect(filter).connect(gain).connect(master); source.start(time); source.stop(time + duration);
}

function scheduleMusic(track, startAt) {
  const master = audioContext.createGain();
  const compressor = audioContext.createDynamicsCompressor();
  master.gain.value = .56;
  master.connect(compressor).connect(audioContext.destination);
  const beat = 60 / track.bpm;
  const scale = track.index === "02" ? [220, 277.18, 329.63, 415.3] : track.index === "03" ? [110, 130.81, 164.81, 196] : [130.81, 164.81, 196, 246.94];
  const totalBeats = Math.ceil(track.duration / beat);
  for (let index = 0; index < totalBeats; index++) {
    const time = startAt + index * beat;
    kick(time, master);
    if (index % 4 === 1 || index % 4 === 3) noiseHit(time, .14, .18, master);
    noiseHit(time + beat / 2, .045, .035, master);
    const root = scale[Math.floor(index / 8) % scale.length] / 2;
    synthTone(time, root, beat * .8, track.index === "03" ? "sawtooth" : "square", .055, master);
    if (index % 2 === 0) {
      const melody = scale[(index + Math.floor(index / 8)) % scale.length] * (track.index === "02" ? 2 : 1);
      synthTone(time + beat / 2, melody, beat * .42, track.index === "02" ? "sine" : "triangle", .035, master);
    }
  }
  game.master = master;
}

async function startGame(trackId = selectedTrack, difficultyId = selectedDifficulty) {
  selectedTrack = trackId;
  selectedDifficulty = difficultyId;
  const track = TRACKS[trackId];
  const notes = generateChart(trackId, difficultyId);
  let runId = null;
  if (currentUser) {
    try { runId = (await api("/api/run/start", { method: "POST", body: JSON.stringify({ track: trackId, difficulty: difficultyId }) })).runId; }
    catch (error) { toast(error.message); }
  }
  if (audioContext) await audioContext.close().catch(() => {});
  audioContext = new AudioContext({ latencyHint: "interactive" });
  const startTime = audioContext.currentTime + 2.35;
  game = {
    trackId, difficultyId, track, notes, startTime, runId, state: "playing", frame: 0,
    combo: 0, maxCombo: 0, points: 0, score: 0, accuracy: 100,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    pointer: { x: 0, y: 0, visible: false }, hits: [], master: null,
  };
  document.documentElement.style.setProperty("--game-accent", track.color);
  $("#gameTrackIndex").textContent = track.index;
  $("#gameTrackTitle").textContent = track.title;
  $("#gameTrackMeta").textContent = `${track.bpm} BPM · ${DIFFICULTY[difficultyId].label}`;
  $("#scoreValue").textContent = "0000000";
  $("#accuracyValue").textContent = "100.00%";
  $("#gameMessage").classList.remove("fade");
  $("#gameMessage strong").textContent = "HAZIR?";
  $("#gameMessage span").textContent = "FAREYİ HEDEFLERE TAŞI";
  homeView.classList.add("hidden"); gameView.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  resizeCanvas();
  scheduleMusic(track, startTime);
  cancelAnimationFrame(game.frame);
  game.frame = requestAnimationFrame(renderGame);
}

function gameTime() {
  return game ? audioContext.currentTime - game.startTime : 0;
}

function updateStats() {
  const total = game.notes.length;
  game.score = Math.round(game.points / total * 1_000_000);
  const judged = game.counts.perfect + game.counts.great + game.counts.good + game.counts.miss;
  game.accuracy = judged ? game.points / judged * 100 : 100;
  $("#scoreValue").textContent = formatScore(game.score);
  $("#accuracyValue").textContent = `${game.accuracy.toFixed(2)}%`;
}

function targetPoint(note, width = canvas.clientWidth, height = canvas.clientHeight) {
  const margin = Math.min(85, width * .08, height * .09);
  return { x: margin + note.x * (width - margin * 2), y: margin + note.y * (height - margin * 2) };
}

function aimAt(clientX, clientY) {
  if (!game) return;
  const rect = canvas.getBoundingClientRect();
  game.pointer.x = clientX - rect.left; game.pointer.y = clientY - rect.top; game.pointer.visible = true;
  if (game.state !== "playing" || gameTime() < 0) return;
  const time = gameTime();
  const candidate = game.notes.find((note) => {
    if (note.judged || Math.abs(note.time - time) > .18) return false;
    const point = targetPoint(note);
    return Math.hypot(point.x - game.pointer.x, point.y - game.pointer.y) <= note.radius;
  });
  if (!candidate) return;
  const delta = Math.abs(candidate.time - time);
  const result = delta <= .045 ? "perfect" : delta <= .09 ? "great" : "good";
  candidate.judged = true; candidate.result = result;
  game.counts[result]++;
  game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo);
  game.points += result === "perfect" ? 1 : result === "great" ? .75 : .45;
  const point = targetPoint(candidate);
  game.hits.push({ x: point.x, y: point.y, at: performance.now(), label: result.toUpperCase(), color: result === "perfect" ? candidate.color : result === "great" ? "#56e7ff" : "#ffbe3d" });
  updateStats();
}

function processMisses(time) {
  for (const note of game.notes) {
    if (!note.judged && time - note.time > .18) {
      note.judged = true; note.result = "miss"; game.counts.miss++; game.combo = 0;
      const point = targetPoint(note);
      game.hits.push({ x: point.x, y: point.y, at: performance.now(), label: "MISS", color: "#ff4d69" });
      updateStats();
    }
  }
}

function renderGame() {
  if (!game || game.state === "ended") return;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const now = performance.now(), time = gameTime();
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createRadialGradient(width * .5, height * .45, 20, width * .5, height * .45, Math.max(width, height) * .7);
  background.addColorStop(0, `${game.track.color}0d`); background.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,.025)"; ctx.lineWidth = 1;
  for (let x = 24; x < width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 24; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

  const approach = DIFFICULTY[game.difficultyId].approach;
  const upcoming = game.notes.filter((note) => !note.judged && note.time - time <= approach && note.time - time >= -.2).slice(0, 5);
  if (upcoming.length > 1) {
    ctx.beginPath();
    upcoming.forEach((note, index) => { const point = targetPoint(note, width, height); index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y); });
    ctx.strokeStyle = `${game.track.color}32`; ctx.lineWidth = 2; ctx.setLineDash([5, 11]); ctx.stroke(); ctx.setLineDash([]);
  }
  upcoming.forEach((note, index) => {
    const point = targetPoint(note, width, height);
    const remaining = Math.max(0, note.time - time);
    const progress = Math.min(1, remaining / approach);
    const approachRadius = note.radius + progress * 78;
    const urgency = 1 - progress;
    ctx.globalAlpha = .2 + urgency * .8;
    ctx.strokeStyle = note.color; ctx.lineWidth = index === 0 ? 4 : 2;
    ctx.shadowColor = note.color; ctx.shadowBlur = index === 0 ? 24 : 8;
    ctx.beginPath(); ctx.arc(point.x, point.y, approachRadius, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = `${note.color}18`; ctx.beginPath(); ctx.arc(point.x, point.y, note.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = note.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(point.x, point.y, note.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = note.color; ctx.beginPath(); ctx.arc(point.x, point.y, 7 + urgency * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#071008"; ctx.font = "900 10px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(index + 1), point.x, point.y);
  });
  const activeHits = game.hits.filter((hit) => now - hit.at < 650);
  game.hits = activeHits;
  for (const hit of activeHits) {
    const age = (now - hit.at) / 650;
    ctx.globalAlpha = 1 - age; ctx.fillStyle = hit.color; ctx.font = `900 ${14 + age * 5}px Inter, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(hit.label, hit.x, hit.y - 38 - age * 34);
  }
  ctx.globalAlpha = 1;
  if (game.combo >= 2) {
    ctx.textAlign = "center"; ctx.fillStyle = "white"; ctx.font = "900 38px Inter, sans-serif"; ctx.fillText(`${game.combo}×`, width / 2, height * .28);
    ctx.fillStyle = game.track.color; ctx.font = "800 8px Inter, sans-serif"; ctx.fillText("KOMBO", width / 2, height * .28 + 18);
  }
  if (game.pointer.visible) {
    ctx.strokeStyle = "white"; ctx.lineWidth = 1.5; ctx.shadowColor = game.track.color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(game.pointer.x, game.pointer.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(game.pointer.x - 16, game.pointer.y); ctx.lineTo(game.pointer.x + 16, game.pointer.y); ctx.moveTo(game.pointer.x, game.pointer.y - 16); ctx.lineTo(game.pointer.x, game.pointer.y + 16); ctx.stroke(); ctx.shadowBlur = 0;
  }
  if (time < 0) {
    const count = Math.ceil(-time);
    $("#gameMessage strong").textContent = count > 0 ? count : "BAŞLA";
  } else if (!$("#gameMessage").classList.contains("fade")) {
    $("#gameMessage strong").textContent = "BAŞLA"; $("#gameMessage span").textContent = "HEDEFLERİ YAKALA"; $("#gameMessage").classList.add("fade");
  }
  if (game.state === "playing" && time >= 0) processMisses(time);
  if (time >= game.track.duration) { finishGame(); return; }
  game.frame = requestAnimationFrame(renderGame);
}

function gradeFor(accuracy) {
  return accuracy >= 99 ? "S+" : accuracy >= 96 ? "S" : accuracy >= 92 ? "A" : accuracy >= 85 ? "B" : accuracy >= 75 ? "C" : "D";
}

async function finishGame() {
  if (!game || game.state === "ended") return;
  game.state = "ended";
  for (const note of game.notes) if (!note.judged) { note.judged = true; game.counts.miss++; }
  updateStats();
  if (game.master) game.master.gain.setTargetAtTime(.0001, audioContext.currentTime, .2);
  const grade = gradeFor(game.accuracy);
  $("#resultGrade").textContent = grade;
  $("#resultGrade").style.color = game.track.color;
  $("#resultTitle").textContent = game.track.title;
  $("#resultSubtitle").textContent = game.accuracy >= 96 ? "Frekansla kusursuz senkron." : game.accuracy >= 85 ? "Güçlü performans. Bir tur daha?" : "Ritmi çözüyorsun. Tekrar dene.";
  $("#resultScore").textContent = formatScore(game.score);
  $("#resultAccuracy").textContent = `${game.accuracy.toFixed(2)}%`;
  $("#resultCombo").textContent = `${game.maxCombo}×`;
  for (const type of ["Perfect", "Great", "Good", "Miss"]) $(`#result${type}`).textContent = game.counts[type.toLowerCase()];
  $("#saveStatus").textContent = currentUser ? "Skor global sıralamaya gönderiliyor…" : "Skoru kaydetmek için giriş yap.";
  $("#resultModal").showModal();
  if (currentUser && game.runId) {
    try {
      await api("/api/run/submit", { method: "POST", body: JSON.stringify({
        runId: game.runId, score: game.score, accuracy: game.accuracy, maxCombo: game.maxCombo, ...game.counts,
      }) });
      $("#saveStatus").textContent = "✓ Skorun global sıralamaya kaydedildi.";
      loadLeaderboard(); loadSession();
    } catch (error) { $("#saveStatus").textContent = error.message; }
  }
}

function togglePause(forceResume = false) {
  if (!game || game.state === "ended") return;
  if (game.state === "paused" || forceResume) {
    game.state = "playing"; audioContext.resume(); $("#pauseOverlay").classList.add("hidden"); $("#pauseGame").textContent = "Ⅱ";
    game.frame = requestAnimationFrame(renderGame);
  } else {
    game.state = "paused"; cancelAnimationFrame(game.frame); audioContext.suspend(); $("#pauseOverlay").classList.remove("hidden"); $("#pauseGame").textContent = "▶";
  }
}

async function exitGame() {
  if (game) { game.state = "ended"; cancelAnimationFrame(game.frame); }
  if (audioContext) await audioContext.close().catch(() => {});
  gameView.classList.add("hidden"); homeView.classList.remove("hidden"); document.body.style.overflow = "";
  $("#pauseOverlay").classList.add("hidden");
}

async function loadSession() {
  try {
    const data = await api("/api/me"); currentUser = data.user; currentStats = data.stats;
    $("#accountBtn").classList.add("logged"); $("#accountBtn span:last-child").textContent = currentUser.username;
  } catch {
    currentUser = null; currentStats = null; $("#accountBtn").classList.remove("logged"); $("#accountBtn span:last-child").textContent = "Giriş yap";
  }
}

async function loadLeaderboard() {
  const track = TRACKS[selectedTrack];
  $("#boardTrackName").textContent = `${track.title} · ${DIFFICULTY[selectedDifficulty].label}`;
  $("#leaderboardRows").innerHTML = '<div class="board-loading">Skorlar yükleniyor…</div>';
  try {
    const data = await api(`/api/leaderboard?track=${encodeURIComponent(selectedTrack)}&difficulty=${encodeURIComponent(selectedDifficulty)}`);
    if (!data.results.length) { $("#leaderboardRows").innerHTML = '<div class="board-empty">İlk rekoru sen bırak.</div>'; return; }
    $("#leaderboardRows").innerHTML = data.results.slice(0, 8).map((row) => `<div class="board-row"><div class="player-cell"><span class="rank">${String(row.rank).padStart(2, "0")}</span><span class="avatar" style="--avatar:${row.avatar_color}">${String(row.username).slice(0, 1).toUpperCase()}</span><b>${escapeHtml(row.username)}</b></div><span>${Number(row.accuracy).toFixed(2)}%</span><strong>${Number(row.score).toLocaleString("tr-TR")}</strong></div>`).join("");
  } catch { $("#leaderboardRows").innerHTML = '<div class="board-empty">Sıralama şu an yüklenemedi.</div>'; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle("active", button.dataset.authTab === mode));
  $("#usernameField").classList.toggle("hidden", mode !== "register");
  $("#username").required = mode === "register";
  $("#password").autocomplete = mode === "register" ? "new-password" : "current-password";
  $("#authSubmit").innerHTML = mode === "register" ? "Hesap oluştur <span>→</span>" : "Rythia'ya gir <span>→</span>";
  $("#authError").textContent = "";
}

function openAccount() {
  const modal = $("#authModal");
  const oldPanel = $("#profilePanel"); if (oldPanel) oldPanel.remove();
  $(".auth-tabs").classList.toggle("hidden", !!currentUser); $("#authForm").classList.toggle("hidden", !!currentUser); $(".modal-foot").classList.toggle("hidden", !!currentUser);
  if (currentUser) {
    const panel = document.createElement("div"); panel.id = "profilePanel";
    panel.innerHTML = `<div style="text-align:center;padding:8px 0 20px"><span class="avatar" style="--avatar:${currentUser.avatarColor};width:68px;height:68px;margin:auto;font-size:25px">${escapeHtml(currentUser.username[0].toUpperCase())}</span><h2 style="margin:15px 0 4px">${escapeHtml(currentUser.username)}</h2><p style="color:#76817b;font-size:11px">${escapeHtml(currentUser.email)}</p></div><div class="result-main"><div><span>TOPLAM SKOR</span><strong>${Number(currentStats?.total_score || 0).toLocaleString("tr-TR")}</strong></div><div><span>OYUN</span><strong>${currentStats?.plays || 0}</strong></div><div><span>EN İYİ KOMBO</span><strong>${currentStats?.best_combo || 0}×</strong></div></div><button id="logoutBtn" class="ghost-btn" style="width:100%">Çıkış yap</button>`;
    modal.append(panel); $("#logoutBtn").addEventListener("click", logout);
  } else setAuthMode("login");
  modal.showModal();
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {}); currentUser = null; currentStats = null;
  $("#authModal").close(); await loadSession(); toast("Oturum kapatıldı.");
}

$$('[data-scroll]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" })));
$$('[data-open="how"]').forEach((button) => button.addEventListener("click", () => $("#howModal").showModal()));
$$('[data-close]').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authTab)));

$$('[data-difficulty]').forEach((button) => button.addEventListener("click", () => {
  selectedDifficulty = button.dataset.difficulty;
  $$('[data-difficulty]').forEach((item) => item.classList.toggle("active", item === button)); loadLeaderboard();
}));
$$('[data-track]').forEach((card) => card.addEventListener("click", (event) => {
  selectedTrack = card.dataset.track; $$('[data-track]').forEach((item) => item.classList.toggle("selected", item === card)); loadLeaderboard();
  if (event.target.closest(".play-track")) startGame();
}));

$("#quickPlay").addEventListener("click", () => startGame()); $("#boardPlay").addEventListener("click", () => startGame());
$("#accountBtn").addEventListener("click", openAccount); $("#refreshBoard").addEventListener("click", loadLeaderboard);
$("#pauseGame").addEventListener("click", () => togglePause()); $("#resumeGame").addEventListener("click", () => togglePause(true));
$("#exitGame").addEventListener("click", exitGame);
$("#returnHome").addEventListener("click", async () => { $("#resultModal").close(); await exitGame(); document.getElementById("tracks").scrollIntoView(); });
$("#retryGame").addEventListener("click", async () => { $("#resultModal").close(); await exitGame(); startGame(); });

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const submit = $("#authSubmit"); submit.disabled = true; $("#authError").textContent = "";
  try {
    await api(`/api/${authMode}`, { method: "POST", body: JSON.stringify({ username: $("#username").value, email: $("#email").value, password: $("#password").value }) });
    $("#authModal").close(); $("#authForm").reset(); await loadSession(); toast(authMode === "register" ? "Rythia hesabın hazır." : "Tekrar hoş geldin.");
  } catch (error) { $("#authError").textContent = error.message; }
  finally { submit.disabled = false; }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && !gameView.classList.contains("hidden") && !$("#resultModal").open) { event.preventDefault(); togglePause(); }
});
canvas.addEventListener("pointermove", (event) => { event.preventDefault(); aimAt(event.clientX, event.clientY); });
canvas.addEventListener("pointerdown", (event) => { event.preventDefault(); canvas.setPointerCapture?.(event.pointerId); aimAt(event.clientX, event.clientY); });
canvas.addEventListener("pointerleave", () => { if (game) game.pointer.visible = false; });
window.addEventListener("resize", () => { if (!gameView.classList.contains("hidden")) resizeCanvas(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && game?.state === "playing") togglePause(); });

loadSession(); loadLeaderboard();
