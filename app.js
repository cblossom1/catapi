const API = "https://catfacts.wohlbruck.dev";

const CACHE_KEY = "catdex-cache-v4";
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

const CAT_NAMES = [
  "Milo",
  "Luna",
  "Simba",
  "Nala",
  "Cleo",
  "Oliver",
  "Misha",
  "Leo",
  "Mochi",
  "Nina",
  "Toby",
  "Kira",
  "Salem",
  "Coco",
  "Theo",
  "Loki",
  "Maya",
  "Bowie",
  "Chloe",
  "Tom",
  "Kiwi",
  "Sushi",
  "Roma",
  "Bruno",
  "Mia",
  "Felix",
  "Nube",
  "Gala",
  "Gudy",
  "Lia",
  "Cosmo",
  "Mango",
  "Neko",
  "Shadow",
  "Simon",
  "Dante",
  "Frida",
  "Mora",
  "Pixel",
  "Olivia",
  "Max",
  "Cinnamon",
  "Tao",
  "Zoe",
  "Ringo",
  "Lola",
  "Bambi",
  "Ciro",
  "Uma",
  "Koda",
];

const CAT_TRAITS = [
  "Observant",
  "Explorer",
  "Curious",
  "Calm",
  "Playful",
  "Independent",
  "Sociable",
  "Sleepy",
  "Natural Hunter",
  "Water Lover",
];

function hashNumber(value) {
  let hash = 0;
  const text = String(value);

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function keepFact(fact) {
  if (!fact?._id || fact.deleted) {
    return false;
  }

  return !fact.type || fact.type === "cat";
}

function sourceLabel(source) {
  const labels = {
    user: "User",
    api: "API",
    archive: "Archive",
  };

  return labels[source] || source || "Archive";
}

function entryNumber(fact, index) {
  const n =
    (index ?? hashNumber(fact._id) % 900) + 1;

  return String(n).padStart(3, "0");
}

function catName(fact) {
  const index =
    hashNumber(fact._id) % CAT_NAMES.length;

  return CAT_NAMES[index];
}

function catTrait(fact) {
  const text = String(
    fact.text || ""
  ).toLowerCase();

  if (
    /sleep|sleeping|sleepy|nap/.test(text)
  ) {
    return "Sleepy";
  }

  if (
    /hunt|hunting|hunter|predator|prey/.test(text)
  ) {
    return "Natural Hunter";
  }

  if (
    /water|drink|drinking|swim/.test(text)
  ) {
    return "Water Lover";
  }

  if (
    /food|eat|eating|diet|meal/.test(text)
  ) {
    return "Big Appetite";
  }

  if (
    /eye|eyes|vision|sight/.test(text)
  ) {
    return "Curious Gaze";
  }

  if (
    /sound|hear|hearing|ear/.test(text)
  ) {
    return "Sensitive Hearing";
  }

  if (
    /smell|scent|olfactory|nose/.test(text)
  ) {
    return "Sharp Sense of Smell";
  }

  if (
    /hair|fur|coat|whisker/.test(text)
  ) {
    return "Distinctive Coat";
  }

  if (
    /kitten|young|baby|play|playing/.test(text)
  ) {
    return "Playful Spirit";
  }

  if (
    /human|people|owner|person|social/.test(text)
  ) {
    return "Sociable";
  }

  const index =
    (hashNumber(fact._id) >> 4) %
    CAT_TRAITS.length;

  return CAT_TRAITS[index];
}

function entryImage(fact) {
  return `https://robohash.org/${encodeURIComponent(
    fact._id
  )}.png?set=set4&size=320x320`;
}

function statBlock(fact) {
  const base = hashNumber(fact._id);

  const curiosity =
    40 + (base % 61);

  const sociability =
    35 + ((base >> 3) % 66);

  const instinct =
    45 + ((base >> 6) % 56);

  const adaptability =
    40 + ((base >> 9) % 61);

  const energy =
    30 + ((base >> 12) % 71);

  return [
    {
      label: "Curiosity",
      value: curiosity,
    },
    {
      label: "Sociability",
      value: sociability,
    },
    {
      label: "Instinct",
      value: instinct,
    },
    {
      label: "Adaptability",
      value: adaptability,
    },
    {
      label: "Energy",
      value: energy,
    },
  ];
}

function readDiskCache() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(CACHE_KEY) || "null"
    );

    if (!parsed?.facts?.length) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(facts) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        facts,
      })
    );
  } catch {
    // Continue normally if storage is unavailable.
  }
}

