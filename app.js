// RID AI MARKET: 컬렉션 배너·목록·상세·찜·가방(ZIP 받기)을 그린다
// 목록은 data.js가 60개씩 나눠 받아 온다 (애셋이 수만 개여도 처음 화면은 가볍게). 아래로 내리면 다음 묶음을 받는다
const $ = (s) => document.querySelector(s);

// 종류(칩) 묶음: 일러스트는 스타일별로, 그 밖은 종류별로
const GROUPS = [
  { key: "character", label: "캐릭터", sub: "캐릭터 · AI 생성", test: (it) => it.style === "hangang-npc", bgs: ["bg-peach", "bg-cream", "bg-sky", "bg-pink"],
    hero: { title: "역사 NPC 일러스트 컬렉션", sub: (n) => `AI가 우리 화풍대로 그리고 Claude가 검수한 캐릭터 ${n}종` } },
  { key: "item", label: "아이템", sub: "아이템 · AI 생성", test: (it) => it.style === "museum-item", bgs: ["bg-parch"],
    hero: { title: "유물 아이템 컬렉션", sub: (n) => `고려·삼국시대 유물과 교역품 ${n}종` } },
  { key: "animal", label: "동물", sub: "동물 · AI 생성", test: (it) => it.style === "museum-animal", bgs: ["bg-mint", "bg-cream", "bg-lilac"],
    hero: { title: "전통 문양 동물 컬렉션", sub: (n) => `금빛 문양을 두른 상서로운 동물 ${n}종` } },
  { key: "effect", label: "효과 GIF", sub: "효과 · 움직이는 GIF", test: (it) => it.kind === "effect", bgs: ["bg-night"],
    hero: { title: "움직이는 효과 GIF", sub: (n) => `차원문·반짝임·퀘스트 표시 등 ${n}종` } },
  { key: "sfx", label: "효과음", sub: "효과음 · AI 설계", test: (it) => it.kind === "sfx", bgs: ["bg-lilac", "bg-sky"],
    hero: { title: "바로 쓰는 게임 효과음", sub: (n) => `버튼·획득·마법·이동 등 효과음 ${n}개` } },
  { key: "bgm", label: "BGM", sub: "BGM · AI 작곡", test: (it) => it.kind === "bgm", bgs: ["bg-peach", "bg-cream"],
    hero: { title: "끊김 없이 반복되는 BGM", sub: (n) => `사람 목소리 없는 배경음악 ${n}곡` } },
  { key: "pixel", label: "픽셀아트", sub: null, test: (it) => it.kind === "pixel", bgs: ["bg-lilac", "bg-pink", "bg-mint", "bg-peach"] },
];
const groupOf = (it) => GROUPS.find((g) => g.test(it)) ?? GROUPS[GROUPS.length - 1];

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 동작 */ } },
};
const state = {
  source: null, sign: async (items) => items, // auth.js의 ridStart가 채운다
  items: [], total: null, offset: 0, done: false, seq: 0, // 지금 목록에 받아 둔 애셋 (조건이 바뀌면 처음부터)
  counts: {}, heroCols: [], bagItems: [],
  group: "", q: "", sort: "new", favOnly: false, hero: 0, facets: [], // facets: 고른 세부 분류 ("갈래:이름")
  fav: new Set(store.get("ridmarket.fav")), bag: new Set(store.get("ridmarket.bag")),
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
const svg = (html) => { const s = document.createElement("span"); s.innerHTML = html; return s.firstChild; };
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

function bgOf(it) {
  const g = groupOf(it);
  let h = 0;
  for (const ch of it.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return g.bgs[h % g.bgs.length];
}
const subOf = (it) => groupOf(it).sub ?? `픽셀아트 · ${it.category}`;

// ---------- 배너 ----------
// 묶음마다 검수 점수 상위 3개와 개수만 받는다
async function loadHero() {
  const groups = GROUPS.filter((g) => g.hero && (state.counts[g.key] ?? 0) >= 3);
  const tops = await Promise.all(groups.map((g) => state.source.top(g.key, 3)));
  const cols = groups.map((g, i) => ({ g, n: state.counts[g.key], top: tops[i] }));
  await state.sign(cols.flatMap((c) => c.top));
  state.heroCols = cols;
}

function renderHero() {
  const cols = state.heroCols;
  if (!cols.length) { $("#hero").hidden = true; return; }
  $("#hero").hidden = false;
  const c = cols[state.hero % cols.length];
  $("#hero-title").textContent = c.g.hero.title;
  $("#hero-sub").textContent = c.g.hero.sub(c.n);
  $("#hero-cards").replaceChildren(...c.top.map((it) => el("div", { class: `hc ${bgOf(it)}` }, el("img", { src: it.thumb, alt: "" }))));
  $("#hero-dots").replaceChildren(...cols.map((col, i) =>
    el("button", { type: "button", role: "tab", "aria-selected": String(i === state.hero % cols.length), "aria-label": col.g.hero.title,
      onclick: () => { state.hero = i; renderHero(); } })));
  $("#hero-go").onclick = () => {
    setGroup(c.g.key);
    $("#cats").scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

// ---------- 칩·목록 ----------
function renderChips() {
  const chips = [{ key: "", label: "전체" }, ...GROUPS].map((g) => ({ key: g.key, label: g.label, n: state.counts[g.key] ?? 0 })).filter((c) => c.n);
  $("#cats").replaceChildren(...chips.map((c) =>
    el("button", { class: "chip", type: "button", "aria-pressed": String(state.group === c.key), onclick: () => setGroup(c.key) },
      c.label, el("span", { class: "n" }, String(c.n)))));
}

// 묶음(칩)을 바꾼다: 세부 분류는 비우고, BGM·효과음이면 세부 분류 칩을 보여 준다
function setGroup(key) {
  state.group = key;
  state.facets = [];
  renderChips();
  renderFacets();
  resetGrid();
}

const facetCache = new Map();
let facetSeq = 0;
async function renderFacets() {
  const box = $("#facets"), group = state.group, my = ++facetSeq;
  const order = window.RidData.FACET_ORDER[group];
  if (!order) { box.hidden = true; box.replaceChildren(); return; }
  let list = facetCache.get(group);
  if (!list) {
    box.hidden = true; box.replaceChildren(); // 받는 동안 이전 묶음의 칩을 누르지 않게
    try { list = await state.source.facets(group); if (list.length) facetCache.set(group, list); } catch (e) { console.warn(e); list = []; }
  }
  if (my !== facetSeq || state.group !== group) return; // 그사이 다른 칩을 눌렀다
  const rows = order.map((g) => [g, list.filter((f) => f.facet.startsWith(`${g}:`))]).filter(([, fs]) => fs.length > 1 || (fs.length === 1 && g !== "박자"));
  box.hidden = rows.length === 0;
  box.replaceChildren(
    ...rows.map(([g, fs]) => el("div", { class: "facet-row" },
      el("span", { class: "facet-label" }, g),
      el("div", { class: "facet-chips" }, ...fs.map(({ facet, count }) =>
        el("button", { class: "chip", type: "button", "aria-pressed": String(state.facets.includes(facet)), onclick: () => toggleFacet(facet) },
          facet.slice(g.length + 1), el("span", { class: "n" }, String(count))))))),
    state.facets.length ? el("button", { class: "facet-clear", type: "button", onclick: () => { state.facets = []; renderFacets(); resetGrid(); } }, "세부 분류 모두 지우기") : null,
  );
}

// 같은 갈래에서는 하나만, 다른 갈래끼리는 함께 고를 수 있다 (모두 만족하는 것만 보여 준다)
function toggleFacet(facet) {
  const g = facet.split(":")[0];
  if (!window.RidData.FACET_ORDER[state.group]?.includes(g)) return; // 다른 묶음의 분류는 무시
  state.facets = state.facets.includes(facet) ? state.facets.filter((f) => f !== facet) : [...state.facets.filter((f) => !f.startsWith(`${g}:`)), facet];
  renderFacets();
  resetGrid();
}

function heartBtn(it, cls = "heart") {
  const b = el("button", { class: cls, type: "button", "aria-pressed": String(state.fav.has(it.id)), "aria-label": `${it.name} 찜하기` }, svg(HEART));
  b.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(it.id); b.setAttribute("aria-pressed", String(state.fav.has(it.id))); });
  return b;
}

function paintPlus(plus, it) {
  const inBag = state.bag.has(it.id);
  plus.setAttribute("aria-pressed", String(inBag));
  plus.setAttribute("aria-label", inBag ? `${it.name} 가방에서 빼기` : `${it.name} 가방에 담기`);
  plus.textContent = inBag ? "✓" : "+";
}

const isAudio = (it) => it.kind === "sfx" || it.kind === "bgm";
const mmss = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const audioLabel = (it) => (it.kind === "bgm" ? `${mmss(it.seconds ?? 0)} 반복` : `${it.seconds ?? "?"}초`);

// 카드 미리 듣기: 화면 전체에서 소리 하나만 재생한다
const player = new Audio();
let playingId = null;
function paintPlayButtons() {
  for (const b of document.querySelectorAll(".play")) {
    const on = b.dataset.id === playingId && !player.paused;
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "■" : "▶";
  }
}
for (const ev of ["play", "pause", "ended"]) player.addEventListener(ev, paintPlayButtons);
// 재생 실패(주소 만료 등): 버튼을 되돌리고 주소를 새로 받는다
player.addEventListener("error", () => { playingId = null; paintPlayButtons(); window.ridRefreshSoon?.(); });
function togglePlay(it) {
  if (playingId === it.id && !player.paused) { player.pause(); return; }
  $("#d-audio").pause();
  player.src = it.preview;
  player.loop = it.kind === "bgm";
  playingId = it.id;
  player.play().catch((e) => console.warn("재생하지 못했습니다", e));
}

function card(it) {
  const plus = el("button", { class: "plus", type: "button" });
  paintPlus(plus, it);
  plus.addEventListener("click", () => { toggleBag(it.id); paintPlus(plus, it); });
  const audio = isAudio(it);
  const badge = audio ? audioLabel(it) : it.gif && it.kind === "illust" ? (it.motion ? `GIF · ${it.motion}` : "GIF 포함") : null;
  const play = audio ? el("button", { class: "play", type: "button", "data-id": it.id, "aria-label": `${it.name} 미리 듣기`, "aria-pressed": "false" }, "▶") : null;
  if (play) play.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(it); });
  return el("article", { class: "card", "data-id": it.id },
    el("div", { class: "tile-wrap" },
      el("button", { class: `tile ${bgOf(it)} ${it.kind === "pixel" ? "pixelart" : ""} ${audio ? "audio" : ""}`, type: "button", "aria-label": `${it.name} 자세히 보기`, onclick: () => openDetail(it) },
        el("img", { src: it.thumb ?? it.preview, alt: "", loading: "lazy" })),
      badge ? el("span", { class: "anim" }, badge) : null,
      play,
      heartBtn(it)),
    el("div", { class: "card-foot" },
      el("div", {}, el("h3", {}, it.name), el("p", { class: "sub" }, subOf(it))),
      plus));
}

