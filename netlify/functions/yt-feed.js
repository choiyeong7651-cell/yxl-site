// =====================================================================
// 멤버 유튜브 채널 최신영상 자동연동 (Netlify Function)
// 배포 시 위치:  (사이트폴더)/netlify/functions/yt-feed.js
//
// 브라우저가 유튜브를 직접 못 읽으므로(CORS), 이 함수가 대신 읽어서
// 등록된 멤버 채널들의 최신 영상/숏츠를 모아 돌려준다.
// (유튜브 무료 RSS 피드 사용 — API 키 불필요)
//
// 입력(POST): { channels: [{member, channel}], kind: 'video' | 'short' }
// 출력: { videos: [{ id, title, author, published }] }
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const TIMEOUT_MS = 8000; // 8초 타임아웃

const J = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(obj) });

// 타임아웃이 적용된 fetch 래퍼
function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// 채널 입력값(URL / @핸들 / UC아이디)을 channel_id(UC...)로 변환
async function resolveChannelId(input) {
  let v = (input || '').trim();
  const ucMatch = v.match(/(UC[\w-]{20,})/);
  if (ucMatch) return ucMatch[1];                 // 이미 UC아이디 or /channel/UC... 포함
  // 핸들/사용자명 → 채널 페이지에서 channelId 추출
  let url;
  if (v.startsWith('http')) url = v;
  else if (v.startsWith('@')) url = 'https://www.youtube.com/' + v;
  else url = 'https://www.youtube.com/@' + v;
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const m = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/<meta itemprop="channelId" content="(UC[\w-]+)"/) || html.match(/href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function fetchChannelVideos(channelId, author) {
  try {
    const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const entries = xml.split('<entry>').slice(1);
    return entries.map(e => {
      const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
      const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
      const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
      return id ? { id, title, author, published } : null;
    }).filter(Boolean);
  } catch (e) { return []; }
}

// Shorts 여부 판별 (shorts URL이 200이면 숏츠, 아니면 일반영상)
async function isShort(id) {
  try {
    const r = await fetchWithTimeout('https://www.youtube.com/shorts/' + id, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.status === 200;
  } catch (e) { return false; }
}

exports.handler = async (event) => {
  // ── OPTIONS 프리플라이트 ──
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  if (event.httpMethod !== 'POST') return J(405, { videos: [], msg: 'POST 요청만 지원해요' });
  let channels = [], kind = 'video';
  try { const b = JSON.parse(event.body || '{}'); channels = b.channels || []; kind = b.kind || 'video'; } catch (e) {}

  // 모든 채널의 최신영상 수집
  let all = [];
  for (const c of channels) {
    const cid = await resolveChannelId(c.channel);
    if (!cid) continue;
    const vids = await fetchChannelVideos(cid, c.member || '');
    all = all.concat(vids);
  }
  // 최신순 정렬
  all.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  all = all.slice(0, 30);

  // 숏츠/일반 분류 (best-effort)
  const flags = await Promise.all(all.map(v => isShort(v.id)));
  const wantShort = kind === 'short';
  const filtered = all.filter((v, i) => flags[i] === wantShort).slice(0, 12);

  // 분류 결과가 비면 그냥 최신 영상이라도 보여줌
  return J(200, { videos: (filtered.length ? filtered : all.slice(0, 12)) });
};
