import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM_PROMPT = `Tu es le copilote stratégique de la direction commerciale d'Avranches Automatic (distributeur français de flippers — revendeur officiel Stern —, jeux d'arcade, grues et distributeurs automatiques). Tu reçois les données commerciales réelles agrégées (CA, clients, devis, stock). Tu raisonnes en dirigeant commercial : factuel, chiffré, direct. Chaque constat s'appuie sur un chiffre fourni ; chaque recommandation est actionnable (qui fait quoi, sur quel client/produit, pourquoi maintenant). Tu signales les limites des données quand c'est pertinent. Tu réponds en français, en Markdown clair. IMPORTANT : compare les années À PÉRIODE ÉGALE (v_gaia_ca_periode_egale), jamais année pleine vs année en cours.`;

async function loadData(admin: any) {
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  const [
    caMensuel,
    caPeriodeEgale,
    caFamille,
    caClientCurrent,
    caClientPrev,
    commandesEtat,
    stockValeur,
    devisRelance,
    clientsDormants,
    stockDormant,
  ] = await Promise.all([
    admin.from('v_gaia_ca_mensuel').select('*'),
    admin.from('v_gaia_ca_periode_egale').select('*'),
    admin.from('v_gaia_ca_famille').select('*'),
    admin.from('v_gaia_ca_client').select('*').eq('annee', currentYear).order('ca_ht', { ascending: false }).limit(15),
    admin.from('v_gaia_ca_client').select('*').eq('annee', prevYear).order('ca_ht', { ascending: false }).limit(15),
    admin.from('v_gaia_commandes_etat').select('*'),
    admin.from('v_gaia_stock_valeur').select('*'),
    admin.from('v_gaia_devis_a_relancer').select('*').order('montant_ht', { ascending: false }).limit(20),
    admin.from('v_gaia_clients_dormants').select('*').order('ca_n1', { ascending: false }).limit(20),
    admin.from('v_gaia_stock_dormant').select('*').order('valeur_achat', { ascending: false }).limit(20),
  ]);

  return {
    annee_courante: currentYear,
    annee_precedente: prevYear,
    ca_mensuel: caMensuel.data ?? [],
    ca_periode_egale: caPeriodeEgale.data ?? [],
    ca_famille: caFamille.data ?? [],
    top15_clients_annee_courante: caClientCurrent.data ?? [],
    top15_clients_annee_precedente: caClientPrev.data ?? [],
    commandes_etat: commandesEtat.data ?? [],
    stock_valeur: stockValeur.data ?? [],
    top20_devis_a_relancer: devisRelance.data ?? [],
    top20_clients_dormants: clientsDormants.data ?? [],
    top20_stock_dormant: stockDormant.data ?? [],
  };
}

