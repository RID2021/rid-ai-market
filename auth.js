// 로그인·승인 확인·회원 관리 (Supabase)
// 그림 파일: config.js의 storage가 "ncp"면 NCP Object Storage 비공개 버킷(서명 주소는 Supabase 함수 sign_asset_urls가 만든다),
//            아니면 Supabase Storage 비공개 버킷
// config.js가 비어 있으면 로컬 개발(localhost)에서만 catalog.json을 그대로 쓴다
(function () {
  const cfg = window.RID_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const isCompany = (email) => /@ri-d\.com$/i.test(email || "");
  const FIELDS = ["file", "gif", "preview", "thumb", "spec"];
  const TTL = 30 * 60; // 화면에 쓰는 서명 주소 유효시간(초). 받기는 매번 로그인 확인 후 짧은 주소로 받는다
  const useNcp = cfg.storage === "ncp";
  let sb = null;
  let me = null;

  // 공개 키(anon/publishable)만 허용. 비밀 키(service_role/secret)가 들어 있으면 쓰지 않는다
  function keyKind(key) {
    if (/^sb_secret_/.test(key)) return "secret";
    if (/^sb_publishable_/.test(key)) return "public";
    try {
      const role = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
      return role === "anon" ? "public" : "secret";
    } catch { return "unknown"; }
  }

  function showGate(mode, message) {
    document.body.classList.add("gated");
    $("#gate").hidden = false;
    $("#app").hidden = true;
    $("#gate-login").hidden = mode !== "login";
    $("#gate-wait").hidden = mode !== "wait";
    $("#gate-logout").hidden = mode === "login" || mode === "error";
    if (message) $("#gate-msg").textContent = message;
  }
  const status = (text) => { $("#gate-status").textContent = text || ""; };

  function wireGate() {
    const here = location.origin + location.pathname;
    $("#login-google").onclick = async () => {
      status("Google로 이동합니다…");
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here } });
      if (error) status(`로그인 실패: ${error.message}`);
    };
    $("#otp-form").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#otp-email").value.trim();
      status("로그인 메일을 보내는 중…");
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: here } });
      if (error) return status(`보내지 못했습니다: ${error.message}`);
      $("#otp-form").hidden = true;
      $("#otp-verify").hidden = false;
      $("#otp-code").focus();
      status(`${email}로 로그인 메일을 보냈습니다. 메일 안의 링크를 누르면 바로 들어옵니다. 메일에 숫자 코드가 있으면 아래 칸에 넣어도 됩니다. (스팸함도 확인하세요)`);
    };
    $("#otp-verify").onsubmit = async (e) => {
      e.preventDefault();
      status("확인 중…");
      const { error } = await sb.auth.verifyOtp({ email: $("#otp-email").value.trim(), token: $("#otp-code").value.trim(), type: "email" });
      if (error) return status(`코드가 맞지 않습니다: ${error.message}`);
      location.replace(here);
    };
    const logout = async () => { await sb.auth.signOut(); location.replace(here); };
    $("#gate-logout").onclick = logout;
    $("#logout").onclick = logout;
  }

  // 경로 목록 → 서명 주소 Map. 요청할 때마다 서버가 로그인·승인을 다시 확인한다
  async function signPaths(paths, ttl) {
    const map = new Map();
    const step = useNcp ? 500 : 100;
    for (let i = 0; i < paths.length; i += step) {
      const chunk = paths.slice(i, i + step);
      if (useNcp) {
        const { data, error } = await sb.rpc("sign_asset_urls", { paths: chunk, ttl });
        if (error) throw new Error(`파일 주소를 받지 못했습니다: ${error.message}`);
        for (const d of data) if (d.url) map.set(d.path, d.url);
      } else {
        const { data, error } = await sb.storage.from("assets").createSignedUrls(chunk, ttl);
        if (error) throw new Error(`파일 주소를 받지 못했습니다: ${error.message}`);
        for (const d of data) if (d.signedUrl) map.set(d.path, d.signedUrl);
      }
    }
    return map;
  }

  // 비공개 버킷 경로 → 짧은 서명 주소 (원래 경로는 it.src에 보관)
  async function signItems(items) {
    for (const it of items) it.src ??= Object.fromEntries(FIELDS.filter((f) => it[f]).map((f) => [f, it[f]]));
    const show = ["thumb", "preview", "gif"]; // 화면에 쓰는 것만 서명. file·spec은 받을 때 따로 받는다
    const paths = [...new Set(items.flatMap((it) => show.map((f) => it.src[f]).filter(Boolean)))];
    const map = await signPaths(paths, TTL);
    const missing = paths.filter((p) => !map.has(p));
    if (missing.length) console.warn("서명하지 못한 파일", missing);
    for (const it of items) for (const f of show) if (it.src[f]) it[f] = map.get(it.src[f]) ?? "";
    return items;
  }

  // 파일 받기: 요청마다 로그인·승인을 다시 확인한다 (NCP는 2분짜리 서명 주소, Supabase는 download())
  window.ridBlob = async function (path) {
    if (!sb) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path} (${res.status})`);
      return res.blob();
    }
    if (useNcp) {
      const url = (await signPaths([path], 120)).get(path);
      if (!url) throw new Error(`${path}: 받을 수 없는 파일입니다`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${path} (${res.status})`);
      return res.blob();
    }
    const { data, error } = await sb.storage.from("assets").download(path);
    if (error) throw new Error(`${path}: ${error.message}`);
    return data;
  };

  function showUser(user, profile) {
    const btn = $("#user-btn");
    btn.hidden = false;
    const avatar = user.user_metadata?.avatar_url;
    $("#user-avatar").hidden = !avatar;
    if (avatar) $("#user-avatar").src = avatar;
    $("#user-initial").textContent = avatar ? "" : (profile.email || "?").slice(0, 1).toUpperCase();
    $("#me-email").textContent = profile.email;
    btn.onclick = () => $("#me").showModal();
  }

  // ---------- 회원 관리 (승인된 @ri-d.com 사용자) ----------
  const LABEL = { pending: "승인 대기", approved: "승인됨", rejected: "거절됨" };
  let adminTab = "pending";
  let members = [];

  async function loadMembers() {
    const { data, error } = await sb.from("profiles").select("id,email,name,status,auto_approved,decided_by,decided_at,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    members = data;
    const pending = members.filter((m) => m.status === "pending").length;
    $("#admin-count").hidden = pending === 0;
    $("#admin-count").textContent = String(pending);
  }

  function memberRow(m) {
    const li = document.createElement("li");
    const who = document.createElement("div");
    who.className = "who";
    const mail = document.createElement("b");
    mail.textContent = m.email; // 실제 메일을 앞세운다 (이름은 본인이 정한 값이라 보조로만)
    who.append(mail);
    if (!isCompany(m.email)) {
      const ext = document.createElement("span");
      ext.className = "ext";
      ext.textContent = "외부 메일";
      mail.after(ext);
    }
    const sub = document.createElement("small");
    const decider = m.decided_by ? members.find((x) => x.id === m.decided_by)?.email ?? "관리자" : null;
    sub.textContent = [
      m.name ? `본인 입력 이름: ${m.name}` : null,
      `${new Date(m.created_at).toLocaleDateString("ko-KR")} 가입`,
      m.auto_approved ? "회사 메일 자동 승인" : decider ? `${LABEL[m.status]} · ${decider}` : null,
    ].filter(Boolean).join(" · ");
    who.append(sub);
    const tag = document.createElement("span");
    tag.className = `state ${m.status}`;
    tag.textContent = LABEL[m.status];
    li.append(who, tag);
    if (m.id !== me.id) {
      for (const [decision, text] of [["approved", "승인"], ["rejected", "거절"]]) {
        if (m.status === decision) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className = `btn ${decision === "approved" ? "dark" : ""}`;
        b.textContent = text;
        b.onclick = async () => {
          b.disabled = true;
          const { error } = await sb.rpc("decide_member", { member: m.id, decision });
          if (error) { alert(`처리하지 못했습니다: ${error.message}`); b.disabled = false; return; }
          await loadMembers(); renderMembers();
        };
        li.append(b);
      }
    }
    return li;
  }

  function renderMembers() {
    const tabs = ["pending", "approved", "rejected", "all"];
    $("#admin-tabs").replaceChildren(...tabs.map((t) => {
      const n = t === "all" ? members.length : members.filter((m) => m.status === t).length;
      const b = document.createElement("button");
      b.className = "chip"; b.type = "button";
      b.setAttribute("aria-pressed", String(adminTab === t));
      b.textContent = `${t === "all" ? "전체" : LABEL[t]} ${n}`;
      b.onclick = () => { adminTab = t; renderMembers(); };
      return b;
    }));
    const list = members.filter((m) => adminTab === "all" || m.status === adminTab);
    $("#admin-empty").hidden = list.length > 0;
    $("#admin-list").replaceChildren(...list.map(memberRow));
  }

  async function setupAdmin() {
    $("#admin-open").hidden = false;
    await loadMembers();
    $("#admin-open").onclick = async () => {
      try { await loadMembers(); } catch (e) { alert(`회원 목록을 받지 못했습니다: ${e.message}`); return; }
      renderMembers(); $("#admin").showModal();
    };
  }

  // 화면에 올릴 애셋의 그림 주소를 서명한다 (app.js가 목록을 받을 때마다, 그리고 25분마다 부른다)
  window.ridSign = async (items) => (sb ? signItems(items) : items);
  window.ridRefreshUrls = window.ridSign;

  // 로컬 개발: catalog.json을 같은 규칙으로 메모리에서 나눠 준다 (?catalog=1이면 Supabase 설정이 있어도 로컬 목록)
  async function localStart() {
    const res = await fetch("catalog.json", { cache: "no-cache" });
    return { source: window.RidData.localSource((await res.json()).items), sign: window.ridSign };
  }

  // 게시 직후 예전 index.html이 캐시에 남아 data.js 없이 이 파일을 불렀을 때를 대비해 직접 불러온다
  const ensureData = () => window.RidData ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "data.js";
    s.onload = ok; s.onerror = () => no(new Error("data.js를 불러오지 못했습니다. 새로고침해 주세요"));
    document.head.append(s);
  });

  // 예전 app.js가 캐시에 남아 있을 때를 위한 호환: 목록 전체를 받아 서명해 돌려준다 (새 app.js는 쓰지 않는다)
  window.ridLoadCatalog = async function () {
    const st = await window.ridStart();
    if (!st) return null;
    const all = [];
    let total = null;
    for (let offset = 0; ; ) {
      const page = await st.source.page({ offset, limit: 1000 });
      total ??= page.total;
      all.push(...page.items);
      offset += page.items.length; // 받은 개수만큼 넘어간다 (서버 한도가 1000보다 작아도 빠지지 않게)
      if (!page.items.length || all.length >= total) break;
    }
    return st.sign(all);
  };

  // app.js가 부른다: 승인된 사용자면 목록 데이터 창구 { source, sign }를, 아니면 관문을 보여 주고 null을 돌려준다
  window.ridStart = async function () {
    await ensureData();
    if (isLocal && new URLSearchParams(location.search).has("catalog")) return localStart();
    if (!(cfg.supabaseUrl && cfg.supabaseAnonKey)) {
      if (isLocal) return localStart();
      showGate("error", "사이트 설정이 아직 끝나지 않았습니다. 관리자에게 문의하세요.");
      return null;
    }
    if (keyKind(cfg.supabaseAnonKey) !== "public") {
      showGate("error", "사이트 설정 오류: 공개 키 자리에 비밀 키가 들어 있습니다. 관리자에게 알려 주세요.");
      return null;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    wireGate();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showGate("login"); return null; }
    me = session.user;
    const { data: profile, error: pErr } = await sb.from("profiles").select("id,email,status").eq("id", me.id).maybeSingle();
    if (pErr) { showGate("error", `회원 정보를 확인하지 못했습니다: ${pErr.message}`); $("#gate-logout").hidden = false; return null; }
    if (!profile) {
      showGate("error", "메일 확인이 끝나지 않았거나 가입 정보가 없습니다. 다시 로그인하거나 관리자에게 문의하세요.");
      $("#gate-logout").hidden = false;
      return null;
    }
    if (profile.status !== "approved") {
      $("#wait-email").textContent = profile.email;
      if (profile.status === "rejected") {
        showGate("error", "이 계정은 이용 승인이 거절됐습니다. 관리자에게 문의하세요.");
        $("#gate-logout").hidden = false;
      } else {
        showGate("wait", "가입 신청이 접수됐습니다.");
      }
      return null;
    }
    document.body.classList.remove("gated");
    showUser(me, profile);
    if (isCompany(me.email)) setupAdmin().catch(() => { $("#admin-open").hidden = true; });
    // 목록은 화면이 필요한 만큼만 서버에서 나눠 받는다 (data.js)
    return { source: window.RidData.serverSource(sb), sign: window.ridSign };
  };
})();
