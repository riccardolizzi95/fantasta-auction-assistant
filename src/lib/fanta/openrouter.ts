/**
 * Chiamate a OpenRouter, con il conto sotto controllo.
 *
 * La voce di spesa dominante non e' il modello ma la ricerca web: OpenRouter la
 * fattura a risultato, e di default ne chiede cinque. Con un modello economico
 * la ricerca arriva a pesare piu' del dieci volte i token. Qui la si chiede
 * esplicitamente e con pochi risultati, invece di usare la scorciatoia ":online".
 */

/**
 * Modello di default, scelto misurando (vedi /api/model-bench).
 *
 * Sullo stesso compito — identificare sei giocatori dal nome abbreviato del
 * listone — Gemini Flash Lite azzecca quanto Haiku 4.5 a meta' prezzo e in meta'
 * tempo. I modelli cinesi costano ancora meno e a volte fanno meglio (GLM 5.3 ha
 * fatto 6 su 6 dove nessun altro arrivava a 5), ma non rispettano il formato in
 * modo affidabile: al giro successivo lo stesso modello tornava illeggibile.
 * In una catena automatica l'instabilita' costa piu' di quanto risparmi.
 */
export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

/**
 * Se la risposta del modello principale non si riesce a leggere, si riprova una
 * volta sola con questo. Costa di piu' ma non sbaglia il formato.
 */
export const FALLBACK_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Risultati web per chiamata.
 *
 * Per mesi il progetto ne ha chiesti due, convinto che OpenRouter li fatturasse
 * a risultato. `npm run check:bench` ha misurato il contrario, due volte: la
 * ricerca costa **$0.00700 fissi a richiesta**, identici con cinque risultati e
 * con dieci. Chiederne meno non risparmiava niente — pagava dieci prove e ne
 * usava due.
 */
const WEB_MAX_RESULTS = 10;

/**
 * Il motore di ricerca, scelto misurando.
 *
 * Sullo stesso compito, stesso modello, stesso prezzo di $0.00700: il motore di
 * default identifica 4,5 giocatori su 10, `exa` ne identifica 8,5. Lasciarlo
 * scegliere a OpenRouter costava meta' dei risultati per gli stessi soldi.
 *
 * Gli altri, misurati: `parallel` e `perplexity` costano $0.00500 — il 29% in
 * meno, non il 60% che il listino lascia sperare — e dimezzano i trovati.
 */
/**
 * Quale motore di ricerca usare, quando non si dice.
 *
 * OpenRouter ne offre diversi a prezzi molto diversi fra loro, e la ricerca web
 * e' la voce dominante del costo: e' il primo parametro da misurare, non da
 * scegliere per abitudine.
 */
export type WebEngine = "native" | "exa" | "firecrawl" | "parallel" | "perplexity";

/**
 * Il motore di ricerca, scelto misurando.
 *
 * Sullo stesso compito, stesso modello, stesso prezzo di $0.00700: il motore di
 * default identifica 4,5 giocatori su 10, `exa` ne identifica 8,5. Lasciarlo
 * scegliere a OpenRouter costava meta' dei risultati per gli stessi soldi.
 *
 * Gli altri, misurati: `parallel` e `perplexity` costano $0.00500 — il 29% in
 * meno, non il 60% che il listino lascia sperare — e dimezzano i trovati.
 */
const WEB_ENGINE: WebEngine = "exa";

/**
 * A quale fornitore far girare il modello.
 *
 * Lo stesso modello aperto e' servito da dieci infrastrutture a prezzi che
 * variano di sei volte: `openai/gpt-oss-20b` costa $0.020 per milione da
 * Darkbloom e $0.070 da Bedrock. Poter fissare il fornitore e' una leva di
 * costo a parita' di modello, oltre che il modo di provare Groq.
 */
export type ProviderRouting = {
  order?: string[];
  only?: string[];
  ignore?: string[];
  allow_fallbacks?: boolean;
  sort?: "price" | "throughput" | "latency";
};

export const openrouterModel = () => process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
export const openrouterFallback = () => process.env.OPENROUTER_FALLBACK_MODEL || FALLBACK_MODEL;

export type OpenRouterUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Chi ha davvero servito la richiesta: con il routing non e' scontato. */
  provider: string | null;
};

export type OpenRouterResult = {
  content: string;
  /** Costo effettivo della chiamata in dollari, riportato da OpenRouter. */
  cost: number | null;
  model: string;
  /**
   * Perche' il modello ha smesso di scrivere. "length" vuol dire che ha finito
   * il budget di token a meta' frase: la risposta non e' sbagliata, e' tagliata,
   * e sono due diagnosi diverse. Senza questa distinzione un tetto troppo basso
   * si presenta come un modello che non sa rispettare il formato, e si cerca il
   * problema dalla parte sbagliata.
   */
  finishReason: string | null;
  /**
   * Token consumati. Servono a scomporre il costo: OpenRouter riporta un totale
   * unico, e la quota della ricerca web si ricava solo togliendo i token
   * moltiplicati per il listino del modello.
   */
  usage: OpenRouterUsage;
};

