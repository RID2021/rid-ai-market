// Supabase 연결 정보 (공개해도 되는 값: Project URL과 anon 키)
// 비밀 키(service_role/secret)는 절대 넣지 않는다 (npm test와 게시 스크립트가 막는다)
window.RID_CONFIG = {
  supabaseUrl: "https://fascatopsmfcprnsjbpj.supabase.co",
  supabaseAnonKey: "sb_publishable_HeosplW3lAx9ArzDoBCvGw_ZFEUhWHS",
  // 그림 파일 저장소: "ncp"(NCP Object Storage 비공개 버킷, 2026-10-20부터) 또는 "supabase"(예전)
  storage: "ncp",
};
