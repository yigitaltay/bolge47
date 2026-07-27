const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { game: null, selectedRegion: null, activeView: "city", timer: null };
const buildingInfo = {
  command: ["Komuta Merkezi", "Savunma ve şehir seviyesini artırır", "⌂"],
  factory: ["Çelik Fabrikası", "Konvoydaki çelik üretimini artırır", "◆"],
  reactor: ["Enerji Reaktörü", "Enerji yenilenmesini hızlandırır", "ϟ"],
  finance: ["Finans Merkezi", "Kredi üretimini artırır", "₵"],
};
const resourceNames = { credit: "Kredi", steel: "Çelik", energy: "Enerji" };

function number(value) {
  return new Intl.NumberFormat("tr-TR").format(Number(value) || 0);
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.classList.remove("show"), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
  return data;
}

function setAuthTab(tab) {
  $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  $("#login-form").hidden = tab !== "login";
  $("#register-form").hidden = tab !== "register";
  $("#auth-message").textContent = "";
}

async function submitAuth(form, type) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  $("#auth-message").textContent = "";
  try {
    const values = Object.fromEntries(new FormData(form));
    await api(`/api/${type}`, { method: "POST", body: JSON.stringify(values) });
    await loadGame();
  } catch (error) {
    $("#auth-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadGame() {
  try {
    const data = await api("/api/state");
    state.game = data;
    $("#auth").hidden = true;
    $("#game").hidden = false;
    render();
  } catch {
    $("#auth").hidden = false;
    $("#game").hidden = true;
  }
}

async function perform(action, payload = {}) {
  try {
    const data = await api("/api/action", { method: "POST", body: JSON.stringify({ action, ...payload }) });
    state.game = { ...state.game, ...data.state };
    render();
    toast(data.message);
  } catch (error) {
    toast(error.message, true);
  }
}

function render() {
  if (!state.game) return;
  const { city, buildings, income, email } = state.game;
  $("#credits").textContent = number(city.credits);
  $("#steel").textContent = number(city.steel);
  $("#energy").textContent = number(city.energy);
  $("#profile-level").textContent = city.level;
  $("#profile-name").textContent = city.name;
  $("#profile-email").textContent = email;
  $("#city-name").textContent = city.name;
  $("#population").textContent = number(city.population);
  $("#defense").textContent = number(city.defense);
  $("#territory").textContent = number(city.territory);
  $("#rating").textContent = number(city.rating);
  $("#army-count").textContent = number(city.army);
  $("#army-defense").textContent = `${number(city.defense)} güç`;
  $("#income-credit").textContent = `+${number(income.credits)}`;
  $("#income-steel").textContent = `+${number(income.steel)}`;
  $("#income-energy").textContent = `+${number(income.energy)}`;
  renderBuildings(buildings);
  renderBattles();
  renderRegions();
  renderLeaderboard();
  updateCollectTimer();
  clearInterval(state.timer);
  state.timer = setInterval(updateCollectTimer, 1000);
}

function renderBuildings(buildings) {
  $("#building-grid").innerHTML = buildings.map((building) => {
    const [name, description, glyph] = buildingInfo[building.type];
    return `<article class="building-card panel">
      <span>SEVİYE ${building.level}</span><h3>${name}</h3><p>${description}</p>
      <i class="building-glyph">${glyph}</i>
      <div class="building-foot"><small>${number(450 * building.level)} ₵ · ${number(120 * building.level)} ◆</small>
      <button data-upgrade="${building.type}">Yükselt →</button></div>
    </article>`;
  }).join("");
  $$("[data-upgrade]").forEach((button) => button.addEventListener("click", () => perform("upgrade", { type: button.dataset.upgrade })));
}

function renderBattles() {
  const battles = state.game.battles;
  $("#battle-mini").innerHTML = battles.length
    ? battles.slice(0, 3).map((battle) => `<div><span>${battle.region_name}</span><b class="${battle.result}">${battle.result === "win" ? "ZAFER" : "YENİLGİ"}</b></div>`).join("")
    : "<p>Henüz çatışma yok.</p>";
  $("#battle-log").innerHTML = battles.length
    ? battles.map((battle) => `<div class="battle-row"><b class="${battle.result}">${battle.result === "win" ? "ZAFER" : "YENİLGİ"}</b><span>${battle.region_name}</span><span>Hücum ${battle.attack_power}</span><span>Savunma ${battle.defense_power}</span></div>`).join("")
    : "<p>İlk operasyonun harita ekranında seni bekliyor.</p>";
}

function renderRegions() {
  const map = $("#region-map");
  map.innerHTML = state.game.regions.map((region) => {
    const type = region.owner_id === state.game.city.user_id ? "mine" : region.owner_id ? "enemy" : "neutral";
    return `<button class="hex ${type}${state.selectedRegion === region.id ? " selected" : ""}" data-region="${region.id}">
      <b>${region.name}</b><span>${region.defense} savunma</span>
    </button>`;
  }).join("");
  $$("[data-region]").forEach((button) => button.addEventListener("click", () => {
    state.selectedRegion = Number(button.dataset.region);
    renderRegions();
    renderRegionPanel();
  }));
  if (state.selectedRegion) renderRegionPanel();
}

function renderRegionPanel() {
  const region = state.game.regions.find((item) => item.id === state.selectedRegion);
  if (!region) return;
  const mine = region.owner_id === state.game.city.user_id;
  const owner = mine ? "Sen" : region.owner_name || "Tarafsız";
  $("#region-panel").innerHTML = `<span class="eyebrow">BÖLGE #${String(region.id).padStart(2, "0")}</span>
    <h2>${region.name}</h2><p>${mine ? "Bu bölge senin kontrolünde. Savunması şehir gücünden beslenir." : "Hızlı bir operasyonla bölgeyi ele geçir ve sezon puanını yükselt."}</p>
    <div class="region-data"><span>Sahip<b>${owner}</b></span><span>Savunma<b>${region.defense}</b></span><span>Üretim<b>${resourceNames[region.resource_type]}</b></span><span>Enerji<b>15</b></span></div>
    ${mine ? '<button class="primary" data-nav-jump="city">Şehre dön</button>' : `<div class="attack-form"><label>Gönderilecek birlik<input id="attack-army" type="number" min="10" max="${state.game.city.army}" value="${Math.max(10, Math.ceil(state.game.city.army * .45))}" /></label><button id="attack-button" class="primary">Bölgeye saldır →</button></div>`}`;
  $("#attack-button")?.addEventListener("click", () => perform("attack", { regionId: region.id, army: Number($("#attack-army").value) }));
  $("[data-nav-jump]")?.addEventListener("click", () => navigate("city"));
}

function renderLeaderboard() {
  $("#leaderboard").innerHTML = state.game.leaderboard.map((entry, index) => `<div class="leader-row">
    <span>${index + 1}</span><b>${entry.name}</b><span>${entry.level}</span><span>${entry.territory}</span><span>${entry.wins}</span><span>${number(entry.rating)}</span>
  </div>`).join("");
}

function updateCollectTimer() {
  if (!state.game) return;
  const remaining = Math.max(0, state.game.collectReadyAt - Date.now());
  const button = $("#collect-button");
  button.disabled = remaining > 0;
  $("#collect-timer").textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)} saniye sonra hazır` : "Konvoy hazır";
}

function navigate(view) {
  state.activeView = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  $$("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  $("#profile-menu").hidden = true;
}

$$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
$("#login-form").addEventListener("submit", (event) => { event.preventDefault(); submitAuth(event.currentTarget, "login"); });
$("#register-form").addEventListener("submit", (event) => { event.preventDefault(); submitAuth(event.currentTarget, "register"); });
$$("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
$$("[data-recruit]").forEach((button) => button.addEventListener("click", () => perform("recruit", { amount: Number(button.dataset.recruit) })));
$("#collect-button").addEventListener("click", () => perform("collect"));
$("#fortify-button").addEventListener("click", () => perform("fortify"));
$("#profile-button").addEventListener("click", () => { $("#profile-menu").hidden = !$("#profile-menu").hidden; });
$("#logout-button").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.reload(); });
loadGame();