// 가방 표시(+/✓)만 다시 칠한다 (목록을 다시 받지 않는다)
function refreshBagMarks() {
  for (const node of $("#grid").querySelectorAll(".card")) {
    const it = state.items.find((x) => x.id === node.dataset.id);
    if (it) paintPlus(node.querySelector(".plus"), it);
  }
}

function renderCount() {
  const n = state.total ?? 0;
  $("#count").textContent = state.total == null ? "" : state.favOnly ? `찜한 애셋 ${n}개` : `${n}개`;
  $("#empty").hidden = state.total == null || n > 0;
  const more = $("#more");
  more.textContent = state.error ? `${state.error} (누르면 다시 시도)` : state.done ? "" : "불러오는 중…";
}

// 지금 받아 둔 목록을 다시 그린다 (서명 주소를 새로 받았을 때)
function rerenderGrid() {
  $("#grid").replaceChildren(...state.items.map(card));
  paintPlayButtons();
  renderCount();
}

// 조건(묶음·검색·정렬·찜)이 바뀌면 처음부터 다시 받는다
let favSource = null, favAll = null;
function resetGrid() {
  player.pause(); // 목록을 새로 그리면 재생 중이던 카드가 사라질 수 있어 미리 듣기를 멈춘다
  state.seq++;
  state.items = []; state.offset = 0; state.done = false; state.total = null; state.error = "";
  favSource = null; favAll = null;
  $("#grid").replaceChildren();
  renderCount();
  loadMore();
}

