import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) throw new Error("No image provided");

    const systemPrompt = `You are an expert floor plan analyzer. Given an image of a floor plan, extract all rooms, walls, and doors.

Return a JSON object with this EXACT structure:
{
  "rooms": [
    {
      "name": "Room name (e.g. Salon, Cuisine, Chambre)",
      "points": [
        {"x": 0, "y": 0},
        {"x": 500, "y": 0},
        {"x": 500, "y": 400},
        {"x": 0, "y": 400}
      ],
      "isClosed": true,
      "doors": [
        {
          "edgeIndex": 0,
          "positionRatio": 0.5,
          "width": 90,
          "openDirection": "left",
          "openSide": "interior",
          "leafCount": "single"
        }
      ]
    }
  ]
}

CRITICAL RULES:
- All coordinates are in CENTIMETERS. A typical room is 300-600cm wide.
- Points define the polygon vertices of each room in order (clockwise or counter-clockwise).
- Position the rooms relative to each other as they appear on the plan.
- Use (0,0) as the top-left reference point of the overall plan.
- edgeIndex is the wall index (0 = first wall between point[0] and point[1]).
- positionRatio is 0-1 along the wall where the door center is.
- Standard door width is 80-90cm.
- If dimensions are visible on the plan, use them. Otherwise estimate from proportions.
- Always set isClosed to true for complete rooms.
- Return ONLY the JSON, no markdown, no explanation.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this floor plan image. Extract all rooms with their dimensions, walls and doors. Return the JSON structure as specified.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte, réessayez dans un moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits insuffisants. Ajoutez des crédits à votre workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI model");
    }

    // Parse the JSON from the AI response (strip markdown code fences if present)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const planData = JSON.parse(jsonStr);

    return new Response(JSON.stringify(planData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-plan error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
