export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type User = { id: number; email: string; username: string | null; avatar_color: string | null };
type Run = { id: string; user_id: number; track_id: string; difficulty: string; started_at: number; expires_at: number; submitted_at: number | null };

const SESSION_DAYS = 30;
const TRACK_SECONDS: Record<string, number> = {
  "neon-pulse": 62,
  "glass-horizon": 64,
  "overdrive": 60,
};
const DIFFICULTIES = new Set(["easy", "normal", "hard", "expert"]);
const COLORS = ["#9cff3b", "#56e7ff", "#bd72ff", "#ff4da6", "#ffbe3d"];

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const cleanEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().slice(0, 160) : "";
const cleanUsername = (value: unknown) => typeof value === "string"
  ? value.trim().replace(/[^a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ-]/g, "").slice(0, 18)
  : "";

const bytesToBase64 = (bytes: Uint8Array) => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function passwordHash(password: string, salt: Uint8Array) {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBuffer, iterations: 210_000, hash: "SHA-256" }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function readCookie(request: Request, key: string) {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === key) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rhythm_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE, avatar_color TEXT NOT NULL DEFAULT '#9cff3b',
      total_score INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rhythm_runs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL, difficulty TEXT NOT NULL, started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, submitted_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rhythm_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL, difficulty TEXT NOT NULL, score INTEGER NOT NULL, accuracy REAL NOT NULL,
      max_combo INTEGER NOT NULL, perfect INTEGER NOT NULL, great INTEGER NOT NULL, good INTEGER NOT NULL,
      miss INTEGER NOT NULL, grade TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS rhythm_scores_board_idx ON rhythm_scores(track_id, difficulty, score DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS rhythm_scores_user_idx ON rhythm_scores(user_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS rhythm_runs_expiry_idx ON rhythm_runs(expires_at)"),
  ]);
}

async function createSession(db: D1Database, userId: number) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now + SESSION_DAYS * 86_400_000, now).run();
  return token;
}

async function currentUser(request: Request, db: D1Database) {
  const token = readCookie(request, "rythia_session");
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.email, p.username, p.avatar_color
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN rhythm_profiles p ON p.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), Date.now()).first<User>();
}

async function ensureProfile(db: D1Database, user: User) {
  if (user.username) return user;
  const base = cleanUsername(user.email.split("@")[0]) || `player${user.id}`;
  let username = base;
  for (let suffix = 0; suffix < 20; suffix++) {
    const taken = await db.prepare("SELECT 1 FROM rhythm_profiles WHERE username = ?").bind(username).first();
    if (!taken) break;
    username = `${base.slice(0, 14)}${user.id}${suffix || ""}`.slice(0, 18);
  }
  const color = COLORS[user.id % COLORS.length];
  await db.prepare("INSERT OR IGNORE INTO rhythm_profiles (user_id, username, avatar_color, created_at) VALUES (?, ?, ?, ?)")
    .bind(user.id, username, color, Date.now()).run();
  return { ...user, username, avatar_color: color };
}