async function fetchJson(
  path,
  timeout = 120000,
  { cache = true } = {}
) {
  if (cache && memory.has(path)) {
    return memory.get(path);
  }

  if (cache && inflight.has(path)) {
    return inflight.get(path);
  }

  const request = (async () => {
    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeout
    );

    try {
      const response = await fetch(
        `${API}${path}`,
        {
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(
          `The archive responded with ${response.status}`
        );
      }

      const data =
        await response.json();

      if (cache) {
        memory.set(path, data);
      }

      return data;
    } finally {
      clearTimeout(timer);
      inflight.delete(path);
    }
  })();

  if (cache) {
    inflight.set(path, request);
  }

  return request;
}

function mergeFacts(incoming) {
  const unique = new Map(
    state.facts.map((fact) => [
      fact._id,
      fact,
    ])
  );

  incoming
    .flat()
    .filter(keepFact)
    .forEach((fact) => {
      if (!fact?._id) {
        return;
      }

      unique.set(fact._id, {
        ...unique.get(fact._id),
        ...fact,
      });
    });

  state.facts = [
    ...unique.values(),
  ].sort((a, b) => {
    const av =
      a.status?.verified === true
        ? 0
        : 1;

    const bv =
      b.status?.verified === true
        ? 0
        : 1;

    return av - bv;
  });
}

function showSkeletons() {
  els.grid.innerHTML = Array.from(
    { length: 8 },
    () => `<div class="entry-card skeleton"></div>`
  ).join("");
}

async function loadCatalog() {
  els.empty.hidden = true;

  const cached =
    readDiskCache();

  if (cached?.facts?.length) {
    mergeFacts(cached.facts);

    applyFilters();

    els.meta.textContent =
      `${state.filtered.length} records · loading archive…`;
  } else {
    els.meta.textContent =
      "Loading feline archive…";

    showSkeletons();
  }

  await refreshCatalog();
}

async function refreshCatalog() {
  try {
    try {
      const verified =
        await fetchJson(
          "/facts",
          60000
        );

      mergeFacts(
        [].concat(verified)
      );

      applyFilters();
    } catch {
      // Continue with the main archive.
    }

    let previous = -1;
    let stalled = 0;

    for (
      let round = 1;
      round <= MAX_BATCHES;
      round += 1
    ) {
      els.meta.textContent =
        `Exploring feline archive… ${state.facts.length} records ` +
        `(batch ${round}/${MAX_BATCHES})`;

      try {
        const batch =
          await fetchJson(
            `/facts/random?animal_type=cat&amount=${BATCH_SIZE}&_=${round}`,
            180000,
            { cache: false }
          );

        mergeFacts(
          [].concat(batch)
        );

        applyFilters();

        writeDiskCache(
          state.facts
        );
      } catch {
        els.meta.textContent =
          `${state.facts.length} records · retrying batch ${round}…`;

        continue;
      }

      if (
        state.facts.length ===
        previous
      ) {
        stalled += 1;

        if (stalled >= 2) {
          break;
        }
      } else {
        stalled = 0;
      }

      previous =
        state.facts.length;
    }

    if (!state.facts.length) {
      throw new Error(
        "The archive returned no records."
      );
    }

    applyFilters();

    writeDiskCache(
      state.facts
    );
  } catch (error) {
    if (state.facts.length) {
      els.meta.textContent =
        `${state.filtered.length} records · local archive`;

      return;
    }

    els.meta.textContent =
      "Could not reach the archive.";

    els.detail.innerHTML = `
      <div class="error-box">
        ${error.message}
      </div>
    `;
  }
}

function pageCount() {
  return Math.max(
    1,
    Math.ceil(
      state.filtered.length /
        PAGE_SIZE
    )
  );
}

function clampPage() {
  state.page = Math.min(
    Math.max(1, state.page),
    pageCount()
  );
}

