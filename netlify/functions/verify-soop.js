// =====================================================================
// SOOP 프로필 메시지 인증 함수 (Netlify Function)
// 배포 시 위치:  (사이트폴더)/netlify/functions/verify-soop.js
//
// 브라우저가 직접 SOOP을 못 읽으므로(CORS), 이 함수가 대신 읽어서
// 인증코드가 사용자의 SOOP 프로필에 있는지 확인하고 승인 처리한다.
//
// 필요한 환경변수 (Netlify → Site settings → Environment variables):
//   SUPABASE_URL          = https://yxuhvbxmwgwcehvwwwqd.supabase.co
//   SUPABASE_SERVICE_ROLE = (Supabase의 service_role 비밀키)  ※ 절대 코드/깃에 넣지 말 것
// =====================================================================
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

exports.handler = async (event) => {
  const J = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(obj) });

  // ── OPTIONS 프리플라이트 ──
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  if (event.httpMethod !== 'POST') return J(405, { ok: false, msg: 'POST only' });

  let token;
  try { token = JSON.parse(event.body || '{}').token; } catch (e) {}
  if (!token) return J(400, { ok: false, msg: '로그인 토큰이 없어요' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

  // 1) 토큰으로 사용자 확인 (위조 방지)
  const { data: u, error: ue } = await sb.auth.getUser(token);
  if (ue || !u || !u.user) return J(401, { ok: false, msg: '로그인이 만료됐어요. 다시 로그인하세요.' });
  const uid = u.user.id;

  // 2) 프로필에서 SOOP 아이디 + 인증코드 조회
  const { data: p } = await sb.from('profiles').select('soop_id, verify_code, approved').eq('id', uid).single();
  if (!p) return J(400, { ok: false, msg: '프로필을 찾을 수 없어요' });
  if (p.approved) return J(200, { ok: true, msg: '이미 인증되어 있어요' });
  if (!p.soop_id) return J(400, { ok: false, msg: 'SOOP 아이디가 없어요' });

  const code = '[yxl]' + p.verify_code + '[/yxl]';
  const id = encodeURIComponent(p.soop_id.trim().toLowerCase());

  // 3) SOOP 공개 채널 정보 읽기 (여러 엔드포인트 시도)
  const urls = [
    `https://chapi.sooplive.co.kr/api/${id}/station`,
    `https://bjapi.afreecatv.com/api/${id}/station`,
    `https://st.sooplive.co.kr/api/get_station_status.php?szBjId=${id}`,
  ];
  let body = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.sooplive.co.kr/' } });
      if (r.ok) { body += '\n' + (await r.text()); }
    } catch (e) {}
  }
  if (!body) return J(502, { ok: false, msg: 'SOOP 프로필을 불러오지 못했어요. 아이디를 확인해 주세요.' });

  // 4) 코드(또는 코드 안 6자리)가 프로필 데이터에 있으면 승인
  const found = body.includes(code) || body.includes(p.verify_code);
  if (!found) return J(200, { ok: false, msg: '프로필 메시지에서 코드를 찾지 못했어요. 저장 후 1~2분 뒤 다시 시도하세요.' });

  const { error: upErr } = await sb.from('profiles').update({ approved: true }).eq('id', uid);
  if (upErr) return J(500, { ok: false, msg: '승인 처리 실패: ' + upErr.message });

  return J(200, { ok: true, msg: '인증 완료! 이제 글쓰기가 가능해요.' });
};
