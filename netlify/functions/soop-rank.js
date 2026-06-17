// =====================================================================
// 염보성(yuambo) 열혈팬(별풍선 후원 TOP) 순위 자동연동 (Netlify Function)
// 배포 위치:  (사이트폴더)/netlify/functions/soop-rank.js
// 브라우저는 CORS로 SOOP을 직접 못 읽으므로 이 함수가 대신 읽어 돌려준다.
// =====================================================================
const BJ = 'yuambo'; // 염보성 SOOP 아이디

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

exports.handler = async (event) => {
  const J = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(obj) });

  // ── OPTIONS 프리플라이트 ──
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  try {
    const r = await fetch('https://chapi.sooplive.co.kr/api/' + BJ + '/station', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 
        'Referer': 'https://www.sooplive.co.kr/' 
      }
    });
    if (!r.ok) return J(502, { top: [], msg: 'SOOP 응답 오류' });
    const d = await r.json();
    const fix = (u) => (u || '').startsWith('//') ? 'https:' + u : u;
    const top = (d.starballoon_top || []).map((u, i) => ({
      rank: i + 1,
      id: u.user_id,
      nick: u.user_nick,
      img: fix(u.profile_image)
    }));
    return J(200, { top, bj_nick: (d.station && d.station.user_nick) || d.user_nick || '염보성' });
  } catch (e) {
    return J(500, { top: [], msg: 'SOOP 서버에 연결할 수 없어요: ' + String(e) });
  }
};
