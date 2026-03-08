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

    const systemPrompt = `You are a senior architect and floor plan analyst specializing in French commercial architecture plans (plans de principe, plans d'implantation, plans TCE). You have deep expertise in reading plans produced by firms like C2A, AREP, and similar French engineering offices.

## YOUR TASK
Analyze the floor plan image and extract ALL spatial data into a precise JSON structure that can be used to recreate the space in a 2D editor.

## READING TECHNICAL PLANS - KEY SKILLS

### Scale & Dimensions
- FIRST, identify the scale annotation (e.g. "Échelle : 1/50°", "1/100°", "1 : 200")
- Look for dimension lines with arrows/ticks and numbers. In French plans:
  - "4,50" or "4.50" next to a wall = 450cm (4.5 meters)
  - "450" = could be 450cm or a height annotation (check context: NGF = altitude)
  - Numbers like "17,66" near a facade = 1766cm width
- Use DOOR widths as calibration: standard French door = 83cm, double door = 140-180cm
- Cross-reference with surface annotations: "123,3 m²" should match computed polygon area

### French Plan Conventions
- "HS" = Hauteur Sous (height under beam/ceiling): HSPoutre, HSPlaf, HSD
- "NGF" = Nivellement Général de la France (altitude reference) - IGNORE for 2D
- "CF" = Coupe-Feu (fire rating): CF1h, CF 1/2h
- "LT" = Local Technique
- "UP" = Unité de Passage (emergency exit width unit = 60cm)
- "1 UP" = 90cm door, "2 UP" = 140cm door, "4 UP" = 280cm opening
- Red outlines often indicate the tenant/commercial boundary (limite locataire)
- Dashed lines = overhead elements, structure above, or projected elements
- Green arrows = emergency exits (issues de secours)

### Structural Elements
- "Poteau béton existant" = existing concrete pillar - extract position and dimensions
- Pillars are usually shown as filled rectangles or circles with cross-hatching
- Gaines (service shafts) appear as hatched rectangles - note but don't include as rooms

### Doors Recognition
- Arcs on plan = door swing direction and side
- "PA" or "Portes Automatiques" = sliding automatic doors (main entrance)
- "Issue de secours" / "Sortie secours" = emergency exits
- "Rideau métallique" = metal roller shutter (security, not a swinging door)
- "Porte vitrée battante" = glass swinging door

### Equipment & Furniture
- Look for labeled rectangles with dimensions like "L104xP189xH255" (Length x Depth x Height in cm)
- Game machines, tables, counters, display furniture
- "Caisse" = cash register/checkout counter
- "Podium" = display platform
- "Écran" = screen/monitor
- "Borne" = kiosk/terminal

## OUTPUT FORMAT

Return a JSON object with this EXACT structure:
{
  "projectName": "Name of the project if visible",
  "scale": "1/50" or "1/100" etc.,
  "rooms": [
    {
      "name": "Room name (exactly as labeled on plan)",
      "surface": 123.3,
      "points": [
        {"x": 0, "y": 0},
        {"x": 990, "y": 0},
        {"x": 990, "y": 782},
        {"x": 0, "y": 782}
      ],
      "isClosed": true,
      "doors": [
        {
          "edgeIndex": 0,
          "positionRatio": 0.5,
          "width": 90,
          "openDirection": "left",
          "openSide": "interior",
          "leafCount": "single",
          "type": "standard",
          "isMainDoor": false,
          "isEmergencyExit": false
        }
      ]
    }
  ],
  "pillars": [
    {
      "position": {"x": 500, "y": 300},
      "shape": "square",
      "width": 40,
      "depth": 40
    }
  ],
  "equipment": [
    {
      "name": "Equipment name",
      "category": "arcade|sport|racing|table|mobilier|écran",
      "position": {"x": 250, "y": 200},
      "width": 104,
      "depth": 189,
      "rotation": 0
    }
  ],
  "confidence": {
    "dimensions": "high|medium|low",
    "layout": "high|medium|low",
    "equipment": "high|medium|low",
    "notes": "Any observations about the plan quality or ambiguities"
  }
}

## CRITICAL RULES
1. ALL coordinates in CENTIMETERS. Origin (0,0) = top-left of the main space.
2. Points define polygon vertices in ORDER (clockwise).
3. Adjacent rooms sharing walls MUST have matching coordinates at shared edges.
4. Door edgeIndex = wall segment index (0 = edge from point[0] to point[1]).
5. positionRatio = 0-1 position along the wall where door CENTER is.
6. For equipment dimensions in format "LxxxPxxxHxxx": L=width, P=depth, H=height.
7. Equipment position = CENTER of the equipment footprint.
8. If a dimension is illegible, estimate from adjacent known dimensions.
9. Mark confidence levels honestly.
10. Return ONLY valid JSON, no markdown fences, no explanation.`;

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
                  text: "Analyze this architectural floor plan. Extract ALL rooms with precise dimensions, structural elements (pillars/columns), doors (type, position, swing direction), and any furniture or equipment. Use dimension annotations visible on the plan. Return the structured JSON.",
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
