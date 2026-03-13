export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: "약품명을 입력하세요" });
  }

  const key = process.env.API_KEY_HIRA;

  const url =
    `https://api.odcloud.kr/api/15067462/v1/uddi:456729a5-28ed-494d-b5a8-ba5000ebb6bab` +
    `?page=1&perPage=500&returnType=JSON&serviceKey=${key}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const list = data?.data || [];
    const keyword = String(name).replace(/\s+/g, "").toLowerCase();

    const items = list
      .filter((i) => {
        const itemName = String(i["한글상품명"] || "").replace(/\s+/g, "").toLowerCase();
        const company = String(i["업체명"] || "").replace(/\s+/g, "").toLowerCase();
        return itemName.includes(keyword) || company.includes(keyword);
      })
      .slice(0, 20);

    const result = items.map((i) => ({
      name: i["한글상품명"] || "-",
      company: i["업체명"] || "-",
      ediCode: i["표준코드"] || "-",
      price: i["제품총수량"] ?? "-"
    }));

    return res.status(200).json({ items: result });
  } catch (e) {
    return res.status(500).json({
      error: "HIRA API 실패",
      detail: e.message
    });
  }
}
