// 로그인·승인 확인·회원 관리 (Supabase)
// 로그인 (2026-10-21부터 메일을 보내지 않는다. 기본 메일은 사이트 전체 1시간 2통이라 막혔다):
//   직원 = 회사 Microsoft 계정(azure), 누구나 = Google, 고객사 = 초대 링크로 만든 아이디(<아이디>@guest.ri-d.com)·비밀번호
//   승인 규칙은 supabase/schema.sql (회사 계정 자동 승인, 초대 링크로 승인, 비밀번호 세션은 아이디 계정만)
// 그림 파일: config.js의 storage가 "ncp"면 NCP Object Storage 비공개 버킷(서명 주소는 Supabase 함수 sign_asset_urls가 만든다),
//            아니면 Supabase Storage 비공개 버킷
// config.js가 비어 있으면 로컬 개발(localhost)에서만 catalog.json을 그대로 쓴다
(function () {
  const cfg = window.RID_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const isCompany = (email) => /@ri-d\.com$/i.test(email || "");
  const GUEST = "guest.ri-d.com";
  const ID_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
  const isGuest = (email) => new RegExp(`^[a-z0-9][a-z0-9._-]{2,29}@${GUEST.replace(/\./g, "\\.")}$`).test(email || "");
  // 화면에 보이는 계정 이름: 아이디 계정은 아이디만
  const shown = (email) => (isGuest(email) ? `${email.split("@")[0]} (아이디)` : email || "");

  // 초대 링크(?invite=…)로 들어오면 코드를 기억한다 (Google·Microsoft에 다녀와도 남게).
  //   주소창의 ?invite=는 쓰기 전까지 남겨 둔다: 카카오톡 안에서 '다른 브라우저로 열기'를 해도 초대가 따라가게 (2026-10-21 검토)
  //   저장소를 막은 브라우저에서는 localStorage를 읽기만 해도 예외가 나므로 모두 try 안에서, 메모리에도 둔다
  const INVITE_KEY = "rid.invite";
  const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
  let inviteMem = "";
  const invite = {
    get() {
      if (inviteMem) return inviteMem;
      for (const name of ["localStorage", "sessionStorage"]) {
        try { const v = window[name].getItem(INVITE_KEY); if (v) return (inviteMem = v); } catch { /* 저장소를 못 쓰는 브라우저 */ }
      }
      return "";
    },
    set(v) {
      inviteMem = v || "";
      for (const name of ["localStorage", "sessionStorage"]) {
        try { v ? window[name].setItem(INVITE_KEY, v) : window[name].removeItem(INVITE_KEY); } catch { /* 무시 */ }
      }
      if (!v) dropInviteFromUrl();
    },
  };
  function dropInviteFromUrl() {
    const u = new URL(location.href);
    if (!u.searchParams.has("invite")) return;
    u.searchParams.delete("invite");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  }
  // 초대 링크·코드 문자열 → 코드
  const inviteCodeOf = (text) => {
    const t = String(text || "").trim();
    try { const c = new URL(t).searchParams.get("invite"); if (c) return CODE_RE.test(c) ? c : ""; } catch { /* 주소가 아니면 코드 그대로 */ }
    return CODE_RE.test(t) ? t : "";
  };
  {
    const code = new URL(location.href).searchParams.get("invite");
    if (code != null) { if (CODE_RE.test(code)) invite.set(code); else dropInviteFromUrl(); }
  }
  let inviteError = "";
  // 사이트 데이터 저장이 막힌 브라우저 (로그인이 새로고침 뒤에 유지되지 않는다)
  const canStore = (() => { try { localStorage.setItem("rid.t", "1"); localStorage.removeItem("rid.t"); return true; } catch { return false; } })();
  // 카카오톡·네이버 등 앱 안 브라우저: Google 로그인이 막힌다 (disallowed_useragent)
  const inAppKakao = /KAKAOTALK/i.test(navigator.userAgent);
  const inApp = inAppKakao || /NAVER\(inapp|Instagram|FBAN|FBAV|\bLine\/|everytimeApp|DaumApps|SamsungBrowser\/.*CrossApp/i.test(navigator.userAgent);
  const FIELDS = ["file", "gif", "preview", "thumb", "spec", "midi"];
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
    $("#login-microsoft").onclick = async () => {
      status("회사 계정(Microsoft)으로 이동합니다…");
      const { error } = await sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: here } });
      if (error) status(`로그인 실패: ${error.message}`);
    };
    $("#id-login").onsubmit = async (e) => {
      e.preventDefault();
      const id = $("#id-name").value.trim().toLowerCase();
      if (!ID_RE.test(id)) return status("아이디는 영문 소문자·숫자 3~30자입니다 (. _ - 사용 가능).");
      status("로그인 중…");
      const { error } = await sb.auth.signInWithPassword({ email: `${id}@${GUEST}`, password: $("#id-pass").value });
      if (error) return status(/invalid login|credentials/i.test(error.message) ? "아이디나 비밀번호가 맞지 않습니다." : `로그인 실패: ${error.message}`);
      location.replace(here);
    };
    $("#id-signup-open").onclick = () => {
      $("#id-signup-open").hidden = true;
      $("#id-login").hidden = true; // 가입 칸만 보이게
      $("#id-signup").hidden = false;
      $("#su-name").focus();
    };
    $("#id-signup").onsubmit = async (e) => {
      e.preventDefault();
      const id = $("#su-name").value.trim().toLowerCase(), pw = $("#su-pass").value;
      if (!invite.get()) return status("초대 링크로 들어와야 아이디를 만들 수 있습니다. 관리자에게 링크를 받아 주세요.");
      if (!ID_RE.test(id)) return status("아이디는 영문 소문자·숫자 3~30자입니다 (. _ - 사용 가능).");
      if (pw.length < 8) return status("비밀번호는 8자 이상이어야 합니다.");
      if (pw !== $("#su-pass2").value) return status("비밀번호 확인이 서로 다릅니다.");
      status("아이디를 만드는 중…");
      const { data, error } = await sb.auth.signUp({ email: `${id}@${GUEST}`, password: pw, options: { data: { name: $("#su-display").value.trim().slice(0, 60) } } });
      if (error) return status(/already|registered|exists/i.test(error.message) ? "이미 있는 아이디입니다. 다른 아이디를 써 주세요." : `아이디를 만들지 못했습니다: ${error.message}`);
      if (!data.session) return status("아이디는 만들었지만 바로 로그인되지 않았습니다. 사이트 설정(가입 확인 메일 끄기)이 아직 안 된 것 같습니다. 관리자에게 알려 주세요.");
      location.replace(here);
    };
    const logout = async () => { await sb.auth.signOut(); location.replace(here); };
    $("#gate-logout").onclick = logout;
    $("#logout").onclick = logout;
  }

  // Supabase에서 켜진 로그인 방식의 버튼만 보인다 (/auth/v1/settings, 공개 값). 못 읽으면 모두 보인다
  async function showProviders() {
    try {
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseAnonKey } });
      const ext = (await res.json()).external ?? {};
      $("#login-microsoft").hidden = !ext.azure;
      $("#login-microsoft").nextElementSibling.hidden = !ext.azure; // 안내 문구
      $("#login-google").hidden = !ext.google;
      if (!ext.azure && !ext.google) $(".gate .or").hidden = true;
    } catch (e) { console.warn("로그인 설정을 읽지 못했습니다", e); }
  }

  // 로그인 화면 안내: 앱 안 브라우저·저장 막힘·초대 링크. 쓸 수 없는 초대 링크면 기억한 코드를 지운다
  function showBrowserNotes() {
    const box = $("#browser-note");
    const lines = [];
    if (inApp) lines.push("앱(카카오톡 등) 안에서는 Google 로그인이 막힐 수 있습니다. 아이디로 가입하거나 외부 브라우저(Chrome·Safari)로 열어 주세요.");
    if (!canStore) lines.push("이 브라우저는 사이트 데이터 저장이 막혀 있어 로그인이 유지되지 않습니다. 브라우저 설정에서 이 사이트의 쿠키·데이터 저장을 허용해 주세요.");
    box.hidden = lines.length === 0;
    box.querySelector("p").textContent = lines.join(" ");
    $("#open-external").hidden = !inAppKakao;
    $("#open-external").onclick = () => { location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`; };
  }
  async function showInvite() {
    const code = invite.get(), note = $("#invite-note");
    $("#id-signup-open").hidden = !code;
    note.hidden = !code;
    if (!code) return;
    const { data, error } = await sb.rpc("invite_info", { p_code: code });
    const row = data?.[0];
    note.className = "invite-note";
    if (error) { note.textContent = "초대 링크를 확인하지 못했습니다. 잠시 후 새로고침해 주세요."; return; }
    if (!row || !row.valid) {
      invite.set("");
      $("#id-signup-open").hidden = true;
      note.className = "invite-note bad";
      note.textContent = "초대 링크가 만료됐거나 더 쓸 수 없습니다. 관리자에게 새 링크를 받아 주세요.";
      return;
    }
    note.textContent = `‘${row.label}’ 초대 링크로 들어오셨습니다. Google 또는 아이디로 가입하면 바로 이용할 수 있습니다.`;
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

  // 파일 받기: 요청마다 로그인·승인을 다시 확인한다 (NCP는 짧은 서명 주소, Supabase는 download())
  //   NCP는 브라우저 캐시를 쓰지 않고 받는다(no-store). 같은 주소를 그림(img)으로 먼저 불러 둔 캐시에는 CORS 머리글이 없어
  //   fetch가 'Failed to fetch'로 실패한다 (2026-10-21 재현). NCP 오류 응답(서명·만료·일시 오류)에도 CORS 머리글이 없어
  //   같은 메시지만 보이므로, 실패하면 유효시간을 바꾼 새 주소(= 다른 주소)로 한 번 더 받는다
  window.ridBlob = async function (path) {
    if (!sb) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path} (${res.status})`);
      return res.blob();
    }
    if (useNcp) {
      let last = null;
      for (const ttl of [120, 300]) {
        const url = (await signPaths([path], ttl)).get(path);
        if (!url) throw new Error(`${path}: 받을 수 없는 파일입니다`);
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) return await res.blob();
          last = new Error(`${path} (${res.status})`);
        } catch (e) {
          last = new Error(`${path}: ${e.message}`);
        }
        console.warn("파일 받기 실패", last.message);
      }
      throw last;
    }
    const { data, error } = await sb.storage.from("assets").download(path);
    if (error) throw new Error(`${path}: ${error.message}`);
    return data;
  };
  // 바로 받기가 막혔을 때 쓰는 새 탭 주소 (보안 프로그램·네트워크가 fetch만 막는 경우 등). 10~20분 유효
  window.ridFileUrl = async function (path) {
    if (!sb) return path;
    return (await signPaths([path], 600)).get(path) ?? null;
  };

  function showUser(user, profile) {
    const btn = $("#user-btn");
    btn.hidden = false;
    const avatar = user.user_metadata?.avatar_url;
    $("#user-avatar").hidden = !avatar;
    if (avatar) $("#user-avatar").src = avatar;
    $("#user-initial").textContent = avatar ? "" : (profile.email || "?").slice(0, 1).toUpperCase();
    $("#me-email").textContent = shown(profile.email);
    btn.onclick = () => $("#me").showModal();
    // 아이디 계정만 비밀번호를 바꿀 수 있다 (Microsoft·Google 계정은 비밀번호가 없다)
    const form = $("#pw-form");
    form.hidden = !isGuest(profile.email);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const pw = $("#pw-new").value;
      if (pw.length < 8) return ($("#pw-status").textContent = "비밀번호는 8자 이상이어야 합니다.");
      if (pw !== $("#pw-new2").value) return ($("#pw-status").textContent = "비밀번호 확인이 서로 다릅니다.");
      const { error } = await sb.auth.updateUser({ password: pw });
      $("#pw-status").textContent = error ? `바꾸지 못했습니다: ${error.message}` : "비밀번호를 바꿨습니다.";
      if (!error) form.reset();
    };
  }

  // ---------- 회원 관리 (승인된 @ri-d.com 사용자) ----------
  const LABEL = { pending: "승인 대기", approved: "승인됨", rejected: "거절됨" };
  let adminTab = "pending";
  let members = [];

  async function loadMembers() {
    const { data, error } = await sb.from("profiles").select("id,email,name,status,auto_approved,decided_by,decided_at,created_at,company").order("created_at", { ascending: false });
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
    mail.textContent = shown(m.email); // 실제 메일(아이디)을 앞세운다 (이름은 본인이 정한 값이라 보조로만)
    who.append(mail);
    if (!isCompany(m.email)) {
      const ext = document.createElement("span");
      ext.className = isGuest(m.email) ? "tagline" : "ext";
      ext.textContent = isGuest(m.email) ? "고객사 아이디" : "외부 메일";
      mail.after(ext);
    }
    const sub = document.createElement("small");
    const decider = m.decided_by ? members.find((x) => x.id === m.decided_by)?.email ?? "관리자" : null;
    sub.textContent = [
      m.name ? `본인 입력 이름: ${m.name}` : null,
      `${new Date(m.created_at).toLocaleDateString("ko-KR")} 가입`,
      m.company ? `초대 링크: ${m.company}` : null,
      m.auto_approved ? "회사 계정 자동 승인" : decider ? `${LABEL[m.status]} · ${shown(decider)}` : null,
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
      // 아이디 계정: 비밀번호를 잊었을 때 임시 비밀번호를 정해 준다 (메일로 재설정하지 않는다)
      if (isGuest(m.email)) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn"; b.textContent = "임시 비밀번호";
        b.onclick = async () => {
          if (!confirm(`${shown(m.email)} 계정의 비밀번호를 새 임시 비밀번호로 바꿀까요? 지금 로그인된 곳은 모두 로그아웃됩니다.`)) return;
          const pw = tempPassword();
          b.disabled = true;
          const { error } = await sb.rpc("admin_set_password", { member: m.id, new_password: pw });
          b.disabled = false;
          if (error) return alert(`바꾸지 못했습니다: ${error.message}`);
          prompt("임시 비밀번호입니다. 고객에게 전달하고, 로그인 후 '내 계정'에서 바꾸게 해 주세요.", pw);
        };
        li.append(b);
      }
    }
    return li;
  }
  // 헷갈리는 글자(0 o 1 l i)를 뺀 10자
  function tempPassword() {
    const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    return Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => abc[n % abc.length]).join("");
  }

  // ---------- 초대 링크 (관리자) ----------
  let invites = [];
  const inviteLink = (code) => `${location.origin}${location.pathname}?invite=${code}`;
  async function loadInvites() {
    const { data, error } = await sb.from("invites").select("id,code,label,created_at,expires_at,max_uses,uses,revoked").order("created_at", { ascending: false });
    if (error) throw error;
    invites = data;
  }
  async function copyLink(code, btn) {
    const link = inviteLink(code);
    try { await navigator.clipboard.writeText(link); btn.textContent = "복사됨"; setTimeout(() => (btn.textContent = "링크 복사"), 1500); }
    catch { prompt("아래 링크를 복사하세요", link); }
  }
  function inviteRow(inv) {
    const li = document.createElement("li");
    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("b");
    name.textContent = inv.label;
    const sub = document.createElement("small");
    const until = new Date(inv.expires_at);
    sub.textContent = `${inv.uses}/${inv.max_uses}명 사용 · ${until.toLocaleDateString("ko-KR")}까지 · ${new Date(inv.created_at).toLocaleDateString("ko-KR")} 만듦`;
    who.append(name, sub);
    const active = !inv.revoked && until > new Date() && inv.uses < inv.max_uses;
    const tag = document.createElement("span");
    tag.className = `state ${active ? "approved" : "rejected"}`;
    tag.textContent = active ? "사용 중" : inv.revoked ? "중지" : inv.uses >= inv.max_uses ? "다 씀" : "만료";
    li.append(who, tag);
    if (active) {
      const copy = document.createElement("button");
      copy.type = "button"; copy.className = "btn dark"; copy.textContent = "링크 복사";
      copy.onclick = () => copyLink(inv.code, copy);
      const stop = document.createElement("button");
      stop.type = "button"; stop.className = "btn"; stop.textContent = "사용 중지";
      stop.onclick = async () => {
        if (!confirm(`‘${inv.label}’ 초대 링크를 더 쓰지 못하게 할까요? (이미 가입한 사람은 그대로입니다)`)) return;
        const { error } = await sb.rpc("revoke_invite", { p_id: inv.id });
        if (error) return alert(`중지하지 못했습니다: ${error.message}`);
        await loadInvites(); renderInvites();
      };
      li.append(copy, stop);
    }
    return li;
  }
  function renderInvites() {
    $("#invite-empty").hidden = invites.length > 0;
    $("#invite-list").replaceChildren(...invites.map(inviteRow));
  }
  function showPane(name) {
    $("#admin-members").hidden = name !== "members";
    $("#admin-invites").hidden = name !== "invites";
    $("#pane-members").setAttribute("aria-selected", String(name === "members"));
    $("#pane-invites").setAttribute("aria-selected", String(name === "invites"));
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
      renderMembers(); showPane("members"); $("#admin").showModal();
    };
    $("#pane-members").onclick = () => showPane("members");
    $("#pane-invites").onclick = async () => {
      showPane("invites");
      try { await loadInvites(); renderInvites(); } catch (e) { $("#invite-empty").hidden = false; $("#invite-empty").textContent = `초대 링크를 받지 못했습니다: ${e.message}`; }
    };
    $("#invite-form").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter ?? $("#invite-form button");
      btn.disabled = true;
      const { data: code, error } = await sb.rpc("create_invite", { p_label: $("#inv-label").value.trim(), p_days: Number($("#inv-days").value), p_max_uses: Number($("#inv-uses").value) });
      btn.disabled = false;
      if (error) return alert(`만들지 못했습니다: ${error.message}`);
      $("#inv-label").value = "";
      await loadInvites(); renderInvites();
      const first = $("#invite-list .btn.dark");
      if (first) await copyLink(code, first);
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
    if (!session) { showGate("login"); showBrowserNotes(); showProviders(); showInvite().catch((e) => console.warn(e)); return null; }
    me = session.user;
    // 가입 정보 확인·보충 (회사 계정 자동 승인 포함). 서버 함수가 아직 없으면(설정 전) 건너뛴다
    const ens = await sb.rpc("ensure_my_profile");
    if (ens.error && /인정하지 않는 로그인/.test(ens.error.message)) {
      showGate("error", "이 로그인 방식은 쓸 수 없습니다. 회사 계정·Google·아이디로 다시 로그인해 주세요.");
      $("#gate-logout").hidden = false;
      return null;
    }
    if (ens.error) console.warn("ensure_my_profile", ens.error.message);
    // 초대 링크로 들어왔으면 승인받기 (한 번 쓰면 기억한 코드를 지운다)
    const code = invite.get();
    if (code && ens.data && ens.data !== "approved") {
      const { error } = await sb.rpc("redeem_invite", { p_code: code });
      if (error) inviteError = error.message;
      invite.set("");
    } else if (code && ens.data === "approved") invite.set("");
    const { data: profile, error: pErr } = await sb.from("profiles").select("id,email,status").eq("id", me.id).maybeSingle();
    if (pErr) { showGate("error", `회원 정보를 확인하지 못했습니다: ${pErr.message}`); $("#gate-logout").hidden = false; return null; }
    if (!profile) {
      showGate("error", "가입 정보가 없습니다. 회사 계정·Google·아이디로 다시 로그인하거나 관리자에게 문의하세요.");
      $("#gate-logout").hidden = false;
      return null;
    }
    if (profile.status !== "approved") {
      $("#wait-email").textContent = shown(profile.email);
      // 대기 화면: 초대 링크를 붙여 넣어 승인받기 (다른 브라우저로 옮겨 초대가 빠졌을 때)
      $("#wait-invite").onsubmit = async (e) => {
        e.preventDefault();
        const c = inviteCodeOf($("#wait-invite-input").value);
        if (!c) return status("초대 링크나 코드를 그대로 붙여 넣어 주세요.");
        status("확인 중…");
        const { error } = await sb.rpc("redeem_invite", { p_code: c });
        if (error) return status(`초대 링크를 쓰지 못했습니다: ${error.message}`);
        invite.set("");
        location.reload();
      };
      if (profile.status === "rejected") {
        showGate("error", "이 계정은 이용 승인이 거절됐습니다. 관리자에게 문의하세요.");
        $("#gate-logout").hidden = false;
      } else {
        showGate("wait", "가입 신청이 접수됐습니다.");
        if (inviteError) status(`초대 링크를 쓰지 못했습니다: ${inviteError}`);
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