function sessionCookie(token: string, maxAge = SESSION_DAYS * 86_400) {
  return `rythia_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function register(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>();
  const email = cleanEmail(body.email);
  const username = cleanUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Geçerli bir e-posta yaz." }, 400);
  if (username.length < 3) return json({ error: "Oyuncu adı en az 3 karakter olmalı." }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: "Şifre en az 8 karakter olmalı." }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "Bu e-posta zaten kayıtlı." }, 409);
  const nameTaken = await env.DB.prepare("SELECT 1 FROM rhythm_profiles WHERE username = ?").bind(username).first();
  if (nameTaken) return json({ error: "Bu oyuncu adı kullanılıyor." }, 409);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  try {
    await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)")
      .bind(email, await passwordHash(password, salt), bytesToBase64(salt), now).run();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
    if (!user) throw new Error("User insert failed");
    await env.DB.prepare("INSERT INTO rhythm_profiles (user_id, username, avatar_color, created_at) VALUES (?, ?, ?, ?)")
      .bind(user.id, username, COLORS[user.id % COLORS.length], now).run();
    const token = await createSession(env.DB, user.id);
    return json({ ok: true }, 201, { "set-cookie": sessionCookie(token) });
  } catch (error) {
    console.error("register", error);
    const orphan = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id NOT IN (SELECT user_id FROM rhythm_profiles)")
      .bind(email).first<{ id: number }>();
    if (orphan) await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(orphan.id).run();
    return json({ error: "Kayıt oluşturulamadı." }, 500);
  }
}

async function login(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>();
  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const row = await env.DB.prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email = ?")
    .bind(email).first<{ id: number; email: string; password_hash: string; password_salt: string }>();
  if (!row) return json({ error: "E-posta veya şifre hatalı." }, 401);
  const calculated = await passwordHash(password, base64ToBytes(row.password_salt));
  if (!safeEqual(calculated, row.password_hash)) return json({ error: "E-posta veya şifre hatalı." }, 401);
  await ensureProfile(env.DB, { id: row.id, email: row.email, username: null, avatar_color: null });
  const token = await createSession(env.DB, row.id);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
}

async function leaderboard(env: Env, url: URL) {
  const track = TRACK_SECONDS[url.searchParams.get("track") ?? ""] ? url.searchParams.get("track")! : "neon-pulse";
  const difficulty = DIFFICULTIES.has(url.searchParams.get("difficulty") ?? "") ? url.searchParams.get("difficulty")! : "normal";
  const rows = await env.DB.prepare(`SELECT p.username, p.avatar_color, s.score, s.accuracy, s.max_combo, s.grade, s.created_at
    FROM rhythm_scores s JOIN rhythm_profiles p ON p.user_id = s.user_id
    WHERE s.track_id = ? AND s.difficulty = ? ORDER BY s.score DESC, s.accuracy DESC LIMIT 100`)
    .bind(track, difficulty).all<Record<string, unknown>>();
  const seen = new Set<string>();
  const results = rows.results.filter((row) => {
    const username = String(row.username);
    if (seen.has(username)) return false;
    seen.add(username);
    return true;
  }).slice(0, 20).map((row, index) => ({ rank: index + 1, ...row }));
  return json({ track, difficulty, results });
}

async function startRun(request: Request, env: Env, userId: number) {
  const body = await request.json<Record<string, unknown>>();
  const track = typeof body.track === "string" ? body.track : "";
  const difficulty = typeof body.difficulty === "string" ? body.difficulty : "";
  if (!TRACK_SECONDS[track] || !DIFFICULTIES.has(difficulty)) return json({ error: "Geçersiz parça veya zorluk." }, 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO rhythm_runs (id, user_id, track_id, difficulty, started_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, track, difficulty, now, now + (TRACK_SECONDS[track] + 120) * 1000).run();
  return json({ runId: id, startedAt: now });
}

async function submitScore(request: Request, env: Env, userId: number) {
  const body = await request.json<Record<string, unknown>>();
  const runId = typeof body.runId === "string" ? body.runId : "";
  const run = await env.DB.prepare("SELECT * FROM rhythm_runs WHERE id = ? AND user_id = ?")
    .bind(runId, userId).first<Run>();
  if (!run || run.submitted_at || run.expires_at < Date.now()) return json({ error: "Bu oyun oturumu geçersiz." }, 400);

  const score = Math.round(Number(body.score));
  const accuracy = Math.round(Number(body.accuracy) * 100) / 100;
  const maxCombo = Math.round(Number(body.maxCombo));
  const perfect = Math.round(Number(body.perfect));
  const great = Math.round(Number(body.great));
  const good = Math.round(Number(body.good));
  const miss = Math.round(Number(body.miss));
  const totalNotes = perfect + great + good + miss;
  const minDuration = (TRACK_SECONDS[run.track_id] - 8) * 1000;
  if (Date.now() - run.started_at < minDuration || !Number.isFinite(score) || score < 0 || score > 1_000_000 ||
      !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100 || maxCombo < 0 || maxCombo > totalNotes ||
      totalNotes < 20 || totalNotes > 2000 || [perfect, great, good, miss].some((value) => value < 0)) {
    return json({ error: "Skor doğrulanamadı." }, 400);
  }
  const grade = accuracy >= 99 ? "S+" : accuracy >= 96 ? "S" : accuracy >= 92 ? "A" : accuracy >= 85 ? "B" : accuracy >= 75 ? "C" : "D";
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE rhythm_runs SET submitted_at = ? WHERE id = ?").bind(now, run.id),
    env.DB.prepare(`INSERT INTO rhythm_scores
      (user_id, track_id, difficulty, score, accuracy, max_combo, perfect, great, good, miss, grade, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, run.track_id, run.difficulty, score, accuracy, maxCombo, perfect, great, good, miss, grade, now),
    env.DB.prepare("UPDATE rhythm_profiles SET total_score = total_score + ?, plays = plays + 1 WHERE user_id = ?")
      .bind(score, userId),
  ]);
  return json({ ok: true, grade });
}

async function profileState(env: Env, user: User) {
  const ready = await ensureProfile(env.DB, user);
  const stats = await env.DB.prepare(`SELECT p.total_score, p.plays,
      COALESCE(MAX(s.score), 0) AS best_score, COALESCE(MAX(s.max_combo), 0) AS best_combo
    FROM rhythm_profiles p LEFT JOIN rhythm_scores s ON s.user_id = p.user_id WHERE p.user_id = ?`)
    .bind(user.id).first();
  return json({ user: { email: ready.email, username: ready.username, avatarColor: ready.avatar_color }, stats });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env.DB);
      if (request.method === "GET" && url.pathname === "/api/leaderboard") return leaderboard(env, url);
      if (request.method === "POST" && url.pathname === "/api/register") return register(request, env);
      if (request.method === "POST" && url.pathname === "/api/login") return login(request, env);
      if (request.method === "POST" && url.pathname === "/api/logout") {
        const token = readCookie(request, "rythia_session");
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
        return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
      }
      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "Oturum gerekli." }, 401);
      if (request.method === "GET" && url.pathname === "/api/me") return profileState(env, user);
      if (request.method === "POST" && url.pathname === "/api/run/start") return startRun(request, env, user.id);
      if (request.method === "POST" && url.pathname === "/api/run/submit") return submitScore(request, env, user.id);
      return json({ error: "Bulunamadı." }, 404);
    } catch (error) {
      console.error("api", error);
      return json({ error: "Sunucu hatası. Biraz sonra tekrar dene." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
