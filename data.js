// 스토어 목록 데이터: 필요한 만큼만 나눠 받는다 (애셋이 수만 개여도 처음 화면은 60개만)
//   serverSource: Supabase assets 테이블에서 묶음·검색·정렬을 서버가 처리하고 range로 잘라 받는다
//   localSource : 로컬 개발용 catalog.json을 같은 규칙으로 메모리에서 처리한다 (둘의 결과가 같아야 한다 — scripts/data.test.mjs)
// 브라우저에서는 window.RidData, Node 시험에서는 globalThis.RidData로 쓴다
(function (root) {
  const PAGE = 60;
  // 칩 묶음 → 서버 조건 [필드, 값]
  const GROUP_WHERE = {
    character: ["style", "hangang-npc"],
    item: ["style", "museum-item"],
    animal: ["style", "museum-animal"],
    effect: ["kind", "effect"],
    sfx: ["kind", "sfx"],
    bgm: ["kind", "bgm"],
    pixel: ["kind", "pixel"],
  };
  const SEARCH_FIELDS = ["name", "description", "tags", "category", "facets"];
  // 세부 분류 갈래 순서 (scripts/audio/facets.mjs의 FACET_ORDER와 같아야 한다 — 시험이 확인)
  const FACET_ORDER = {
    bgm: ["장르", "편성", "분위기", "빠르기", "음역", "악기", "악기 수", "쓰임새", "조성", "박자", "드럼"],
    sfx: ["종류", "길이", "소리"],
  };
  // 세부 분류 개수를 담은 특별한 행 (애셋이 아니다. 목록·개수에서 뺀다)
  const META_ID = "__facets__";
  // 묶음 이름으로도 찾는다 (예: '캐릭터'로 찾으면 역사 NPC 전부). app.js 칩 이름과 같게
  const GROUP_LABEL = { character: "캐릭터", item: "아이템", animal: "동물", effect: "효과 gif", sfx: "효과음 사운드", bgm: "bgm 배경음악 음악", pixel: "픽셀아트" };
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
      // 칩 옆 숫자: { "": 전체, character: n, ... }
      async counts() {
        const keys = ["", ...Object.keys(GROUP_WHERE)];
        const nums = await Promise.all(keys.map(async (g) => {
          const { count, error } = await filtered(sb.from("assets").select("id", { count: "exact", head: true }), { group: g });
          if (error) throw fail("개수", error);
          return count ?? 0;
        }));
        return Object.fromEntries(keys.map((k, i) => [k, nums[i]]));
      },
      // 배너: 묶음마다 검수 점수 상위 n개
      async top(group, n = 3) {
        const { data, error } = await filtered(sb.from("assets").select("data"), { group })
          .order("data->score", { ascending: false, nullsFirst: false }).order("id").limit(n);
        if (error) throw fail("배너", error);
        return data.map((r) => r.data);
      },
      // 세부 분류 칩과 개수: [{ facet: "장르:국악", count }] (동기화가 계산해 둔 특별한 행 하나를 읽는다)
      async facets(group) {
        const { data, error } = await sb.from("assets").select("data").eq("id", META_ID).maybeSingle();
        if (error) throw fail("세부 분류", error);
        return data?.data?.facets?.[group] ?? [];
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
    const fields = [it.name, it.description, JSON.stringify(it.tags ?? []), it.category, JSON.stringify(it.facets ?? []), it.id].map((s) => String(s ?? "").toLowerCase());
    return ws.every((w) => fields.some((f) => f.includes(w)) || labelGroups(w).some((g) => groupMatch(it, g)));
  }
  function localSource(all) {
    const byId = new Map(all.map((it) => [it.id, it]));
    return {
      async page({ group = "", q = "", sort = "new", offset = 0, limit = PAGE, facets = [] } = {}) {
        const list = all.filter((it) => localMatch(it, { group, q, facets })).sort(localCompare(sort));
        return { items: list.slice(offset, offset + limit), total: list.length };
      },
      async counts() {
        return Object.fromEntries(["", ...Object.keys(GROUP_WHERE)].map((g) => [g, all.filter((it) => groupMatch(it, g)).length]));
      },
      async top(group, n = 3) {
        return all.filter((it) => groupMatch(it, group)).sort((a, b) => scoreDesc(a, b) || cmp(a.id, b.id)).slice(0, n);
      },
      async byIds(ids) { return ids.map((id) => byId.get(id)).filter(Boolean); },
      async facets(group) { return facetCounts(all)[group] ?? []; },
    };
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

  root.RidData = { PAGE, GROUP_WHERE, GROUP_LABEL, FACET_ORDER, META_ID, words, serverSource, localSource, localMatch, localCompare, facetCounts };
})(typeof window !== "undefined" ? window : globalThis);
