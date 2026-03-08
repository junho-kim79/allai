export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { name } = req.query;

  if (!name) {
    return res.status(400).json({
      error: "약품명을 입력해주세요"
    });
  }

  const key = process.env.API_KEY_MFDS || process.env["API_KEY_MFDS"];

  if (!key) {
    return res.status(500).json({
      error: "API_KEY_MFDS 환경변수가 없습니다"
    });
  }

  const url =
    `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList` +
    `?ServiceKey=${key}` +
    `&itemName=${encodeURIComponent(name)}` +
    `&type=json&numOfRows=20&pageNo=1`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });

    const raw = await response.text();
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return res.status(response.status).json({
        error: "공공데이터 API 응답 오류",
        status: response.status,
        contentType,
        preview: raw.slice(0, 1000),
        url
      });
    }

    if (!raw) {
      return res.status(502).json({
        error: "빈 응답",
        contentType,
        url
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({
        error: "JSON 파싱 실패",
        contentType,
        preview: raw.slice(0, 1000),
        url
      });
    }

    const body = data?.response?.body || data?.body || {};
    const items = body?.items?.item || body?.items || [];
    const list = Array.isArray(items) ? items : items ? [items] : [];

    return res.status(200).json({
      items: list,
      totalCount: Number(body?.totalCount || 0)
    });
  } catch (e) {
    return res.status(500).json({
      error: "API 호출 실패",
      detail: e.message
    });
  }
}