function pageItems() {
  const start =
    (state.page - 1) *
    PAGE_SIZE;

  return state.filtered.slice(
    start,
    start + PAGE_SIZE
  );
}

function goToPage(page) {
  state.page = page;

  clampPage();

  renderCatalog();
}

function revealFactPage(id) {
  const index =
    state.filtered.findIndex(
      (fact) =>
        fact._id === id
    );

  if (index >= 0) {
    state.page =
      Math.floor(
        index / PAGE_SIZE
      ) + 1;
  }
}

function applyFilters({
  resetPage = false,
} = {}) {
  const query =
    state.query
      .trim()
      .toLowerCase();

  state.filtered =
    state.facts.filter(
      (fact) => {
        const typeOk =
          state.type === "all" ||
          fact.type ===
            state.type;

        if (!typeOk) {
          return false;
        }

        if (!query) {
          return true;
        }

        return (
          String(
            fact.text || ""
          )
            .toLowerCase()
            .includes(query) ||

          String(
            fact._id || ""
          )
            .toLowerCase()
            .includes(query) ||

          catName(fact)
            .toLowerCase()
            .includes(query) ||

          catTrait(fact)
            .toLowerCase()
            .includes(query) ||

          String(
            fact.type || ""
          )
            .toLowerCase()
            .includes(query)
        );
      }
    );

  if (resetPage) {
    state.page = 1;
  }

  clampPage();

  renderCatalog();
}

function renderCatalog() {
  const pages =
    pageCount();

  const visible =
    pageItems();

  const start =
    (state.page - 1) *
    PAGE_SIZE;

  els.meta.textContent =
    state.filtered.length
      ? `${state.filtered.length} cats registered · page ${state.page} of ${pages}`
      : "0 cats found";

  els.empty.hidden =
    state.filtered.length > 0;

  if (els.pager) {
    els.pager.hidden =
      state.filtered.length <=
      PAGE_SIZE;

    els.pageLabel.textContent =
      `${state.page} / ${pages}`;

    els.pagePrev.disabled =
      state.page <= 1;

    els.pageNext.disabled =
      state.page >= pages;
  }

  const ids =
    `${state.page}:${visible
      .map((fact) => fact._id)
      .join(",")}`;

  if (
    ids !== state.gridIds
  ) {
    state.gridIds = ids;

    els.grid.innerHTML =
      visible
        .map(
          (fact, index) => {
            const name =
              catName(fact);

            const trait =
              catTrait(fact);

            return `
              <button
                class="entry-card"
                type="button"
                data-id="${fact._id}"
                aria-label="Open record for ${name}"
              >
                <img
                  src="${entryImage(fact)}"
                  alt="Portrait of ${name}"
                  width="58"
                  height="58"
                  loading="lazy"
                  decoding="async"
                />

                <span class="num">
                  #${entryNumber(
                    fact,
                    start + index
                  )}
                </span>

                <strong class="cat-name">
                  ${name}
                </strong>

                <span class="type-dot cat">
                  ${trait}
                </span>
              </button>
            `;
          }
        )
        .join("");
  }

  els.grid
    .querySelectorAll(
      ".entry-card"
    )
    .forEach((card) => {
      card.classList.toggle(
        "is-selected",
        card.dataset.id ===
          state.selectedId
      );
    });
}