let loading = null;
async function loadMore() {
  if (state.done || (loading && loading.seq === state.seq)) return;
  const token = { seq: state.seq };
  loading = token;
  const opts = { group: state.group, q: state.q, sort: state.sort, offset: state.offset, limit: window.RidData.PAGE, facets: state.facets };
  try {
    let page;
    if (state.favOnly) {
      // 찜 목록: 찜한 애셋만 id로 받아 같은 규칙으로 거르고 정렬한다
      favAll ??= await state.source.byIds([...state.fav]);
      favSource ??= window.RidData.localSource(favAll.filter((it) => state.fav.has(it.id)));
      page = await favSource.page(opts);
    } else page = await state.source.page(opts);
    if (token.seq !== state.seq) return; // 그사이 조건이 바뀌었다 (버릴 것은 서명하지 않는다)
    await state.sign(page.items);
    if (token.seq !== state.seq) return;
    // 보는 사이 애셋이 늘어 같은 애셋이 다음 묶음에 또 오면 한 번만 그린다
    const seen = new Set(state.items.map((it) => it.id));
    const fresh = page.items.filter((it) => !seen.has(it.id));
    state.items.push(...fresh);
    state.offset += page.items.length;
    if (page.total != null) state.total = page.total;
    state.done = page.items.length < opts.limit || state.offset >= (state.total ?? Infinity);
    $("#grid").append(...fresh.map(card));
  } catch (e) {
    if (token.seq === state.seq) { state.error = `목록을 불러오지 못했습니다: ${e.message}`; state.done = true; }
  } finally {
    if (loading === token) loading = null;
    if (token.seq === state.seq) {
      renderCount();
      // 화면이 아직 덜 찼으면 이어서 받는다
      if (!state.done && $("#more").getBoundingClientRect().top < innerHeight + 600) loadMore();
    }
  }
}

