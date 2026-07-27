export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type City = {
  id: number;
  user_id: number;
  name: string;
  credits: number;
  energy: number;
  steel: number;
  level: number;
  population: number;
  army: number;
  defense: number;
  territory: number;
  rating: number;
  wins: number;
  losses: number;
  last_collect_at: number;
};

const SESSION_DAYS = 30;
const REGION_NAMES = [
  "Kuzey Limanı", "Demir Ova", "Sahil 9", "Eski Merkez", "Kızıl Vadi",
  "Ar-Ge Bölgesi", "Gri Hat", "Doğu Kapısı", "Nova Meydanı", "Sanayi 12",
  "Enerji Havzası", "Yeşil Kuşak", "Metro Çemberi", "Yüksek Bölge", "Batı Tersanesi",
  "Veri Vadisi", "Kristal Kıyı", "Güney Terminali", "Merkez 47"
];
const REGION_RESOURCES = ["credit", "steel", "energy"] as const;


async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(\`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )\`),
    db.prepare(\`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )\`),
    db.prepare(\`CREATE TABLE IF NOT EXISTS cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 2500,
      energy INTEGER NOT NULL DEFAULT 100,
      steel INTEGER NOT NULL DEFAULT 600,
      level INTEGER NOT NULL DEFAULT 1,
      population INTEGER NOT NULL DEFAULT 120,
      army INTEGER NOT NULL DEFAULT 45,
      defense INTEGER NOT NULL DEFAULT 30,
      territory INTEGER NOT NULL DEFAULT 1,
      rating INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      last_collect_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )\`),
    db.prepare(\`CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, type)
    )\`),
    db.prepare(\`CREATE TABLE IF NOT EXISTS regions (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      defense INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )\`),
    db.prepare(\`CREATE TABLE IF NOT EXISTS battles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attacker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      defender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      region_id INTEGER NOT NULL REFERENCES regions(id),
      result TEXT NOT NULL,
      attack_power INTEGER NOT NULL,
      defense_power INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )\`),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS regions_owner_idx ON regions(owner_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS battles_attacker_idx ON battles(attacker_id, created_at DESC)")
  ]);
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const cleanEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase().slice(0, 160) : "";

const cleanName = (value: unknown) =>
  typeof value === "string"
    ? value.trim().replace(/[<>]/g, "").replace(/\s+/g, " ").slice(0, 24)
    : "";

const bytesToBase64 = (bytes: Uint8Array) => {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
};

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function passwordHash(password: string, salt: Uint8Array) {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBuffer, iterations: 210_000, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function timingSafeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a[index] ^ b[index];
  return result === 0;
}

function readCookie(request: Request, key: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const cookie of cookies.split(";")) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === key) return decodeURIComponent(parts.join("="));
  }
  return null;
}

async function createSession(db: D1Database, userId: number) {
  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const now = Date.now();
  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).bind(await sha256(rawToken), userId, now + SESSION_DAYS * 86400000, now).run();
  return rawToken;
}

async function currentUser(request: Request, db: D1Database) {
  const token = readCookie(request, "b47_session");
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await sha256(token), Date.now()).first<{ id: number; email: string }>();
}

async function ensureWorld(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM regions").first<{ count: number }>();
  if ((row?.count ?? 0) >= REGION_NAMES.length) return;
  const now = Date.now();
  const statements = REGION_NAMES.map((name, index) =>
    db.prepare(`
      INSERT OR IGNORE INTO regions (id, name, owner_id, defense, resource_type, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).bind(index + 1, name, 45 + (index % 5) * 12, REGION_RESOURCES[index % 3], now)
  );
  await db.batch(statements);
}

async function getCity(db: D1Database, userId: number) {
  return db.prepare("SELECT * FROM cities WHERE user_id = ?")
    .bind(userId).first<City>();
}