function renderDetail(
  fact,
  index
) {
  if (!fact) {
    return;
  }

  const name =
    catName(fact);

  const trait =
    catTrait(fact);

  const stats =
    statBlock(fact);

  const created =
    fact.createdAt
      ? new Date(
          fact.createdAt
        ).toLocaleDateString(
          "en-US"
        )
      : "Unknown";

  const userName =
    fact.user?.name
      ? `${fact.user.name.first || ""} ${
          fact.user.name.last || ""
        }`.trim()
      : "Archive contributor";

  const number =
    entryNumber(
      fact,
      index
    );

  const status =
    fact.status?.verified === true
      ? "Verified"
      : "Pending review";

  els.detail.innerHTML = `
    <div class="wiki-body">

      <div class="record-header">
        <p class="wiki-kicker">
          FELINE RECORD #${number} · CATDEX 02
        </p>

        <h2>${name}</h2>

        <p class="record-trait">
          ${trait}
        </p>
      </div>

      <div class="record-layout">

        <aside class="infobox">

          <img
            src="${entryImage(fact)}"
            alt="Portrait of ${name}"
            width="230"
            height="230"
          />

          <dl>

            <div>
              <dt>Name</dt>
              <dd>${name}</dd>
            </div>

            <div>
              <dt>Code</dt>
              <dd>#${number}</dd>
            </div>

            <div>
              <dt>Type</dt>
              <dd>
                <span class="type-badge cat">
                  Cat
                </span>
              </dd>
            </div>

            <div>
              <dt>Trait</dt>
              <dd>${trait}</dd>
            </div>

            <div>
              <dt>Source</dt>
              <dd>${sourceLabel(
                fact.source
              )}</dd>
            </div>

            <div>
              <dt>Registered</dt>
              <dd>${created}</dd>
            </div>

          </dl>

        </aside>

        <section class="description-section">

          <h3 class="section-title">
            DESCRIPTION
          </h3>

          <p class="wiki-text">
            ${fact.text}
          </p>

          <p class="description-note">
            Original fact provided by the Cat Facts API.
          </p>

        </section>

      </div>

      <section class="stats">

        <h3>
          FELINE PROFILE
        </h3>

        ${stats
          .map(
            (stat) => `
              <div class="stat">

                <span>
                  ${stat.label}
                </span>

                <div class="bar">
                  <span
                    style="width:${stat.value}%"
                  ></span>
                </div>

                <strong>
                  ${stat.value}
                </strong>

              </div>
            `
          )
          .join("")}

      </section>

      <p class="wiki-note">

        Record associated with
        <strong>${name}</strong>.

        The visual profile is part of
        Catdex. The fact shown above comes
        directly from the public Cat Facts API.

        Registered by
        ${userName}.

        Status:
        ${status}.

      </p>

    </div>
  `;
}

function selectFact(id) {
  const index =
    state.filtered.findIndex(
      (fact) =>
        fact._id === id
    );

  const fact =
    state.filtered[index] ||
    state.facts.find(
      (item) =>
        item._id === id
    );

  if (!fact) {
    return;
  }

  state.selectedId =
    fact._id;

  state.view =
    "detail";

  els.device.dataset.view =
    "detail";

  revealFactPage(
    fact._id
  );

  renderCatalog();

  renderDetail(
    fact,
    index >= 0
      ? index
      : 0
  );

  if (
    fact.user &&
    typeof fact.user ===
      "object"
  ) {
    return;
  }

  hydrateFact(
    id,
    index >= 0
      ? index
      : 0
  );
}

function hydrateFact(
  id,
  index
) {
  fetchJson(
    `/facts/${encodeURIComponent(id)}`,
    5000
  )
    .then((full) => {
      if (
        !full?._id ||
        state.selectedId !== id
      ) {
        return;
      }

      const slot =
        state.facts.findIndex(
          (item) =>
            item._id === id
        );

      if (slot >= 0) {
        state.facts[slot] = {
          ...state.facts[slot],
          ...full,
        };
      }

      renderDetail(
        {
          ...state.facts[slot],
        },
        index
      );
    })
    .catch(() => {});
}

async function searchRemote(
  query
) {
  if (
    !/^[a-f\d]{24}$/i.test(
      query
    )
  ) {
    return;
  }

  const existing =
    state.facts.some(
      (fact) =>
        fact._id.toLowerCase() ===
        query.toLowerCase()
    );

  if (existing) {
    return;
  }

  try {
    const result =
      await fetchJson(
        `/facts/${encodeURIComponent(
          query
        )}`,
        10000
      );

    const fact =
      Array.isArray(result)
        ? result[0]
        : result;

    if (!fact?._id) {
      return;
    }

    mergeFacts([fact]);

    applyFilters({
      resetPage: true,
    });

    selectFact(
      fact._id
    );
  } catch {
    // No matching remote record.
  }
}

function showList() {
  state.view =
    "list";

  els.device.dataset.view =
    "list";
}