// ---------- 찜·가방 ----------
function toggleFav(id) {
  state.fav.has(id) ? state.fav.delete(id) : state.fav.add(id);
  store.set("ridmarket.fav", [...state.fav]);
  if (state.favOnly && !state.fav.has(id)) removeFromFavList(id);
}

// 찜 목록을 보는 중에 찜을 풀면 그 카드만 빼고 보던 자리는 그대로 둔다
function removeFromFavList(id) {
  const node = $("#grid").querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (node) node.remove();
  const before = state.items.length;
  state.items = state.items.filter((it) => it.id !== id);
  if (state.items.length < before) { state.offset--; if (state.total != null) state.total--; }
  if (favAll) favSource = window.RidData.localSource(favAll.filter((it) => state.fav.has(it.id)));
  renderCount();
}
function toggleBag(id) {
  state.bag.has(id) ? state.bag.delete(id) : state.bag.add(id);
  store.set("ridmarket.bag", [...state.bag]);
  renderBagCount();
}
function renderBagCount() {
  $("#bag-count").hidden = state.bag.size === 0;
  $("#bag-count").textContent = String(state.bag.size);
}

// 받을 파일의 저장소 경로 (서명 주소가 아니라 원래 경로. 로컬 개발에서는 src가 없어 그대로 쓴다)
const pathOf = (it, f) => (it.src ? it.src[f] : it[f]);

