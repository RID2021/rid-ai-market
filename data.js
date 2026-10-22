// 스토어 목록 데이터: 필요한 만큼만 나눠 받는다 (애셋이 수만 개여도 처음 화면은 60개만)
//   serverSource: Supabase assets 테이블에서 묶음·검색·정렬을 서버가 처리하고 range로 잘라 받는다
//   localSource : 로컬 개발용 catalog.json을 같은 규칙으로 메모리에서 처리한다 (둘의 결과가 같아야 한다 — scripts/data.test.mjs)
// 브라우저에서는 window.RidData, Node 시험에서는 globalThis.RidData로 쓴다
(function (root) {
  const PAGE = 60;
  const TOP_N = 3; // 배너에 쓰는 묶음별 상위 개수 (동기화가 메타 행에 이만큼 넣는다)
  // 칩 묶음 → 서버 조건 [필드, 값]
  const GROUP_WHERE = {
    character: ["style", "hangang-npc"],
    item: ["style", "museum-item"],
    animal: ["style", "museum-animal"],
    effect: ["kind", "effect"],
    map: ["kind", "map"],
    sign: ["kind", "sign"],
    sfx: ["kind", "sfx"],
    bgm: ["kind", "bgm"],
    pixel: ["kind", "pixel"],
  };
  const SEARCH_FIELDS = ["name", "description", "tags", "category", "facetText"];
  // 세부 분류 갈래 순서 (scripts/audio/facets.mjs의 FACET_ORDER와 같아야 한다 — 시험이 확인)
  const FACET_ORDER = {
    bgm: ["장르", "편성", "분위기", "빠르기", "음역", "악기", "악기 수", "쓰임새", "조성", "박자", "드럼"],
    sfx: ["종류", "길이", "소리"],
    sign: ["방향", "색", "쓰임새", "글자 수"],
    effect: ["갈래", "색"],
    map: ["구성", "장소", "틀", "하늘", "색감"],
  };
  // 세부 분류 개수를 담은 특별한 행 (애셋이 아니다. 목록·개수에서 뺀다)
  const META_ID = "__facets__";
  // 묶음 이름으로도 찾는다 (예: '캐릭터'로 찾으면 역사 NPC 전부). app.js 칩 이름과 같게
  const GROUP_LABEL = { character: "캐릭터", item: "아이템", animal: "동물", effect: "효과 gif", map: "맵 배경 틀 오브젝트", sign: "안내 글자 표지판 텍스트 글씨", sfx: "효과음 사운드", bgm: "bgm 배경음악 음악", pixel: "픽셀아트" };
  const labelGroups = (w) => Object.keys(GROUP_LABEL).filter((g) => GROUP_LABEL[g].includes(w));

  // 검색어 → 낱말. 서버 필터 문법·LIKE 와일드카드에 쓰이는 기호는 띄어쓰기로 바꿔 나눈다
  // ('무기·갑옷' → 무기, 갑옷 / '해동청(고려의 매)' → 해동청, 고려의, 매). 낱말이 모두 들어 있어야 찾는다
  function words(q) {
    return String(q || "").normalize("NFKC").toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}-]+/gu, " ")
      .split(/\s+/).filter(Boolean).slice(0, 6);
  }

  // ---------- 서버 (Supabase) ----------
  function serverSource(sb) {
    function filtered(query, { group, q, facets = [] }) {
      if (group && GROUP_WHERE[group]) query = query.eq(`data->>${GROUP_WHERE[group][0]}`, GROUP_WHERE[group][1]);
      else query = query.neq("id", META_ID);
      // 세부 분류: 고른 것을 모두 가진 애셋만 (jsonb 포함 검사)
      if (facets.length) query = query.contains("data->facets", JSON.stringify(facets));
      for (const w of words(q)) {
        query = query.or([
          ...SEARCH_FIELDS.map((f) => `data->>${f}.ilike.*${w}*`), `id.ilike.*${w}*`,
          ...labelGroups(w).map((g) => `data->>${GROUP_WHERE[g][0]}.eq.${GROUP_WHERE[g][1]}`),
        ].join(","));
      }
      return query;
    }
    function sorted(query, sort) {
      if (sort === "name") return query.order("data->>name", { ascending: true }).order("id");
      if (sort === "score") return query.order("data->score", { ascending: false, nullsFirst: false }).order("id");
      // 최신순: 등록 날짜 내림차순(날짜 없는 효과 GIF는 끝), 같은 날짜 안에서는 검수 점수 높은 것부터
      return query.order("data->>added", { ascending: false, nullsFirst: false })
        .order("data->score", { ascending: false, nullsFirst: false }).order("id");
    }
    const fail = (what, error) => new Error(`${what}을 받지 못했습니다: ${error.message}`);
    // 메타 행의 칩 개수·배너·세부 분류를 한 번만 받아 같이 쓴다 (추천 검색어는 커서 따로 받는다)
    //   예전에는 첫 화면마다 개수 9번·배너 4번을 서버가 1만여 행을 훑어 계산했다 (2026-10-21 시간 초과로 목록이 안 떴다)
    let metaP = null;
    const meta = () => (metaP ??= Promise.resolve(sb.from("assets").select("counts:data->counts,top:data->top,facets:data->facets").eq("id", META_ID).maybeSingle())
      .then(({ data, error }) => { if (error) throw error; return data ?? {}; })
      .catch((e) => { metaP = null; throw e; }));
    return {
      async page({ group = "", q = "", sort = "new", offset = 0, limit = PAGE, facets = [] } = {}) {
        // 전체 개수는 첫 묶음에서만 센다 (수만 행에서 묶음마다 전체를 다시 세지 않게). 다음 묶음은 total: null
        const { data, error, count } = await sorted(filtered(sb.from("assets").select("data", offset === 0 ? { count: "exact" } : {}), { group, q, facets }), sort)
          .range(offset, offset + limit - 1);
        // 결과보다 뒤쪽을 달라고 하면 서버가 '범위 없음'(416)으로 답한다 (보는 사이 애셋이 줄어든 경우) → 빈 묶음
        if (error && (error.code === "PGRST103" || /range not satisfiable/i.test(error.message))) {
          const { count: n, error: e2 } = await filtered(sb.from("assets").select("id", { count: "exact", head: true }), { group, q, facets });
          if (e2) throw fail("목록", e2);
          return { items: [], total: n ?? 0 };
        }
        if (error) throw fail("목록", error);
        return { items: data.map((r) => r.data), total: offset === 0 ? count ?? data.length : null };
      },
      // 칩 옆 숫자: { "": 전체, character: n, ... } (동기화가 메타 행에 넣어 둔 값. 없으면 서버가 센다)
      async counts() {
        const keys = ["", ...Object.keys(GROUP_WHERE)];
        const m = await meta().catch((e) => { throw fail("개수", e); });
        // jsonb는 키 순서를 바꿔 저장하므로 순서를 다시 맞춘다
        if (m.counts) return Object.fromEntries(keys.map((k) => [k, m.counts[k] ?? 0]));
        const nums = await Promise.all(keys.map(async (g) => {
          const { count, error } = await filtered(sb.from("assets").select("id", { count: "exact", head: true }), { group: g });
          if (error) throw fail("개수", error);
          return count ?? 0;
        }));
        return Object.fromEntries(keys.map((k, i) => [k, nums[i]]));
      },
      // 배너: 묶음마다 검수 점수 상위 n개 (메타 행에 TOP_N개까지 있다. 없거나 더 달라면 서버가 정렬한다)
      async top(group, n = 3) {
        const m = await meta().catch((e) => { throw fail("배너", e); });
        if (m.top?.[group] && n <= TOP_N) return m.top[group].slice(0, n);
        const { data, error } = await filtered(sb.from("assets").select("data"), { group })
          .order("data->score", { ascending: false, nullsFirst: false }).order("id").limit(n);
        if (error) throw fail("배너", error);
        return data.map((r) => r.data);
      },
      // 세부 분류 칩과 개수: [{ facet: "장르:국악", count }] (동기화가 계산해 둔 특별한 행)
      async facets(group) {
        const m = await meta().catch((e) => { throw fail("세부 분류", e); });
        return m.facets?.[group] ?? [];
      },
      // 추천 검색어 목록 [[낱말, 애셋 수, 묶음]] (같은 특별한 행의 suggest. 검색창을 처음 누를 때 한 번 받는다)
      async suggestions() {
        const { data, error } = await sb.from("assets").select("suggest:data->suggest").eq("id", META_ID).maybeSingle();
        if (error) throw fail("추천 검색어", error);
        return data?.suggest ?? [];
      },
      // 찜·가방·바로가기 주소: id로 받는다 (주소가 너무 길어지지 않게 100개씩)
      async byIds(ids) {
        const out = [];
        ids = ids.filter((id) => id !== META_ID);
        for (let i = 0; i < ids.length; i += 100) {
          const { data, error } = await sb.from("assets").select("data").in("id", ids.slice(i, i + 100));
          if (error) throw fail("애셋", error);
          out.push(...data.map((r) => r.data));
        }
        return out;
      },
    };
  }

  // ---------- 로컬 (catalog.json) — 서버와 같은 규칙 ----------
  const groupMatch = (it, group) => !group || (GROUP_WHERE[group] && it[GROUP_WHERE[group][0]] === GROUP_WHERE[group][1]);
  // 서버의 jsonb·문자열 정렬과 같은 결과가 나오도록 단순 비교(코드 순서)를 쓴다
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const scoreDesc = (a, b) => (a.score == null) - (b.score == null) || (b.score ?? 0) - (a.score ?? 0);
  function localCompare(sort) {
    if (sort === "name") return (a, b) => cmp(a.name, b.name) || cmp(a.id, b.id);
    if (sort === "score") return (a, b) => scoreDesc(a, b) || cmp(a.id, b.id);
    return (a, b) => cmp(b.added || "", a.added || "") || scoreDesc(a, b) || cmp(a.id, b.id);
  }
  function localMatch(it, { group, q, facets = [] }) {
    if (!groupMatch(it, group)) return false;
    if (facets.length && !facets.every((f) => (it.facets ?? []).includes(f))) return false;
    const ws = words(q);
    if (!ws.length) return true;
    const fields = [it.name, it.description, JSON.stringify(it.tags ?? []), it.category, it.facetText, it.id].map((s) => String(s ?? "").toLowerCase());
    return ws.every((w) => fields.some((f) => f.includes(w)) || labelGroups(w).some((g) => groupMatch(it, g)));
  }
  function localSource(all) {
    const byId = new Map(all.map((it) => [it.id, it]));
    return {
      async page({ group = "", q = "", sort = "new", offset = 0, limit = PAGE, facets = [] } = {}) {
        const list = all.filter((it) => localMatch(it, { group, q, facets })).sort(localCompare(sort));
        return { items: list.slice(offset, offset + limit), total: list.length };
      },
      async counts() { return countsOf(all); },
      async top(group, n = 3) { return topOf(all, group, n); },
      async byIds(ids) { return ids.map((id) => byId.get(id)).filter(Boolean); },
      async facets(group) { return facetCounts(all)[group] ?? []; },
      async suggestions() { return suggestTerms(all); },
    };
  }

  // 칩 개수와 배너(점수 상위). 로컬 창구가 쓰고, 동기화가 같은 함수로 메타 행에 넣는다 (groupSummary)
  const countsOf = (all) => Object.fromEntries(["", ...Object.keys(GROUP_WHERE)].map((g) => [g, all.filter((it) => groupMatch(it, g)).length]));
  const topOf = (all, group, n) => all.filter((it) => groupMatch(it, group)).sort((a, b) => scoreDesc(a, b) || cmp(a.id, b.id)).slice(0, n);
  function groupSummary(items) {
    const all = items.filter((it) => it.id !== META_ID);
    return { counts: countsOf(all), top: Object.fromEntries(Object.keys(GROUP_WHERE).map((g) => [g, topOf(all, g, TOP_N)])) };
  }

  // 카탈로그에서 묶음별 세부 분류 개수 (동기화가 서버에 저장하는 것과 같은 계산)
  function facetCounts(items) {
    const out = {};
    for (const kind of Object.keys(FACET_ORDER)) {
      const counts = new Map();
      for (const it of items) if (it.kind === kind) for (const f of it.facets ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
      const order = FACET_ORDER[kind];
      out[kind] = [...counts].map(([facet, count]) => ({ facet, count }))
        .sort((a, b) => order.indexOf(a.facet.split(":")[0]) - order.indexOf(b.facet.split(":")[0]) || b.count - a.count || (a.facet < b.facet ? -1 : 1));
    }
    return out;
  }

  // ---------- 추천 검색어 (사용자 요청 2026-10-21) ----------
  // 목록: 태그·세부 분류 값·분류·이름(안내 글자는 문구)을 모아 [낱말, 들어 있는 애셋 수, 가장 많이 들어 있는 묶음]으로.
  //   동기화(scripts/supabase-sync.mjs)가 이 함수로 서버의 메타 행에 넣고, 로컬은 같은 함수로 계산한다
  const groupKeyOf = (it) => Object.keys(GROUP_WHERE).find((g) => it[GROUP_WHERE[g][0]] === GROUP_WHERE[g][1]) || "";
  function suggestTerms(items, limit = 8000) {
    const map = new Map();
    for (const it of items) {
      if (it.kind === "_meta") continue;
      const g = groupKeyOf(it), terms = new Set();
      for (const t of it.tags ?? []) terms.add(String(t).trim());
      for (const f of it.facets ?? []) terms.add(f.slice(f.indexOf(":") + 1).trim());
      for (const c of String(it.category ?? "").split("·")) terms.add(c.trim());
      terms.add(String((it.kind === "sign" ? it.text : it.name) ?? "").trim());
      for (const t of terms) {
        if (t.length < 2 || t.length > 40 || /없음/.test(t) || /^[\d\s.~-]+$/.test(t)) continue;
        const e = map.get(t) ?? { n: 0, g: {} };
        e.n++; e.g[g] = (e.g[g] || 0) + 1;
        map.set(t, e);
      }
    }
    return [...map]
      .map(([t, e]) => [t, e.n, Object.entries(e.g).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0]])
      .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
      .slice(0, limit);
  }

  // 입력한 글자에 맞는 추천 검색어 n개. 앞부분이 같은 것 먼저, 그다음 중간에 들어 있는 것, 같으면 애셋이 많은 것·짧은 것
  //   한글 입력 중간 상태도 맞춘다: '민'(미+ㄴ 받침)은 '미니맵'처럼 '미' 다음 글자가 ㄴ으로 시작하는 낱말에,
  //   초성만 친 'ㅁㄴㅁ'은 '미니맵'에 맞는다
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const syl = (c) => { const k = c.charCodeAt(0) - 0xac00; return k >= 0 && k < 11172 ? k : -1; };
  const choOf = (c) => { const k = syl(c); return k < 0 ? c : CHO[Math.floor(k / 588)]; };
  const choseong = (s) => [...s].map(choOf).join("");
  const normTerm = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
  function suggestMatch(list, q, n = 8) {
    const w = normTerm(q);
    if (!w) return [];
    const onlyCho = /^[ㄱ-ㅎ]+$/.test(w);
    // 마지막 글자의 받침을 다음 글자 초성으로 옮겨 본다 ('민' → '미' + ㄴ)
    const last = w.slice(-1), k = syl(last), jong = k >= 0 ? JONG[k % 28] : "";
    const alt = jong && CHO.includes(jong) ? [w.slice(0, -1) + String.fromCharCode(0xac00 + k - (k % 28)), jong] : null;
    const scored = [];
    for (const row of list) {
      const t = normTerm(row[0]);
      let s = -1;
      if (onlyCho) { const c = choseong(t); s = c.startsWith(w) ? 2 : c.includes(w) ? 1 : -1; }
      else if (t.startsWith(w)) s = 3;
      else if (alt && t.startsWith(alt[0]) && t.length > alt[0].length && choOf(t[alt[0].length]) === alt[1]) s = 3;
      else if (t.includes(w)) s = 1;
      if (s >= 0) scored.push([s, row]);
    }
    return scored.sort((a, b) => b[0] - a[0] || b[1][1] - a[1][1] || a[1][0].length - b[1][0].length || cmp(a[1][0], b[1][0])).slice(0, n).map((x) => x[1]);
  }

  root.RidData = { PAGE, TOP_N, GROUP_WHERE, GROUP_LABEL, FACET_ORDER, META_ID, words, serverSource, localSource, localMatch, localCompare, facetCounts, groupSummary, suggestTerms, suggestMatch, choseong };
})(typeof window !== "undefined" ? window : globalThis);
