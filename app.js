const API = "https://catfacts.wohlbruck.dev";
const CACHE_KEY = "catdex-cache-v3";
const BATCH_SIZE = 500;
const MAX_BATCHES = 8;
const PAGE_SIZE = 24;

const state = {
  facts: [],
  filtered: [],
  selectedId: null,
  query: "",
  type: "all",
  view: "list",
  page: 1,
  gridIds: "",
};

const memory = new Map();
const inflight = new Map();

const els = {
  device: document.getElementById("device"),
  grid: document.getElementById("catalog-grid"),
  meta: document.getElementById("catalog-meta"),
  empty: document.getElementById("empty-state"),
  detail: document.getElementById("detail"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  backBtn: document.getElementById("back-btn"),
  pager: document.getElementById("pager"),
  pageLabel: document.getElementById("page-label"),
  pagePrev: document.getElementById("page-prev"),
  pageNext: document.getElementById("page-next"),
};

function hashNumber(value) {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function keepFact(fact) {
  if (!fact?._id || fact.deleted) return false;
  return !fact.type || fact.type === "cat";
}

function typeLabel(type) {
  const labels = { cat: "gato", dog: "perro", horse: "caballo" };
  return labels[type] || "gato";
}

function sourceLabel(source) {
  const labels = { user: "usuario", api: "api", archive: "archivo" };
  return labels[source] || source || "archivo";
}

function entryNumber(fact, index) {
  const n = (index ?? hashNumber(fact._id) % 900) + 1;
  return String(n).padStart(3, "0");
}

function entryName(fact) {
  const sentence = String(fact.text || "").trim().split(/[.!?]/)[0];
  if (sentence.length <= 42) return sentence;
  return `${sentence.slice(0, 40).trim()}…`;
}

function entryImage(fact) {
  const set = fact.type === "dog" ? "set1" : fact.type === "horse" ? "set2" : "set4";
  return `https://robohash.org/${encodeURIComponent(fact._id)}.png?set=${set}&size=320x320`;
}

function statBlock(fact) {
  const ageYears = Math.max(
    0,
    (Date.now() - new Date(fact.createdAt || fact.updatedAt || Date.now()).getTime()) /
      (1000 * 60 * 60 * 24 * 365)
  );
  const verified = fact.status?.verified === true ? 100 : fact.status?.verified === false ? 12 : 42;
  const popularity = Math.min(100, (Number(fact.status?.sentCount) || 0) * 18 + 18);
  const detail = Math.min(100, Math.round((String(fact.text || "").length / 180) * 100));
  const recency = Math.max(8, Math.round(100 - ageYears * 10));
  const reach = fact.used ? 76 : 34;

  return [
    { label: "Verificado", value: verified },
    { label: "Popularidad", value: popularity },
    { label: "Detalle", value: detail },
    { label: "Reciente", value: recency },
    { label: "Alcance", value: reach },
  ];
}

function readDiskCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!parsed?.facts?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(facts) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), facts }));
  } catch {
    /* quota or private mode — ignore */
  }
}

async function fetchJson(path, timeout = 120000, { cache = true } = {}) {
  if (cache && memory.has(path)) return memory.get(path);
  if (cache && inflight.has(path)) return inflight.get(path);

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${API}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`El archivo respondió ${response.status}`);
      const data = await response.json();
      if (cache) memory.set(path, data);
      return data;
    } finally {
      clearTimeout(timer);
      inflight.delete(path);
    }
  })();

  if (cache) inflight.set(path, request);
  return request;
}

function mergeFacts(incoming) {
  const unique = new Map(state.facts.map((fact) => [fact._id, fact]));
  incoming
    .flat()
    .filter(keepFact)
    .forEach((fact) => {
      if (!fact?._id) return;
      unique.set(fact._id, { ...unique.get(fact._id), ...fact });
    });
  state.facts = [...unique.values()].sort((a, b) => {
    const av = a.status?.verified === true ? 0 : 1;
    const bv = b.status?.verified === true ? 0 : 1;
    return av - bv;
  });
}

function showSkeletons() {
  els.grid.innerHTML = Array.from({ length: 8 }, () => `<div class="entry-card skeleton"></div>`).join("");
}

async function loadCatalog() {
  els.empty.hidden = true;
  const cached = readDiskCache();
  if (cached?.facts?.length) {
    mergeFacts(cached.facts);
    applyFilters();
    els.meta.textContent = `${state.filtered.length} hechos · cargando el resto…`;
  } else {
    els.meta.textContent = "Cargando todos los hechos de gatos…";
    showSkeletons();
  }
  await refreshCatalog();
}

