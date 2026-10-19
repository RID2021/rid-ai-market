// RID AI MARKET: catalog.json을 읽어 컬렉션 배너·목록·상세·찜·가방(ZIP 받기)을 그린다
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
  { key: "pixel", label: "픽셀아트", sub: null, test: (it) => it.kind === "pixel", bgs: ["bg-lilac", "bg-pink", "bg-mint", "bg-peach"] },
];
const groupOf = (it) => GROUPS.find((g) => g.test(it)) ?? GROUPS[GROUPS.length - 1];

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 동작 */ } },
};
const state = {
  items: [], byId: new Map(), group: "", q: "", sort: "new", favOnly: false, hero: 0,
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

function matches(it) {
  if (state.group && groupOf(it).key !== state.group) return false;
  if (state.favOnly && !state.fav.has(it.id)) return false;
  if (!state.q) return true;
  const hay = [it.name, it.category, it.description, it.id, groupOf(it).label, ...it.tags].join(" ").toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function sorted(list) {
  const out = [...list];
  if (state.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  else if (state.sort === "score") out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  else {
    // 최신순: 일러스트 → 효과 → 픽셀아트, 같은 날짜 안에서는 검수 점수 높은 것부터
    const rank = (it) => (it.kind === "illust" ? 0 : it.kind === "effect" ? 1 : 2);
    out.sort((a, b) => rank(a) - rank(b) || (b.added || "").localeCompare(a.added || "") || (b.score ?? 0) - (a.score ?? 0));
  }
  return out;
}

// ---------- 배너 ----------
function heroCollections() {
  return GROUPS.filter((g) => g.hero).map((g) => {
    const items = state.items.filter(g.test);
    const top = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
    return { g, items, top };
  }).filter((c) => c.items.length >= 3);
}

function renderHero() {
  const cols = heroCollections();
  if (!cols.length) { $("#hero").hidden = true; return; }
  const c = cols[state.hero % cols.length];
  $("#hero-title").textContent = c.g.hero.title;
  $("#hero-sub").textContent = c.g.hero.sub(c.items.length);
  $("#hero-cards").replaceChildren(...c.top.map((it) => el("div", { class: `hc ${bgOf(it)}` }, el("img", { src: it.thumb, alt: "" }))));
  $("#hero-dots").replaceChildren(...cols.map((col, i) =>
    el("button", { type: "button", role: "tab", "aria-selected": String(i === state.hero % cols.length), "aria-label": col.g.hero.title,
      onclick: () => { state.hero = i; renderHero(); } })));
  $("#hero-go").onclick = () => {
    state.group = c.g.key;
    renderChips(); renderGrid();
    $("#cats").scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

// ---------- 칩·목록 ----------
function renderChips() {
  const chips = [{ key: "", label: "전체", n: state.items.length }, ...GROUPS.map((g) => ({ key: g.key, label: g.label, n: state.items.filter(g.test).length }))].filter((c) => c.n);
  $("#cats").replaceChildren(...chips.map((c) =>
    el("button", { class: "chip", type: "button", "aria-pressed": String(state.group === c.key), onclick: () => { state.group = c.key; renderChips(); renderGrid(); } },
      c.label, el("span", { class: "n" }, String(c.n)))));
}

function heartBtn(it, cls = "heart") {
  const b = el("button", { class: cls, type: "button", "aria-pressed": String(state.fav.has(it.id)), "aria-label": `${it.name} 찜하기` }, svg(HEART));
  b.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(it.id); b.setAttribute("aria-pressed", String(state.fav.has(it.id))); });
  return b;
}

function renderGrid() {
  const list = sorted(state.items.filter(matches));
  $("#grid").replaceChildren(...list.map((it) => {
    const inBag = state.bag.has(it.id);
    const plus = el("button", { class: "plus", type: "button", "aria-pressed": String(inBag), "aria-label": inBag ? `${it.name} 가방에서 빼기` : `${it.name} 가방에 담기` }, inBag ? "✓" : "+");
    plus.addEventListener("click", () => { toggleBag(it.id); renderGrid(); });
    return el("article", { class: "card" },
      el("div", { class: "tile-wrap" },
        el("button", { class: `tile ${bgOf(it)} ${it.kind === "pixel" ? "pixelart" : ""}`, type: "button", "aria-label": `${it.name} 자세히 보기`, onclick: () => openDetail(it) },
          el("img", { src: it.thumb ?? it.preview, alt: "", loading: "lazy" })),
        it.gif && it.kind === "illust" ? el("span", { class: "anim" }, "GIF 포함") : null,
        heartBtn(it)),
      el("div", { class: "card-foot" },
        el("div", {}, el("h3", {}, it.name), el("p", { class: "sub" }, subOf(it))),
        plus));
  }));
  $("#empty").hidden = list.length > 0;
  $("#count").textContent = state.favOnly ? `찜한 애셋 ${list.length}개` : `${list.length}개`;
}

// ---------- 찜·가방 ----------
function toggleFav(id) {
  state.fav.has(id) ? state.fav.delete(id) : state.fav.add(id);
  store.set("ridmarket.fav", [...state.fav]);
  if (state.favOnly) renderGrid();
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
  it = { ...it, file: pathOf(it, "file"), gif: pathOf(it, "gif"), preview: pathOf(it, "preview") };
  const name = it.name.replace(/[\\/:*?"<>|]/g, "_");
  if (it.kind === "illust") return [[it.file, `${folder}/${name}.png`], it.gif && [it.gif, `${folder}/${name}.gif`], hires && [it.preview, `${folder}/${name}_고해상도.png`]].filter(Boolean);
  if (it.kind === "effect") return [[it.file, `${folder}/${name}.gif`], hires && [it.preview, `${folder}/${name}_240.gif`]].filter(Boolean);
  return [[it.file, `${folder}/${name}.png`], hires && [it.preview, `${folder}/${name}_확대.png`]].filter(Boolean);
}

function renderBag() {
  const items = [...state.bag].map((id) => state.byId.get(id)).filter(Boolean);
  $("#bag-list").replaceChildren(...items.map((it) => {
    const rm = el("button", { type: "button", "aria-label": `${it.name} 빼기` }, "✕");
    rm.addEventListener("click", () => { toggleBag(it.id); renderBag(); renderGrid(); });
    return el("li", {}, el("img", { src: it.thumb ?? it.preview, alt: "", class: it.kind === "pixel" ? "pix" : "" }),
      el("span", {}, it.name, el("small", {}, groupOf(it).label)), rm);
  }));
  $("#bag-empty").hidden = items.length > 0;
  $("#bag-zip").disabled = items.length === 0;
  $("#bag-status").textContent = "";
}

async function downloadBag() {
  const items = [...state.bag].map((id) => state.byId.get(id)).filter(Boolean);
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

function openDetail(it) {
  const illust = it.kind === "illust", effect = it.kind === "effect";
  $("#d-stage").className = `stage ${bgOf(it)}`;
  $("#d-img").src = effect ? it.preview : illust ? it.thumb ?? it.preview : it.preview;
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
  setLink("#d-png", pathOf(it, "file"), effect ? `${it.id}.gif` : `${it.id}.png`, effect ? "GIF 120×120" : illust ? `PNG ${it.size[0]}×${it.size[1]}` : "원본 PNG");
  setLink("#d-gif", illust ? pathOf(it, "gif") : null, `${it.id}.gif`, "움직이는 GIF");
  setLink("#d-big", pathOf(it, "preview"), effect ? `${it.id}@2x.gif` : illust ? `${it.id}@hi.png` : `${it.id}@${it.previewScale}x.png`,
    effect ? "큰 GIF 240×240" : illust ? `고해상도 ${it.hiresSize[0]}×${it.hiresSize[1]}` : `확대 PNG ${it.previewScale}배`);
  setLink("#d-spec", pathOf(it, "spec"), `${it.id}.json`, "명세 JSON");
  const bagBtn = $("#d-bag");
  const paint = () => {
    const on = state.bag.has(it.id);
    bagBtn.textContent = on ? "✓ 가방에 담김 (누르면 빼기)" : "+ 가방에 담기";
    bagBtn.classList.toggle("on", on);
  };
  bagBtn.onclick = () => { toggleBag(it.id); paint(); renderGrid(); };
  paint();
  history.replaceState(null, "", `#${it.id}`);
  $("#detail").showModal();
}

function setQuery(q) {
  state.q = q;
  $("#q").value = q;
  state.group = "";
  renderChips();
  renderGrid();
}

async function main() {
  // 로그인·승인을 통과해야 목록을 받는다 (auth.js). 관문을 보여 주는 중이면 여기서 멈춘다
  const items = await window.ridLoadCatalog();
  if (!items) return;
  state.items = items;
  state.byId = new Map(state.items.map((it) => [it.id, it]));
  for (const id of [...state.bag]) if (!state.byId.has(id)) state.bag.delete(id);
  renderHero();
  renderChips();
  renderGrid();
  renderBagCount();
  setInterval(() => { if (!document.hidden && !$("#detail").open) { state.hero++; renderHero(); } }, 7000);
  // 화면용 서명 주소는 30분짜리다. 20분이 지났으면 화면에 돌아올 때·그림이 깨질 때·25분마다 새로 받는다
  let signedAt = Date.now(), refreshing = null;
  const refresh = async (force) => {
    if (refreshing || (!force && Date.now() - signedAt < 20 * 60 * 1000)) return;
    refreshing = window.ridRefreshUrls(state.items)
      .then(() => { signedAt = Date.now(); renderHero(); renderGrid(); })
      .catch((e) => console.warn(e))
      .finally(() => { refreshing = null; });
  };
  setInterval(() => refresh(true), 25 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  document.addEventListener("error", (e) => { if (e.target.tagName === "IMG" && Date.now() - signedAt > 60 * 1000) refresh(true); }, true);

  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); renderGrid(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
  $("#fav-toggle").addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    $("#fav-toggle").setAttribute("aria-pressed", String(state.favOnly));
    renderGrid();
  });
  $("#bag-open").addEventListener("click", () => { renderBag(); $("#bag").showModal(); });
  $("#bag-clear").addEventListener("click", () => { state.bag.clear(); store.set("ridmarket.bag", []); renderBagCount(); renderBag(); renderGrid(); });
  $("#bag-zip").addEventListener("click", async () => {
    $("#bag-zip").disabled = true;
    try { await downloadBag(); } catch (e) { $("#bag-status").textContent = `받기 실패: ${e.message}`; }
    $("#bag-zip").disabled = false;
  });
  for (const d of [$("#detail"), $("#bag")]) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  $("#detail").addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
  const hit = state.byId.get(decodeURIComponent(location.hash.slice(1)));
  if (hit) openDetail(hit);
}

main().catch((e) => {
  $("#grid").replaceChildren(el("p", { class: "empty" }, `목록을 불러오지 못했습니다: ${e.message}`));
});