async function callAnthropic(systemPrompt: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages,
  };
  const payloadStr = JSON.stringify(payload);
  const inputChars = payloadStr.length;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: payloadStr,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status} ${res.statusText}. Body: ${text}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Anthropic 200 mais JSON invalide. Body: ${text.slice(0, 1500)}`);
  }

  const parts = Array.isArray(json?.content) ? json.content : [];
  const markdown = parts
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('\n\n')
    .trim();

  const stopReason = json?.stop_reason ?? null;

  if (!markdown) {
    const rawJson = JSON.stringify(json).slice(0, 1500);
    throw new Error(`Anthropic 200 sans bloc texte. stop_reason=${stopReason}. JSON: ${rawJson}`);
  }

  return { markdown, stop_reason: stopReason, input_chars: inputChars };
}

async function callAnthropicStream(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    stream: true,
    system: systemPrompt,
    messages,
  };
  const payloadStr = JSON.stringify(payload);
  const inputChars = payloadStr.length;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let eventBuffer = '';
  let stopReason: string | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let heartbeat: number | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: gaia_start\ndata: ${JSON.stringify({ input_chars: inputChars })}\n\n`));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: gaia-heartbeat ${Date.now()}\n\n`));
        } catch {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      }, 10_000);

      try {
        const upstream = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: payloadStr,
        });

        if (!upstream.ok) {
          const body = await upstream.text();
          controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({
            error: `Anthropic HTTP ${upstream.status} ${upstream.statusText}. Body: ${body}`,
            status: upstream.status,
          })}\n\n`));
          controller.close();
          return;
        }
        if (!upstream.body) {
          controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({ error: 'Anthropic 200 sans flux de réponse' })}\n\n`));
          controller.close();
          return;
        }

        reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          eventBuffer += decoder.decode(value, { stream: true });
          const events = eventBuffer.split(/\r?\n\r?\n/);
          eventBuffer = events.pop() ?? '';
          inspectEvents(events.join('\n\n'));
        }
        eventBuffer += decoder.decode();
        inspectEvents(eventBuffer);
        controller.enqueue(encoder.encode(`\n\nevent: gaia_debug\ndata: ${JSON.stringify({ input_chars: inputChars, stop_reason: stopReason })}\n\n`));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`event: gaia_error\ndata: ${JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })}\n\n`));
        controller.close();
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
      }
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      reader?.cancel();
    },
  });

  function inspectEvents(raw: string) {
    for (const event of raw.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.type === 'message_delta' && parsed?.delta?.stop_reason != null) {
          stopReason = parsed.delta.stop_reason;
        }
      } catch {
        // Le flux original est relayé tel quel ; seuls les événements JSON complets sont inspectés.
      }
    }
  }

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'Unauthorized: missing bearer token' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, error: `Unauthorized: ${userErr?.message ?? 'session invalide'}` }, 401);
    }

    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleErr || !roleRow) {
      return jsonResponse({ ok: false, error: 'Forbidden: admin only' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body?.action;

    const admin = createClient(supabaseUrl, serviceKey);
    const data = await loadData(admin);
    const dataJson = JSON.stringify(data);

    let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (action === 'revue') {
      const userMsg = `Voici les données commerciales agrégées (JSON) :\n\n\`\`\`json\n${dataJson}\n\`\`\`\n\nRédige la revue commerciale du mois :\n1) santé globale (CA à période égale vs N-1/N-2, tendance mensuelle) ;\n2) mouvements marquants (familles et clients qui montent/descendent) ;\n3) risques ;\n4) TOP 5 des actions recommandées, priorisées par impact en euros (relances de devis nominatives, clients dormants à réactiver, stock à écouler).`;
      messages = [{ role: 'user', content: userMsg }];
    } else if (action === 'chat') {
      const question = typeof body?.question === 'string' ? body.question.trim() : '';
      if (!question) {
        return jsonResponse({ ok: false, error: 'question manquante' }, 400);
      }
      const history = Array.isArray(body?.history) ? body.history : [];
      const cleanHistory = history
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-6)
        .map((m: any) => ({ role: m.role, content: m.content }));

      const contextMsg = `Voici les données commerciales agrégées (JSON) à utiliser pour répondre :\n\n\`\`\`json\n${dataJson}\n\`\`\``;
      messages = [
        { role: 'user', content: contextMsg },
        { role: 'assistant', content: 'Données reçues. Je réponds en m\'appuyant sur ces chiffres.' },
        ...cleanHistory,
        { role: 'user', content: question },
      ];
    } else {
      return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);
    }

    if (action === 'revue') {
      return await callAnthropicStream(SYSTEM_PROMPT, messages);
    }

    const { markdown, stop_reason, input_chars } = await callAnthropic(SYSTEM_PROMPT, messages);
    return jsonResponse({ ok: true, markdown, debug: { input_chars, stop_reason } });

  } catch (e: any) {
    const status = Number.isInteger(e?.status) && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonResponse({ ok: false, error: e?.message ?? String(e) }, status);
  }
});