async function gameState(db: D1Database, userId: number) {
  await ensureWorld(db);
  const city = await getCity(db, userId);
  if (!city) throw new Error("Şehir bulunamadı.");
  const [buildings, regions, leaderboard, battles] = await Promise.all([
    db.prepare("SELECT type, level FROM buildings WHERE user_id = ? ORDER BY id").bind(userId).all(),
    db.prepare(`
      SELECT r.id, r.name, r.owner_id, r.defense, r.resource_type, c.name AS owner_name
      FROM regions r LEFT JOIN cities c ON c.user_id = r.owner_id ORDER BY r.id
    `).all(),
    db.prepare(`
      SELECT name, level, territory, rating, wins
      FROM cities ORDER BY rating DESC, territory DESC, wins DESC LIMIT 20
    `).all(),
    db.prepare(`
      SELECT b.result, b.attack_power, b.defense_power, b.created_at, r.name AS region_name
      FROM battles b JOIN regions r ON r.id = b.region_id
      WHERE b.attacker_id = ? ORDER BY b.created_at DESC LIMIT 8
    `).bind(userId).all(),
  ]);
  const income = {
    credits: 180 + Number((buildings.results.find((item) => item.type === "finance")?.level as number) ?? 0) * 95 + city.territory * 35,
    steel: 50 + Number((buildings.results.find((item) => item.type === "factory")?.level as number) ?? 0) * 32 + city.territory * 12,
    energy: 12 + Number((buildings.results.find((item) => item.type === "reactor")?.level as number) ?? 0) * 7,
  };
  return {
    city,
    buildings: buildings.results,
    regions: regions.results,
    leaderboard: leaderboard.results,
    battles: battles.results,
    income,
    collectReadyAt: city.last_collect_at + 60_000,
    serverTime: Date.now(),
  };
}