async function refreshCatalog() {
  try {
    try {
      const verified = await fetchJson("/facts", 60000);
      mergeFacts([].concat(verified));
      applyFilters();
    } catch {
      /* keep going — the big random dump is the real archive */
    }

    let previous = -1;
    let stalled = 0;

    for (let round = 1; round <= MAX_BATCHES; round += 1) {
      els.meta.textContent = `Cargando todos los gatos… ${state.facts.length} hasta ahora (lote ${round}/${MAX_BATCHES})`;
      try {
        const batch = await fetchJson(
          `/facts/random?animal_type=cat&amount=${BATCH_SIZE}&_=${round}`,
          180000,
          { cache: false }
        );
        mergeFacts([].concat(batch));
        applyFilters();
        writeDiskCache(state.facts);
      } catch {
        els.meta.textContent = `${state.facts.length} hechos · reintentando lote ${round}…`;
        continue;
      }

      if (state.facts.length === previous) {
        stalled += 1;
        if (stalled >= 2) break;
      } else {
        stalled = 0;
      }
      previous = state.facts.length;
    }

    if (!state.facts.length) throw new Error("El archivo volvió vacío");
    applyFilters();
    writeDiskCache(state.facts);
  } catch (error) {
    if (state.facts.length) {
      els.meta.textContent = `${state.filtered.length} hechos · caché sin conexión`;
      return;
    }
    els.meta.textContent = "No se pudo alcanzar el archivo.";
    els.detail.innerHTML = `<div class="error-box">${error.message}. El host viejo de Heroku está caído; esta app usa https://catfacts.wohlbruck.dev.</div>`;
  }
}

function pageCount() {
  return Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
}

function clampPage() {
  state.page = Math.min(Math.max(1, state.page), pageCount());
}

function pageItems() {
  const start = (state.page - 1) * PAGE_SIZE;
  return state.filtered.slice(start, start + PAGE_SIZE);
}

function goToPage(page) {
  state.page = page;
  clampPage();
  renderCatalog();
}

function revealFactPage(id) {
  const index = state.filtered.findIndex((fact) => fact._id === id);
  if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
}

function applyFilters({ resetPage = false } = {}) {
  const query = state.query.trim().toLowerCase();

  state.filtered = state.facts.filter((fact) => {
    const typeOk = state.type === "all" || fact.type === state.type;
    if (!typeOk) return false;
    if (!query) return true;
    return (
      fact.text.toLowerCase().includes(query) ||
      fact._id.toLowerCase().includes(query) ||
      entryName(fact).toLowerCase().includes(query) ||
      String(fact.type || "").includes(query)
    );
  });

  if (resetPage) state.page = 1;
  clampPage();
  renderCatalog();
}

function renderCatalog() {
  const pages = pageCount();
  const visible = pageItems();
  const start = (state.page - 1) * PAGE_SIZE;

  els.meta.textContent = state.filtered.length
    ? `${state.filtered.length} hechos · página ${state.page} de ${pages}`
    : "0 hechos en esta bandeja";
  els.empty.hidden = state.filtered.length > 0;

  if (els.pager) {
    els.pager.hidden = state.filtered.length <= PAGE_SIZE;
    els.pageLabel.textContent = `${state.page} / ${pages}`;
    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= pages;
  }

  const ids = `${state.page}:${visible.map((fact) => fact._id).join(",")}`;
  if (ids !== state.gridIds) {
    state.gridIds = ids;
    els.grid.innerHTML = visible
      .map((fact, index) => {
        return `
          <button class="entry-card" type="button" data-id="${fact._id}">
            <img src="${entryImage(fact)}" alt="" width="58" height="58" loading="lazy" decoding="async" />
            <span class="num">#${entryNumber(fact, start + index)}</span>
            <span class="type-dot ${fact.type || "cat"}">${typeLabel(fact.type)}</span>
          </button>
        `;
      })
      .join("");
  }

  els.grid.querySelectorAll(".entry-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.id === state.selectedId);
  });
}

function renderDetail(fact, index) {
  if (!fact) return;

  const stats = statBlock(fact);
  const created = fact.createdAt ? new Date(fact.createdAt).toLocaleDateString("es") : "Desconocido";
  const userName = fact.user?.name
    ? `${fact.user.name.first || ""} ${fact.user.name.last || ""}`.trim()
    : "Colaborador del archivo";
  const title = `Hecho de ${typeLabel(fact.type)} #${entryNumber(fact, index)}`;

  els.detail.innerHTML = `
    <div class="wiki-body">
      <p class="wiki-kicker">Entrada #${entryNumber(fact, index)} · ${typeLabel(fact.type)}</p>
      <aside class="infobox">
        <img src="${entryImage(fact)}" alt="Retrato de ${title}" width="230" height="230" />
        <dl>
          <div><dt>Nombre</dt><dd>${title}</dd></div>
          <div><dt>Número</dt><dd>#${entryNumber(fact, index)}</dd></div>
          <div><dt>Tipo</dt><dd><span class="type-badge ${fact.type || "cat"}">${typeLabel(fact.type)}</span></dd></div>
          <div><dt>Fuente</dt><dd>${sourceLabel(fact.source)}</dd></div>
          <div><dt>Registrado</dt><dd>${created}</dd></div>
        </dl>
      </aside>
      <h2>${title}</h2>
      <p class="wiki-text">${fact.text}</p>
      <section class="stats">
        <h3>Estadísticas</h3>
        ${stats
          .map(
            (stat) => `
              <div class="stat">
                <span>${stat.label}</span>
                <div class="bar"><span style="width:${stat.value}%"></span></div>
                <strong>${stat.value}</strong>
              </div>
            `
          )
          .join("")}
      </section>
      <p class="wiki-note">Registrado por ${userName}. Estado: ${
        fact.status?.verified === true ? "verificado" : "pendiente de revisión"
      }.</p>
    </div>
  `;
}

