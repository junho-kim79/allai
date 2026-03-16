/**
 * 웹서치 API
 * 지원 서비스: Serper.dev (SERPER_API_KEY), Brave Search (BRAVE_API_KEY)
 * 한국 의약품 급여/이슈/임상재평가 실시간 검색
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const query = String(req.query.q || req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "q 파라미터가 필요합니다" });

  const SERPER_KEY = process.env.SERPER_API_KEY;
  const BRAVE_KEY  = process.env.BRAVE_API_KEY;

  // Serper.dev 우선 사용
  if (SERPER_KEY) {
    try {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: query, gl: "kr", hl: "ko", num: 5 })
      });
      const data = await r.json();
      const results = (data.organic || []).slice(0, 5).map(item => ({
        title:   item.title   || "",
        snippet: item.snippet || "",
        link:    item.link    || ""
      }));
      return res.status(200).json({ results, source: "serper" });
    } catch (e) {
      // Serper 실패 시 Brave로 fallback
    }
  }

  // Brave Search fallback
  if (BRAVE_KEY) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&country=kr&search_lang=ko`;
      const r = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": BRAVE_KEY
        }
      });
      const data = await r.json();
      const results = (data.web?.results || []).slice(0, 5).map(item => ({
        title:   item.title       || "",
        snippet: item.description || "",
        link:    item.url         || ""
      }));
      return res.status(200).json({ results, source: "brave" });
    } catch (e) {
      return res.status(200).json({ results: [], error: e.message });
    }
  }

  // API 키 없음 → 빈 결과 반환 (오류 아님, AI는 계속 동작)
  return res.status(200).json({ results: [], message: "검색 API 키 미설정 (SERPER_API_KEY 또는 BRAVE_API_KEY)" });
}