async function register(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>();
  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const cityName = cleanName(body.cityName);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Geçerli bir e-posta yaz." }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: "Şifre en az 8 karakter olmalı." }, 400);
  if (cityName.length < 3) return json({ error: "Şehir adı en az 3 karakter olmalı." }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "Bu e-posta zaten kayıtlı." }, 409);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  try {
    const userResult = await env.DB.prepare(`
      INSERT INTO users (email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)
    `).bind(email, await passwordHash(password, salt), bytesToBase64(salt), now).run();
    const userId = Number(userResult.meta.last_row_id);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO cities (user_id, name, updated_at) VALUES (?, ?, ?)
      `).bind(userId, cityName, now),
      env.DB.prepare(`
        INSERT INTO buildings (user_id, type, level) VALUES (?, 'command', 1)
      `).bind(userId),
      env.DB.prepare(`
        INSERT INTO buildings (user_id, type, level) VALUES (?, 'factory', 1)
      `).bind(userId),
      env.DB.prepare(`
        INSERT INTO buildings (user_id, type, level) VALUES (?, 'reactor', 1)
      `).bind(userId),
      env.DB.prepare(`
        INSERT INTO buildings (user_id, type, level) VALUES (?, 'finance', 1)
      `).bind(userId),
    ]);
    await ensureWorld(env.DB);
    const neutral = await env.DB.prepare(
      "SELECT id FROM regions WHERE owner_id IS NULL ORDER BY RANDOM() LIMIT 1",
    ).first<{ id: number }>();
    if (neutral) {
      await env.DB.prepare("UPDATE regions SET owner_id = ?, defense = 32, updated_at = ? WHERE id = ?")
        .bind(userId, now, neutral.id).run();
    }
    const token = await createSession(env.DB, userId);
    return json(
      { ok: true },
      201,
      { "set-cookie": `b47_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` },
    );
  } catch (error) {
    console.error(error);
    return json({ error: "Kayıt oluşturulamadı." }, 500);
  }
}

async function login(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>();
  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const user = await env.DB.prepare(
    "SELECT id, password_hash, password_salt FROM users WHERE email = ?",
  ).bind(email).first<{ id: number; password_hash: string; password_salt: string }>();
  if (!user) return json({ error: "E-posta veya şifre hatalı." }, 401);
  const calculated = await passwordHash(password, base64ToBytes(user.password_salt));
  if (!timingSafeEqual(calculated, user.password_hash)) return json({ error: "E-posta veya şifre hatalı." }, 401);
  const token = await createSession(env.DB, user.id);
  return json(
    { ok: true },
    200,
    { "set-cookie": `b47_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` },
  );
}

async function logout(request: Request, env: Env) {
  const token = readCookie(request, "b47_session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": "b47_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
}

async function action(request: Request, env: Env, userId: number) {
  const body = await request.json<Record<string, unknown>>();
  const kind = typeof body.action === "string" ? body.action : "";
  const city = await getCity(env.DB, userId);
  if (!city) return json({ error: "Şehir bulunamadı." }, 404);
  const now = Date.now();
  let message = "Hamle tamamlandı.";

  if (kind === "collect") {
    if (now < city.last_collect_at + 60_000) return json({ error: "Kaynak konvoyu henüz hazır değil." }, 429);
    const buildings = await env.DB.prepare("SELECT type, level FROM buildings WHERE user_id = ?").bind(userId).all<{ type: string; level: number }>();
    const level = (type: string) => buildings.results.find((item) => item.type === type)?.level ?? 0;
    const credits = 180 + level("finance") * 95 + city.territory * 35;
    const steel = 50 + level("factory") * 32 + city.territory * 12;
    const energy = 12 + level("reactor") * 7;
    await env.DB.prepare(`
      UPDATE cities SET credits = credits + ?, steel = steel + ?, energy = MIN(100, energy + ?),
      last_collect_at = ?, updated_at = ? WHERE user_id = ?
    `).bind(credits, steel, energy, now, now, userId).run();
    message = `Konvoy ulaştı: +${credits} kredi, +${steel} çelik, +${energy} enerji.`;
  } else if (kind === "upgrade") {
    const type = typeof body.type === "string" ? body.type : "";
    if (!["command", "factory", "reactor", "finance"].includes(type)) return json({ error: "Geçersiz bina." }, 400);
    const building = await env.DB.prepare(
      "SELECT level FROM buildings WHERE user_id = ? AND type = ?",
    ).bind(userId, type).first<{ level: number }>();
    if (!building) return json({ error: "Bina bulunamadı." }, 404);
    const creditCost = 450 * building.level;
    const steelCost = 120 * building.level;
    if (city.credits < creditCost || city.steel < steelCost) return json({ error: "Yükseltme için kaynakların yetersiz." }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE buildings SET level = level + 1 WHERE user_id = ? AND type = ?").bind(userId, type),
      env.DB.prepare(`
        UPDATE cities SET credits = credits - ?, steel = steel - ?, level = MAX(level, ?),
        defense = defense + ?, population = population + ?, updated_at = ? WHERE user_id = ?
      `).bind(creditCost, steelCost, building.level + 1, type === "command" ? 12 : 3, 20, now, userId),
    ]);
    message = "Bina seviyesi yükseltildi.";
  } else if (kind === "recruit") {
    const amount = Math.max(5, Math.min(50, Number(body.amount) || 10));
    const creditCost = amount * 18;
    const steelCost = amount * 6;
    if (city.credits < creditCost || city.steel < steelCost) return json({ error: "Birlik eğitimi için kaynakların yetersiz." }, 400);
    await env.DB.prepare(`
      UPDATE cities SET credits = credits - ?, steel = steel - ?, army = army + ?, updated_at = ? WHERE user_id = ?
    `).bind(creditCost, steelCost, amount, now, userId).run();
    message = `${amount} yeni birlik orduya katıldı.`;
  } else if (kind === "fortify") {
    if (city.credits < 380 || city.steel < 90) return json({ error: "Savunma yatırımı için kaynakların yetersiz." }, 400);
    await env.DB.prepare(`
      UPDATE cities SET credits = credits - 380, steel = steel - 90, defense = defense + 14, updated_at = ? WHERE user_id = ?
    `).bind(now, userId).run();
    message = "Şehir savunması güçlendirildi.";
  } else if (kind === "attack") {
    const regionId = Number(body.regionId);
    const region = await env.DB.prepare("SELECT * FROM regions WHERE id = ?").bind(regionId)
      .first<{ id: number; owner_id: number | null; name: string; defense: number }>();
    if (!region) return json({ error: "Bölge bulunamadı." }, 404);
    if (region.owner_id === userId) return json({ error: "Bu bölge zaten sana ait." }, 400);
    if (city.energy < 15) return json({ error: "Saldırı için 15 enerji gerekli." }, 400);
    const committed = Math.max(10, Math.min(city.army, Number(body.army) || Math.ceil(city.army * 0.45)));
    const attackPower = Math.round(committed * (0.82 + Math.random() * 0.42) + city.level * 5);
    const defensePower = Math.round(region.defense * (0.88 + Math.random() * 0.32));
    const won = attackPower >= defensePower;
    const casualties = Math.max(3, Math.round(committed * (won ? 0.18 : 0.42)));
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE cities SET energy = energy - 15, army = MAX(5, army - ?), rating = MAX(100, rating + ?),
        wins = wins + ?, losses = losses + ?, credits = credits + ?, updated_at = ? WHERE user_id = ?
      `).bind(casualties, won ? 32 : -18, won ? 1 : 0, won ? 0 : 1, won ? 420 : 0, now, userId),
      env.DB.prepare(`
        INSERT INTO battles (attacker_id, defender_id, region_id, result, attack_power, defense_power, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(userId, region.owner_id, region.id, won ? "win" : "loss", attackPower, defensePower, now),
    ]);
    if (won) {
      const oldOwner = region.owner_id;
      await env.DB.prepare("UPDATE regions SET owner_id = ?, defense = ?, updated_at = ? WHERE id = ?")
        .bind(userId, Math.max(30, Math.round((city.defense + committed) * 0.7)), now, region.id).run();
      const mine = await env.DB.prepare("SELECT COUNT(*) AS count FROM regions WHERE owner_id = ?").bind(userId).first<{ count: number }>();
      await env.DB.prepare("UPDATE cities SET territory = ? WHERE user_id = ?").bind(mine?.count ?? 1, userId).run();
      if (oldOwner) {
        const theirs = await env.DB.prepare("SELECT COUNT(*) AS count FROM regions WHERE owner_id = ?").bind(oldOwner).first<{ count: number }>();
        await env.DB.prepare("UPDATE cities SET territory = MAX(0, ?), rating = MAX(100, rating - 12) WHERE user_id = ?")
          .bind(theirs?.count ?? 0, oldOwner).run();
      }
    }
    message = won
      ? `${region.name} ele geçirildi! Çatışmada ${casualties} birlik kaybettin.`
      : `${region.name} savunmasını aşamadın. ${casualties} birlik kaybettin.`;
  } else {
    return json({ error: "Bilinmeyen hamle." }, 400);
  }

  return json({ message, state: await gameState(env.DB, userId) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      await ensureSchema(env.DB);
      if (request.method === "POST" && url.pathname === "/api/register") return register(request, env);
      if (request.method === "POST" && url.pathname === "/api/login") return login(request, env);
      if (request.method === "POST" && url.pathname === "/api/logout") return logout(request, env);

      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "Oturum gerekli." }, 401);
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json({ email: user.email, ...(await gameState(env.DB, user.id)) });
      }
      if (request.method === "POST" && url.pathname === "/api/action") return action(request, env, user.id);
      return json({ error: "Bulunamadı." }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "Sunucu hatası. Biraz sonra tekrar dene." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
