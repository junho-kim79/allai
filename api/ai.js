import { sa, sha, fsGet, fsInc } from "./_fs.js";

/* ── AI 사용 횟수 (서버 카운팅) ──
   Vercel 환경변수 AI_LIMIT_ON=1 일 때만 제한 (기본은 꺼짐 = 무제한, 앱의 PAYWALL_ON과 같이 켜기)
   · 세는 종류: summary(약품 AI 요약), newopen(신규 개원 첫 방문 멘트) — 경쟁품 비교 등은 안 셈
   · 기기별 하루 AI_FREE_PER_DAY회(기본 3) + 같은 IP 하루 IP_CAP회(기본 40) 안전장치
   · 얼리버드 회원/PRO(Firestore members)는 무제한
   · Firestore 설정이 없거나 오류면 막지 않음(fail-open) */
const COUNTED = new Set(["summary", "newopen"]);
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(allai\.ai\.kr|vercel\.app)$|^https?:\/\/localhost(:\d+)?$/;
function kstDay() { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); }
async function quota(req) {
  const kind = String(req.headers["x-allai-kind"] || "");
  if (process.env.AI_LIMIT_ON !== "1" || !COUNTED.has(kind)) return { skip: true };
  const acc = sa(); if (!acc) return { skip: true };
  const limit = Number(process.env.AI_FREE_PER_DAY || 3), ipCap = Number(process.env.IP_CAP || 40);
  const dev = String(req.headers["x-allai-dev"] || "").slice(0, 64);
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const member = String(req.headers["x-allai-member"] || "").toLowerCase().trim();
  try {
    if (member) { const m = await fsGet(acc, `members/${sha(member)}`); if (m && /founder|pro|early/.test(m.tier?.stringValue || "")) return { skip: true, pro: true }; }
    const day = kstDay();
    const devPath = `aiUsage/${day}_d_${sha(dev || ip)}`, ipPath = `aiUsage/${day}_ip_${sha(ip)}`;
    const [d, i] = await Promise.all([fsGet(acc, devPath), fsGet(acc, ipPath)]);
    const used = Number(d?.n?.integerValue || 0), ipUsed = Number(i?.n?.integerValue || 0);
    if (used >= limit || ipUsed >= ipCap) return { block: true, used, limit };
    return { acc, devPath, ipPath, used, limit };
  } catch { return { skip: true }; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Allai-Kind, X-Allai-Dev, X-Allai-Member");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "허용되지 않는 메서드" });
  }

  // 다른 사이트에서 이 AI 주소를 가져다 쓰는 것 차단
  const origin = String(req.headers.origin || "");
  if (/^https?:\/\//.test(origin) && !ALLOWED_ORIGIN.test(origin)) return res.status(403).json({ error: "forbidden" });

  const q = await quota(req);
  if (q.block) return res.status(429).json({ error: "limit", used: q.used, limit: q.limit });

  try {
    const DEEPSEEK_KEY =
      process.env.DEEPSEEK_API_KEY || process.env.API_KEY_DEEPSEEK;

    if (!DEEPSEEK_KEY) {
      return res.status(500).json({
        error: "DeepSeek 환경변수 없음",
        has_DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
        has_API_KEY_DEEPSEEK: !!process.env.API_KEY_DEEPSEEK
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { prompt, maxTokens = 600 } = body || {};

    if (!prompt) {
      return res.status(400).json({ error: "prompt 없음" });
    }

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const rawText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DeepSeek API 오류",
        status: response.status,
        detail: rawText
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(500).json({
        error: "DeepSeek 응답 파싱 실패",
        detail: rawText
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (q.acc && text) { try { await Promise.all([fsInc(q.acc, q.devPath), fsInc(q.acc, q.ipPath)]); } catch {} }
    return res.status(200).json({ text, ...(q.acc ? { used: q.used + 1, limit: q.limit } : {}), ...(q.pro ? { pro: true } : {}) });
  } catch (e) {
    return res.status(500).json({
      error: "server catch",
      detail: e.message
    });
  }
}
