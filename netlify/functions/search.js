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

    const kidText = kids.map(k =>
      `- ${k.name}, age ${k.age}, interests: ${k.interests.join(", ")}, prefers: ${k.dayType}`
    ).join("\n");

    const prompt = `Search the web for real summer camps near ${location} for summer 2025. I need camps for these children:\n${kidText}\n\nSearch for camps matching their interests within 25 miles. Find real camps with actual websites, pricing, and registration info.\n\nAfter searching, return ONLY a JSON object like this (no markdown):\n{"camps":[{"id":"c1","name":"Real Camp Name","location":"City, NC","distance":"~3 miles","type":"Full Day","description":"What the camp offers","registrationOpen":true,"registrationUrl":"https://realsite.com","registrationDeadline":"May 30, 2025","schedule":"June 9 - Aug 8, Mon-Fri","dropoffTime":"9:00am","pickupTime":"4:00pm","providesLunch":false,"weeklyRate":"$250/week","weeklyRateNum":250,"beforeCareAvailable":true,"afterCareAvailable":true,"beforeCareRate":"$40/week","afterCareRate":"$50/week","beforeCareNum":40,"afterCareNum":50,"tags":["Swimming","Sports"],"matchedKids":[0,1]}]}`;

    let messages = [{ role: "user", content: prompt }];
    let finalData = null;

    // Loop up to 10 times to handle web search tool use
    for (let i = 0; i < 10; i++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
          messages
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || "API error" }) };
      }

      // If done, extract final text
      if (data.stop_reason === "end_turn") {
        finalData = data;
        break;
      }

      // If web search tool was used, continue the conversation
      if (data.stop_reason === "tool_use") {
        messages = [...messages, { role: "assistant", content: data.content }];
        // Add tool results back
        const toolResults = data.content
          .filter(b => b.type === "tool_use")
          .map(b => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: "Search completed"
          }));
        messages = [...messages, { role: "user", content: toolResults }];
        continue;
      }

      // Any other stop reason - treat as final
      finalData = data;
      break;
    }

    if (!finalData) {
      return { statusCode: 500, body: JSON.stringify({ error: "No response after search" }) };
    }

    // Extract the text response
    const textBlock = (finalData.content || []).filter(b => b.type === "text").pop();
    if (!textBlock) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text in response" }) };
    }

    // Parse the JSON from the response
    let jsonStr = textBlock.text.trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();

    let camps;
    try {
      const parsed = JSON.parse(jsonStr);
      camps = parsed.camps || parsed;
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Could not parse camps: " + jsonStr.slice(0, 200) }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ camps })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
