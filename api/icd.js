// api/icd.js
// 목적: 약품의 식약처 공식 효능효과 텍스트(efcyQesitm)를 가져와서
//       그 안에 포함된 대표 상병코드(ICD-10/KCD)를 키워드 매칭으로 추출.
// 주의: 공식 API가 구조화된 ICD 코드를 직접 제공하지 않으므로,
//       이 결과는 여전히 "추정치"이며 참고용입니다.
// 설계 원칙: firebase-admin 등 외부 패키지 의존성 없음 (2026-07-15 사고 재발 방지).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const rawName = String(req.query.name || "").trim();
  if (!rawName) {
    return res.status(400).json({ error: "약품명을 입력해주세요", icd: [] });
  }

  const MFDS_KEY = process.env.API_KEY_MFDS || "";
  if (!MFDS_KEY) {
    // 키가 없어도 500으로 죽지 않고 빈 결과로 응답 (프론트가 안전하게 무시하도록)
    return res.status(200).json({ icd: [], efcy: "", note: "MFDS 키 없음" });
  }

  // 키워드 -> ICD 코드 매핑 (효능효과 원문 텍스트에서 매칭)
  const KEYWORD_MAP = [
    { kw: ["위식도역류", "역류성 식도염", "GERD"], code: "K21" },
    { kw: ["위궤양"], code: "K25" },
    { kw: ["십이지장궤양"], code: "K26" },
    { kw: ["소화성궤양"], code: "K27" },
    { kw: ["위염", "십이지장염"], code: "K29" },
    { kw: ["소화불량"], code: "K30" },
    { kw: ["알레르기성 비염", "알레르기 비염", "비염"], code: "J30" },
    { kw: ["두드러기", "담마진", "만성 특발성 두드러기"], code: "L50" },
    { kw: ["천식"], code: "J45" },
    { kw: ["고혈압"], code: "I10" },
    { kw: ["당뇨병", "제2형 당뇨"], code: "E11" },
    { kw: ["고지혈증", "이상지질혈증"], code: "E78" },
    { kw: ["편두통"], code: "G43" },
    { kw: ["불면증", "수면장애"], code: "G47" },
    { kw: ["우울증", "우울장애"], code: "F32" },
    { kw: ["불안장애"], code: "F41" },
    { kw: ["세균 감염", "세균감염증"], code: "A49" },
    { kw: ["요로감염"], code: "N39" },
    { kw: ["기관지염"], code: "J20" },
    { kw: ["폐렴"], code: "J18" },
    { kw: ["골관절염", "퇴행성 관절염"], code: "M17" },
    { kw: ["류마티스 관절염"], code: "M06" },
    { kw: ["통증", "동통"], code: "R52" },
    { kw: ["발열"], code: "R50" }
  ];

  function extractICD(text) {
    if (!text) return [];
    const found = [];
    for (const entry of KEYWORD_MAP) {
      if (entry.kw.some(k => text.includes(k))) {
        if (!found.includes(entry.code)) found.push(entry.code);
      }
      if (found.length >= 2) break;
    }
    return found.slice(0, 2);
  }

  try {
    const url = `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${MFDS_KEY}&itemName=${encodeURIComponent(rawName)}&pageNo=1&numOfRows=5&type=json`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    });
    const raw = await response.text();

    let data = null;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    if (!data) {
      return res.status(200).json({ icd: [], efcy: "", note: "응답 파싱 실패" });
    }

    const body = data?.body || data?.response?.body || {};
    let items = body?.items?.item || body?.items || [];
    if (!Array.isArray(items)) items = items ? [items] : [];

    const first = items[0] || {};
    const efcy = String(first.efcyQesitm || "").replace(/<[^>]+>/g, "").trim();
    const icd = extractICD(efcy);

    return res.status(200).json({ icd, efcy: efcy.substring(0, 200) });
  } catch (e) {
    // 어떤 에러가 나도 500으로 죽지 않고 빈 결과로 응답 (프론트 안전성 우선)
    return res.status(200).json({ icd: [], efcy: "", error: e.message });
  }
}