function moveSelection(
  direction
) {
  if (!state.filtered.length) {
    return;
  }

  let columns = 4;

  if (
    window.innerWidth <= 900
  ) {
    columns = 3;
  }

  if (
    window.innerWidth <= 520
  ) {
    columns = 2;
  }

  let index =
    state.filtered.findIndex(
      (fact) =>
        fact._id ===
        state.selectedId
    );

  if (index < 0) {
    index = 0;
  }

  if (direction === "left") {
    index -= 1;
  }

  if (direction === "right") {
    index += 1;
  }

  if (direction === "up") {
    index -= columns;
  }

  if (direction === "down") {
    index += columns;
  }

  index = Math.max(
    0,
    Math.min(
      state.filtered.length - 1,
      index
    )
  );

  selectFact(
    state.filtered[index]._id
  );
}

async function loadRandom() {
  const pool =
    state.filtered.length
      ? state.filtered
      : state.facts;

  if (pool.length) {
    const fact =
      pool[
        Math.floor(
          Math.random() *
            pool.length
        )
      ];

    selectFact(
      fact._id
    );

    return;
  }

  try {
    els.meta.textContent =
      "Finding a random cat…";

    const result =
      await fetchJson(
        "/facts/random?animal_type=cat",
        60000
      );

    const fact =
      Array.isArray(result)
        ? result[0]
        : result;

    if (!fact?._id) {
      return;
    }

    mergeFacts([fact]);

    applyFilters();

    selectFact(
      fact._id
    );
  } catch (error) {
    els.detail.innerHTML = `
      <div class="error-box">
        ${error.message}
      </div>
    `;
  }
}

els.grid.addEventListener(
  "click",
  (event) => {
    const card =
      event.target.closest(
        "[data-id]"
      );

    if (card) {
      selectFact(
        card.dataset.id
      );
    }
  }
);

els.searchForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    state.query =
      els.searchInput.value;

    applyFilters({
      resetPage: true,
    });

    searchRemote(
      state.query.trim()
    );
  }
);

els.searchInput.addEventListener(
  "input",
  () => {
    state.query =
      els.searchInput.value;

    applyFilters({
      resetPage: true,
    });
  }
);

els.pagePrev.addEventListener(
  "click",
  () => {
    goToPage(
      state.page - 1
    );
  }
);

els.pageNext.addEventListener(
  "click",
  () => {
    goToPage(
      state.page + 1
    );
  }
);

document
  .querySelectorAll(".dpad-btn")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        if (
          button.dataset.dir ===
          "select"
        ) {
          if (
            state.selectedId
          ) {
            selectFact(
              state.selectedId
            );
          }

          return;
        }

        moveSelection(
          button.dataset.dir
        );
      }
    );
  });

document
  .getElementById(
    "btn-random"
  )
  .addEventListener(
    "click",
    loadRandom
  );

document
  .getElementById(
    "dock-random"
  )
  .addEventListener(
    "click",
    loadRandom
  );

document
  .getElementById(
    "btn-back"
  )
  .addEventListener(
    "click",
    showList
  );

els.backBtn.addEventListener(
  "click",
  showList
);

document
  .querySelectorAll(
    "[data-dock]"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        if (
          button.dataset.dock ===
          "catalog"
        ) {
          showList();
        }

        if (
          button.dataset.dock ===
          "about"
        ) {
          state.view =
            "about";

          els.device.dataset.view =
            "about";

          els.detail.innerHTML = `
            <div class="welcome about-page">

              <p class="welcome-kicker">
                About this dex
              </p>

              <h2>
                Catdex 02
              </h2>

              <p>
                An interactive feline encyclopedia
                built using a public API containing
                facts about cats.
              </p>

              <p>
                Each record receives a visual identity
                inside Catdex, including a name, trait,
                code and feline profile.
              </p>

              <p>
                The factual information comes directly
                from the Cat Facts API.
              </p>

            </div>
          `;
        }
      }
    );
  });

window.addEventListener(
  "keydown",
  (event) => {
    const keys = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };

    if (keys[event.key]) {
      event.preventDefault();

      moveSelection(
        keys[event.key]
      );
    }
  }
);

loadCatalog();