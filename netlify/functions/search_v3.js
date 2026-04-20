exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  try {
    const { location, kids } = JSON.parse(event.body);

    // Keep prompt short to avoid rate limits
    const interests = [...new Set(kids.flatMap(k => k.interests))].slice(0, 5).join(", ");
    const ages = kids.map(k => k.age || "school-age").join(" and ");

    const prompt = `Search for 4 real summer camps near ${location} for kids ages ${ages} interested in ${interests}. Return ONLY this JSON:\n{"camps":[{"id":"c1","name":"","location":"","distance":"","type":"Full Day","description":"","registrationOpen":true,"registrationUrl":"","schedule":"","dropoffTime":"9:00am","pickupTime":"4:00pm","providesLunch":false,"weeklyRate":"","weeklyRateNum":0,"beforeCareAvailable":false,"afterCareAvailable":false,"beforeCareRate":null,"afterCareRate":null,"beforeCareNum":0,"afterCareNum":0,"tags":[],"matchedKids":[0]}]}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || "API error" }) };
    }

    // Handle tool use - loop if needed
    let messages = [{ role: "user", content: prompt }];
    let finalData = data;

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });
      const toolResults = data.content
        .filter(b => b.type === "tool_use")
        .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search completed" }));
      messages.push({ role: "user", content: toolResults });

      const response2 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
          messages
        })
      });
      finalData = await response2.json();
    }

    const textBlock = (finalData.content || []).filter(b => b.type === "text").pop();
    if (!textBlock) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text response" }) };
    }

    let jsonStr = textBlock.text.trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

    // Find JSON object in response
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1);
    }

    let parsed;
    try { parsed = JSON.parse(jsonStr); }
    catch (e) { return { statusCode: 500, body: JSON.stringify({ error: "Parse failed: " + jsonStr.slice(0, 100) }) }; }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ camps: parsed.camps || [] })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