function filesOf(it, hires) {
  const folder = groupOf(it).label;
  it = { ...it, file: pathOf(it, "file"), gif: pathOf(it, "gif"), preview: pathOf(it, "preview"), midi: pathOf(it, "midi") };
  const name = it.name.replace(/[\\/:*?"<>|]/g, "_");
  if (isAudio(it)) return [[it.file, `${folder}/${name}.mp3`], hires && it.midi && [it.midi, `${folder}/${name}.mid`]].filter(Boolean);
  if (it.kind === "illust") return [[it.file, `${folder}/${name}.png`], it.gif && [it.gif, `${folder}/${name}.gif`], hires && [it.preview, `${folder}/${name}_고해상도.png`]].filter(Boolean);
  if (it.kind === "effect") return [[it.file, `${folder}/${name}.gif`], hires && [it.preview, `${folder}/${name}_240.gif`]].filter(Boolean);
  return [[it.file, `${folder}/${name}.png`], hires && [it.preview, `${folder}/${name}_확대.png`]].filter(Boolean);
}

// 가방에 담은 애셋을 id로 받아 서명한다 (목록에 없던 것도 받을 수 있게)
async function loadBagItems() {
  const items = await state.source.byIds([...state.bag]);
  await state.sign(items);
  const byId = new Map(items.map((it) => [it.id, it]));
  state.bagItems = [...state.bag].map((id) => byId.get(id)).filter(Boolean);
  return state.bagItems;
}

async function renderBag(reload = true) {
  if (reload) {
    $("#bag-zip").disabled = true; // 다 받기 전에는 ZIP을 받지 않는다
    $("#bag-status").textContent = "가방을 불러오는 중…";
    try { await loadBagItems(); } catch (e) { $("#bag-status").textContent = `가방을 불러오지 못했습니다: ${e.message}`; return; }
  }
  const items = state.bagItems.filter((it) => state.bag.has(it.id));
  $("#bag-list").replaceChildren(...items.map((it) => {
    const rm = el("button", { type: "button", "aria-label": `${it.name} 빼기` }, "✕");
    rm.addEventListener("click", () => { toggleBag(it.id); renderBag(false); refreshBagMarks(); });
    return el("li", {}, el("img", { src: it.thumb ?? it.preview, alt: "", class: it.kind === "pixel" ? "pix" : "" }),
      el("span", {}, it.name, el("small", {}, groupOf(it).label)), rm);
  }));
  $("#bag-empty").hidden = items.length > 0;
  $("#bag-zip").disabled = items.length === 0;
  $("#bag-status").textContent = "";
}

async function downloadBag() {
  const items = state.bagItems.filter((it) => state.bag.has(it.id));
  const pairs = items.flatMap((it) => filesOf(it, $("#bag-hires").checked));
  const files = [];
  for (const [i, [src, name]] of pairs.entries()) {
    $("#bag-status").textContent = `파일 모으는 중… ${i + 1}/${pairs.length}`;
    const blob = await window.ridBlob(src); // 로그인·승인을 다시 확인하며 받는다 (auth.js)
    files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const url = URL.createObjectURL(window.makeZip(files));
  const a = el("a", { href: url, download: `RID_AI_MARKET_${items.length}개.zip` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("#bag-status").textContent = `애셋 ${items.length}개(파일 ${files.length}개)를 ZIP으로 받았습니다.`;
}

// ---------- 상세 ----------
function sizeLabel(it) {
  if (it.kind === "sfx") return `MP3 · ${it.seconds}초 · 효과음`;
  if (it.kind === "bgm") return `MP3 · ${mmss(it.seconds ?? 0)} · 끊김 없이 반복${it.bpm ? ` · ${it.bpm}bpm` : ""}`;
  const [w, h] = it.size;
  if (it.kind === "illust") return `ZEP용 ${w}×${h}px${it.gif ? " · GIF 120×120" : ""} · 고해상도 ${it.hiresSize[0]}×${it.hiresSize[1]}px`;
  if (it.kind === "effect") return `GIF ${w}×${h}px · 큰 GIF ${it.hiresSize[0]}×${it.hiresSize[1]}px`;
  return `${w}×${h}px · ${it.tiles[0]}×${it.tiles[1]}칸 (32px 타일)`;
}

// 상세 창 받기 버튼: 클릭할 때 파일을 직접 받아 이름을 붙여 저장한다
function setLink(id, path, download, text) {
  const a = $(id);
  a.hidden = !path;
  delete a.dataset.busy;
  if (!path) return;
  a.href = "#";
  a.removeAttribute("download");
  a.textContent = text;
  const handler = async (e) => {
    e.preventDefault();
    if (a.dataset.busy) return;
    a.dataset.busy = "1";
    a.textContent = "받는 중…";
    try {
      const url = URL.createObjectURL(await window.ridBlob(path));
      const tmp = el("a", { href: url, download });
      document.body.append(tmp); tmp.click(); tmp.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      alert(`받지 못했습니다: ${err.message}`);
    } finally {
      // 그사이 다른 애셋을 열었으면 그 버튼 글자를 건드리지 않는다
      if (a.onclick === handler) { delete a.dataset.busy; a.textContent = text; }
    }
  };
  a.onclick = handler;
}

let detailItem = null, detailRetried = false;
// 상세 창 재생기 주소가 만료됐으면 그 애셋만 다시 서명해 주소를 바꾼다 (한 번만. 파일 자체가 없으면 되풀이하지 않게)
function retryDetailAudio() {
  const it = detailItem;
  if (!it || !isAudio(it) || !$("#detail").open || detailRetried) return;
  detailRetried = true;
  state.sign([it]).then(() => { if (detailItem === it) $("#d-audio").src = it.preview; }).catch((e) => console.warn(e));
}

function openDetail(it) {
  const illust = it.kind === "illust", effect = it.kind === "effect", audio = isAudio(it);
  $("#d-stage").className = `stage ${bgOf(it)} ${audio ? "audio" : ""}`;
  $("#d-img").src = effect ? it.preview : illust || audio ? it.thumb ?? it.preview : it.preview;
  player.pause();
  const da = $("#d-audio");
  da.pause();
  da.hidden = !audio;
  detailItem = it; detailRetried = false;
  if (audio) { da.src = it.preview; da.loop = it.kind === "bgm"; } else da.removeAttribute("src");
  $("#d-img").className = it.kind === "pixel" ? "pix" : "";
  $("#d-img").alt = it.name;
  $("#d-cat").textContent = subOf(it);
  $("#d-name").textContent = it.name;
  $("#d-desc").textContent = it.description;
  $("#d-motion").hidden = !(illust && it.gif);
  if (illust && it.gif) $("#d-gifimg").src = it.gif;
  $("#d-size").textContent = sizeLabel(it);
  $("#d-ref").textContent = it.reference || "-";
  $("#d-gen").textContent = it.score != null ? `${it.generator} · ${it.score}점` : it.generator;
  $("#d-tags").replaceChildren(...it.tags.map((t) => el("button", { class: "tag", type: "button", onclick: () => { $("#detail").close(); setQuery(t); } }, `#${t}`)));
  if (audio) {
    setLink("#d-png", pathOf(it, "file"), `${it.id}.mp3`, "MP3 받기");
    setLink("#d-gif", null);
    setLink("#d-big", pathOf(it, "midi"), `${it.id}.mid`, "미디 원본(.mid)");
    setLink("#d-spec", null);
  } else {
    setLink("#d-png", pathOf(it, "file"), effect ? `${it.id}.gif` : `${it.id}.png`, effect ? "GIF 120×120" : illust ? `PNG ${it.size[0]}×${it.size[1]}` : "원본 PNG");
    setLink("#d-gif", illust ? pathOf(it, "gif") : null, `${it.id}.gif`, "움직이는 GIF");
    setLink("#d-big", pathOf(it, "preview"), effect ? `${it.id}@2x.gif` : illust ? `${it.id}@hi.png` : `${it.id}@${it.previewScale}x.png`,
      effect ? "큰 GIF 240×240" : illust ? `고해상도 ${it.hiresSize[0]}×${it.hiresSize[1]}` : `확대 PNG ${it.previewScale}배`);
    setLink("#d-spec", pathOf(it, "spec"), `${it.id}.json`, "명세 JSON");
  }
  const bagBtn = $("#d-bag");
  const paint = () => {
    const on = state.bag.has(it.id);
    bagBtn.textContent = on ? "✓ 가방에 담김 (누르면 빼기)" : "+ 가방에 담기";
    bagBtn.classList.toggle("on", on);
  };
  bagBtn.onclick = () => { toggleBag(it.id); paint(); refreshBagMarks(); };
  paint();
  history.replaceState(null, "", `#${it.id}`);
  $("#detail").showModal();
}

function setQuery(q) {
  state.q = q;
  $("#q").value = q;
  setGroup("");
}

async function main() {
  // 게시 직후 캐시에 예전 auth.js가 남아 있으면 새 화면과 맞지 않는다
  if (typeof window.ridStart !== "function") throw new Error("사이트가 막 갱신됐습니다. 잠시 후 새로고침해 주세요");
  // 로그인·승인을 통과해야 목록 창구를 받는다 (auth.js). 관문을 보여 주는 중이면 여기서 멈춘다
  const started = await window.ridStart();
  if (!started) return;
  state.source = started.source;
  state.sign = started.sign;
  $("#grid").after(el("p", { id: "more", class: "empty more", "aria-live": "polite" }));
  // 이어 받다가 실패했으면 눌러서 다시 시도한다
  $("#more").addEventListener("click", () => { if (state.error) { state.error = ""; state.done = false; loadMore(); } });

  state.counts = await state.source.counts();
  renderChips();
  resetGrid();
  // 아래로 내려 끝에 가까워지면 다음 묶음을 받는다 (첫 묶음을 두 번 받지 않게 resetGrid 다음에 건다)
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "600px" }).observe($("#more"));
  loadHero().then(renderHero).catch((e) => console.warn(e));
  // 가방: 없어진 애셋은 뺀다 (물어본 id 가운데 답이 없는 것만. 그사이 새로 담은 것은 건드리지 않는다)
  if (state.bag.size) {
    const asked = new Set(state.bag);
    loadBagItems().then((items) => {
      const have = new Set(items.map((it) => it.id));
      for (const id of asked) if (!have.has(id)) state.bag.delete(id);
      store.set("ridmarket.bag", [...state.bag]);
      renderBagCount();
      refreshBagMarks();
    }).catch((e) => console.warn(e));
  }
  renderBagCount();
  setInterval(() => { if (!document.hidden && !$("#detail").open) { state.hero++; renderHero(); } }, 7000);
  // 화면용 서명 주소는 최대 40분짜리다. 20분이 지났으면 화면에 돌아올 때·그림이 깨질 때·25분마다 지금 화면에 있는 것만 새로 받는다
  let signedAt = Date.now(), refreshing = null;
  const refresh = async (force) => {
    if (refreshing || (!force && Date.now() - signedAt < 20 * 60 * 1000)) return;
    refreshing = state.sign([...state.items, ...state.heroCols.flatMap((c) => c.top), ...state.bagItems])
      .then(() => { signedAt = Date.now(); renderHero(); rerenderGrid(); if ($("#bag").open) renderBag(false); })
      .catch((e) => console.warn(e))
      .finally(() => { refreshing = null; });
  };
  setInterval(() => refresh(true), 25 * 60 * 1000);
  window.ridRefreshSoon = () => { if (Date.now() - signedAt > 60 * 1000) refresh(true); };
  $("#d-audio").addEventListener("error", retryDetailAudio);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  document.addEventListener("error", (e) => { if (e.target.tagName === "IMG" && Date.now() - signedAt > 60 * 1000) refresh(true); }, true);

  // 검색은 입력을 잠깐 멈췄을 때 서버에 묻는다
  let typing = null;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => { const q = e.target.value.trim(); if (q !== state.q) { state.q = q; resetGrid(); } }, 250);
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; resetGrid(); });
  $("#fav-toggle").addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    $("#fav-toggle").setAttribute("aria-pressed", String(state.favOnly));
    resetGrid();
  });
  $("#bag-open").addEventListener("click", () => { $("#bag").showModal(); renderBag(); });
  $("#bag-clear").addEventListener("click", () => { state.bag.clear(); store.set("ridmarket.bag", []); renderBagCount(); renderBag(false); refreshBagMarks(); });
  $("#bag-zip").addEventListener("click", async () => {
    $("#bag-zip").disabled = true;
    try { await downloadBag(); } catch (e) { $("#bag-status").textContent = `받기 실패: ${e.message}`; }
    $("#bag-zip").disabled = false;
  });
  for (const d of [$("#detail"), $("#bag")]) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  $("#detail").addEventListener("close", () => { $("#d-audio").pause(); history.replaceState(null, "", location.pathname + location.search); });
  // 주소에 #애셋id가 있으면 그 애셋을 받아 바로 연다 (실패해도 목록은 그대로 둔다)
  try {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) {
      const [hit] = await state.source.byIds([id]);
      if (hit) { await state.sign([hit]); openDetail(hit); }
    }
  } catch (e) { console.warn("바로가기 주소를 열지 못했습니다", e); }
}

main().catch((e) => {
  // 목록 끝 표시가 있으면 거기에, 없으면(시작 전에 실패) 목록 자리에 알린다
  const msg = `목록을 불러오지 못했습니다: ${e.message}`;
  if ($("#more")) { state.error = msg; state.done = true; renderCount(); }
  else $("#grid").replaceChildren(el("p", { class: "empty" }, msg));
});