function selectFact(id) {
  const index = state.filtered.findIndex((fact) => fact._id === id);
  const fact = state.filtered[index] || state.facts.find((item) => item._id === id);
  if (!fact) return;

  state.selectedId = fact._id;
  state.view = "detail";
  els.device.dataset.view = "detail";
  revealFactPage(fact._id);
  renderCatalog();
  renderDetail(fact, index >= 0 ? index : 0);

  if (fact.user && typeof fact.user === "object") return;
  hydrateFact(id, index >= 0 ? index : 0);
}

function hydrateFact(id, index) {
  fetchJson(`/facts/${id}`, 5000)
    .then((full) => {
      if (!full?._id || state.selectedId !== id) return;
      const slot = state.facts.findIndex((item) => item._id === id);
      if (slot >= 0) state.facts[slot] = { ...state.facts[slot], ...full };
      renderDetail({ ...state.facts[slot] }, index);
    })
    .catch(() => {});
}

function showList() {
  state.view = "list";
  els.device.dataset.view = "list";
}

function moveSelection(direction) {
  if (!state.filtered.length) return;

  const columns = window.innerWidth <= 900 ? 3 : 4;
  let index = state.filtered.findIndex((fact) => fact._id === state.selectedId);
  if (index < 0) index = 0;

  if (direction === "left") index -= 1;
  if (direction === "right") index += 1;
  if (direction === "up") index -= columns;
  if (direction === "down") index += columns;

  index = Math.max(0, Math.min(state.filtered.length - 1, index));
  selectFact(state.filtered[index]._id);
}

async function loadRandom() {
  const pool = state.filtered.length ? state.filtered : state.facts;
  if (pool.length) {
    const fact = pool[Math.floor(Math.random() * pool.length)];
    selectFact(fact._id);
    return;
  }

  try {
    els.meta.textContent = "Buscando un hecho al azar…";
    const result = await fetchJson(
      `/facts/random?animal_type=cat`,
      60000
    );
    const fact = Array.isArray(result) ? result[0] : result;
    if (!fact?._id) return;
    mergeFacts([fact]);
    applyFilters();
    selectFact(fact._id);
  } catch (error) {
    els.detail.innerHTML = `<div class="error-box">${error.message}</div>`;
  }
}

async function searchRemote(query) {
  const local = state.facts.find((fact) => fact._id === query);
  if (local) {
    selectFact(local._id);
    return;
  }

  if (/^[a-f0-9]{24}$/i.test(query)) {
    try {
      const fact = await fetchJson(`/facts/${query}`, 5000);
      if (fact?._id) {
        mergeFacts([fact]);
        applyFilters();
        selectFact(fact._id);
      }
    } catch {
      applyFilters();
    }
  }
}

els.grid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (card) selectFact(card.dataset.id);
});

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = els.searchInput.value;
  applyFilters({ resetPage: true });
  searchRemote(state.query.trim());
});

els.searchInput.addEventListener("input", () => {
  state.query = els.searchInput.value;
  applyFilters({ resetPage: true });
});

els.pagePrev.addEventListener("click", () => goToPage(state.page - 1));
els.pageNext.addEventListener("click", () => goToPage(state.page + 1));

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((item) => item.classList.remove("is-active"));
    chip.classList.add("is-active");
    state.type = chip.dataset.type;
    applyFilters();
  });
});

document.querySelectorAll(".dpad-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.dir === "select") {
      if (state.selectedId) selectFact(state.selectedId);
      return;
    }
    moveSelection(button.dataset.dir);
  });
});

document.getElementById("btn-random").addEventListener("click", loadRandom);
document.getElementById("dock-random").addEventListener("click", loadRandom);
document.getElementById("btn-back").addEventListener("click", showList);
els.backBtn.addEventListener("click", showList);

document.querySelectorAll("[data-dock]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.dock === "catalog") showList();
    if (button.dataset.dock === "about") {
      state.view = "about";
      els.device.dataset.view = "detail";
      els.detail.innerHTML = `
        <div class="welcome">
          <p class="welcome-kicker">Acerca de este dex</p>
          <h2>Catdex 02</h2>
          <p>
            Guía de campo adaptable que lee la API pública Cat Facts con <code>fetch()</code>
            y muestra nombre, número, imagen, tipo y estadísticas en el DOM. En escritorio
            imita un dex físico; en móvil se simplifica a un catálogo y una ficha.
          </p>
        </div>
      `;
    }
  });
});

window.addEventListener("keydown", (event) => {
  const keys = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  if (keys[event.key]) {
    event.preventDefault();
    moveSelection(keys[event.key]);
  }
});

loadCatalog();
