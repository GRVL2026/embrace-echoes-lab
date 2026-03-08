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

    const systemPrompt = `You are an expert floor plan analyzer and architect. Given an image of a floor plan, extract ALL rooms, walls, doors, AND any visible furniture or equipment.

Return a JSON object with this EXACT structure:
{
  "rooms": [
    {
      "name": "Room name (e.g. Salon, Cuisine, Chambre, Salle d'arcade)",
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
  ],
  "equipment": [
    {
      "name": "Name of the furniture/equipment",
      "category": "Category (e.g. arcade, billard, mobilier, bar, comptoir)",
      "position": {"x": 250, "y": 200},
      "width": 120,
      "depth": 80,
      "rotation": 0
    }
  ],
  "scale": {
    "pixelReference": 100,
    "cmReference": 200,
    "confidence": "high"
  }
}

CRITICAL DIMENSION RULES:
- All coordinates and dimensions are in CENTIMETERS.
- LOOK CAREFULLY for dimension annotations on the plan (numbers with arrows, lines with measurements).
- If you see dimensions like "4.50" or "4,50" next to a wall, that means 450cm (4.5 meters).
- If you see dimensions like "450" next to a wall, that means 450cm.
- If a legend or scale bar is visible, use it to calibrate ALL measurements.
- A standard door is 80-90cm wide. Use visible doors as a secondary scale reference.
- Typical room sizes: bedroom 9-15m², living room 15-35m², kitchen 8-15m², bathroom 4-8m².
- Cross-check your extracted dimensions against these typical sizes.
- If no dimensions are visible, estimate from proportions using door widths as reference (standard 83cm).

ROOM EXTRACTION RULES:
- Points define the polygon vertices of each room in ORDER (clockwise or counter-clockwise).
- Position rooms relative to each other as they appear on the plan.
- Use (0,0) as the top-left reference point of the overall plan.
- Shared walls between adjacent rooms should have EXACTLY matching coordinates.
- edgeIndex is the wall index (0 = first wall between point[0] and point[1]).
- positionRatio is 0-1 along the wall where the door center is.
- Always set isClosed to true for complete rooms.

EQUIPMENT EXTRACTION RULES:
- Identify any furniture, game machines, tables, counters, bars visible on the plan.
- Position is the CENTER of the equipment in cm, relative to the same (0,0) origin.
- Estimate width (along X) and depth (along Y) in cm.
- Rotation in degrees (0 = aligned with axes, 90 = rotated).
- Common arcade equipment: borne d'arcade (~70x80cm), billard (~130x250cm), baby-foot (~80x150cm), flipper (~70x140cm), air hockey (~120x210cm).

SCALE OBJECT:
- If you found a scale reference, indicate it. confidence: "high" if explicit dimensions are shown, "medium" if inferred from doors/objects, "low" if purely estimated.

Return ONLY the JSON, no markdown, no explanation.`;

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
                  text: "Analyze this floor plan image carefully. Extract ALL rooms with precise dimensions, walls, doors, and any visible furniture or equipment. If dimension annotations are visible, use them. Return the JSON structure as specified.",
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