export async function askOpenRouter(args: {
  prompt: string;
  web?: boolean;
  webResults?: number;
  maxTokens?: number;
  temperature?: number;
  /** Chiede al modello di rispondere in JSON, quando lo supporta. */
  json?: boolean;
  /** Solo per il banco di prova: normalmente si usa quello configurato. */
  model?: string;
  /** Motore di ricerca. Senza, quello di default di OpenRouter. */
  engine?: WebEngine;
  /** A quale fornitore far girare il modello. */
  provider?: ProviderRouting;
}): Promise<{ ok: true; data: OpenRouterResult } | { ok: false; error: string; status: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, error: "OPENROUTER_API_KEY non configurata.", };
  }
  const model = args.model ?? openrouterModel();

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "X-Title": "FantAsta",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: args.prompt }],
        temperature: args.temperature ?? 0.3,
        max_tokens: args.maxTokens ?? 700,
        // Fa tornare il costo reale della chiamata invece di doverlo stimare.
        usage: { include: true },
        // Diversi modelli economici ignorano "rispondi solo con JSON" e
        // incastonano la risposta in commenti o ragionamenti: chiederlo come
        // formato invece che a parole li rimette in riga.
        ...(args.json ? { response_format: { type: "json_object" } } : {}),
        ...(args.web
          ? {
              plugins: [
                {
                  id: "web",
                  max_results: args.webResults ?? WEB_MAX_RESULTS,
                  engine: args.engine ?? WEB_ENGINE,
                },
              ],
            }
          : {}),
        ...(args.provider ? { provider: args.provider } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Rete non raggiungibile: ${(e as Error).message}` };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: json?.error?.message ?? `OpenRouter ha risposto ${res.status}.`,
    };
  }

  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const cost = Number(json?.usage?.cost);
  return {
    ok: true,
    data: {
      content,
      cost: Number.isFinite(cost) ? cost : null,
      model,
      finishReason: json?.choices?.[0]?.finish_reason ?? null,
      usage: {
        promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
        completionTokens: Number(json?.usage?.completion_tokens ?? 0),
        provider: json?.provider ?? null,
      },
    },
  };
}

/**
 * Estrae il primo oggetto JSON da una risposta che potrebbe avere testo attorno.
 *
 * I modelli con ragionamento esplicito antepongono blocchi di pensiero pieni di
 * parentesi graffe: si scarta quella parte e si prova a chiudere il primo
 * oggetto bilanciato, invece di prendere dalla prima graffa all'ultima.
 */
export function extractJson<T>(content: string): T | null {
  const pulito = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");

  const tentativi: string[] = [];
  const primo = pulito.indexOf("{");
  if (primo >= 0) {
    tentativi.push(pulito.slice(primo));
    // Primo oggetto bilanciato, per le risposte con testo dopo.
    let livello = 0;
    for (let i = primo; i < pulito.length; i++) {
      if (pulito[i] === "{") livello++;
      else if (pulito[i] === "}" && --livello === 0) {
        tentativi.unshift(pulito.slice(primo, i + 1));
        break;
      }
    }
  }
  for (const t of tentativi) {
    try {
      return JSON.parse(t) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Chiede una risposta JSON e, se non si riesce a leggerla, riprova una volta con
 * il modello di ripiego. I modelli economici sbagliano il formato abbastanza
 * spesso da rendere il ritentativo piu' conveniente di una risposta persa.
 */
export async function askOpenRouterJson<T>(args: {
  prompt: string;
  web?: boolean;
  webResults?: number;
  maxTokens?: number;
  temperature?: number;
  engine?: WebEngine;
  provider?: ProviderRouting;
  /** Il modello da usare al primo tentativo. Senza, quello configurato. */
  model?: string;
}): Promise<
  | { ok: true; data: T; cost: number; model: string; retried: boolean }
  | { ok: false; error: string; status: number; cost: number }
> {
  let cost = 0;
  const modelli = [args.model ?? openrouterModel(), openrouterFallback()];
  let ultimoErrore = "Risposta del modello non interpretabile.";

  for (const [i, model] of modelli.entries()) {
    const answer = await askOpenRouter({ ...args, json: true, model });
    if (!answer.ok) {
      ultimoErrore = answer.error;
      continue;
    }
    cost += answer.data.cost ?? 0;
    const parsed = extractJson<T>(answer.data.content);
    if (parsed) {
      return { ok: true, data: parsed, cost, model: answer.data.model, retried: i > 0 };
    }
    // Una risposta tagliata a meta' non e' un problema di formato: e' un tetto
    // di token troppo basso, e cambiare modello non lo alza. Dirlo com'e' evita
    // di dare la colpa al modello e di spendere la chiamata di ripiego per
    // riavere lo stesso taglio.
    if (answer.data.finishReason === "length") {
      return {
        ok: false,
        status: 502,
        error: `${model} ha esaurito il budget di token a meta' risposta: alzare maxTokens.`,
        cost,
      };
    }
    ultimoErrore = `${model} ha risposto in un formato non leggibile.`;
    if (modelli[1] === modelli[0]) break;
  }
  return { ok: false, error: ultimoErrore, status: 502, cost };
}
