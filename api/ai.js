export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "허용되지 않는 메서드" });
  }

  try {
    const DEEPSEEK_KEY = process.env.API_KEY_DEEPSEEK;

    if (!DEEPSEEK_KEY) {
      return res.status(500).json({ error: "API_KEY_DEEPSEEK 없음" });
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
        error: "DeepSeek 응답 JSON 파싱 실패",
        detail: rawText
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({
      error: "서버 내부 오류",
      detail: e.message
    });
  }
}
