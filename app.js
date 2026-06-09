/* ===================================================
   AD SCRIPT BUILDER — Application Logic
   5-Step Pipeline: Parse → Plan → AI Voiceover → AI Veo → Validate
   Uses Gemini API for genuinely creative, brand-specific output
   =================================================== */

// ─── Example Brief ───────────────────────────────────
const EXAMPLE_BRIEF = `Brand: Aura Skincare
Product: Hydrating Serum with Hyaluronic Acid — a lightweight daily serum that locks in 72-hour moisture for plump, dewy skin.
Price: $34.99
Target Audience: Women 25–40, urban professionals who value clean beauty and minimal routines.
Tone: Calm confidence — soft but assertive, like a whispered promise. Sophisticated serenity.
Duration: 30 seconds`;

// ─── Constants ───────────────────────────────────────
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const API_KEY_STORAGE_KEY = 'adscript_gemini_api_key';

// ─── DOM References ──────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  modeRaw: $('#mode-raw'),
  modeFields: $('#mode-fields'),
  rawMode: $('#raw-mode'),
  fieldsMode: $('#fields-mode'),
  rawBrief: $('#raw-brief'),
  charCount: $('#char-count'),
  loadExample: $('#load-example'),
  btnGenerate: $('#btn-generate'),
  inputSection: $('#input-section'),
  outputSection: $('#output-section'),
  pipeline: $('#pipeline'),
  parsedBrief: $('#parsed-brief'),
  briefChips: $('#brief-chips'),
  validationResult: $('#validation-result'),
  sceneCards: $('#scene-cards'),
  outputActions: $('#output-actions'),
  btnCopy: $('#btn-copy'),
  btnDownload: $('#btn-download'),
  btnNew: $('#btn-new'),
  navLinks: $$('.nav-link'),
  toastContainer: $('#toast-container'),
  // Field mode inputs
  fieldBrand: $('#field-brand'),
  fieldProduct: $('#field-product'),
  fieldPrice: $('#field-price'),
  fieldAudience: $('#field-audience'),
  fieldTone: $('#field-tone'),
  fieldDuration: $('#field-duration'),
  // AI settings
  aiSettings: $('#ai-settings'),
  aiSettingsToggle: $('#ai-settings-toggle'),
  aiSettingsBody: $('#ai-settings-body'),
  apiKey: $('#api-key'),
  btnToggleKey: $('#btn-toggle-key'),
  apiStatus: $('#api-status'),
  btnTestKey: $('#btn-test-key'),
  apiDiagnostic: $('#api-diagnostic'),
};

let currentMode = 'raw';
let generatedScript = null;
let cooldownUntil = 0; // timestamp when rate limit cooldown ends

// ─── Utility ─────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showToast(message, type = 'default') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function switchSection(target) {
  dom.inputSection.classList.toggle('visible', target === 'input');
  dom.outputSection.classList.toggle('visible', target === 'output');
  dom.navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.section === target);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── AI Settings Panel ──────────────────────────────
// Load saved API key
const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
if (savedKey) {
  dom.apiKey.value = savedKey;
  dom.apiStatus.textContent = '● Key saved';
  dom.apiStatus.className = 'api-status connected';
}

// Toggle panel open/close — start open if no key saved
if (!savedKey) {
  dom.aiSettings.classList.add('open');
}

dom.aiSettingsToggle.addEventListener('click', () => {
  dom.aiSettings.classList.toggle('open');
});

// Show/hide API key
dom.btnToggleKey.addEventListener('click', () => {
  const isPassword = dom.apiKey.type === 'password';
  dom.apiKey.type = isPassword ? 'text' : 'password';
});

// Save API key on change
dom.apiKey.addEventListener('input', () => {
  const key = dom.apiKey.value.trim();
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    dom.apiStatus.textContent = '● Key saved';
    dom.apiStatus.className = 'api-status connected';
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    dom.apiStatus.textContent = '';
    dom.apiStatus.className = 'api-status';
  }
});

// ─── Test API Key — full diagnostic ─────────────────
dom.btnTestKey.addEventListener('click', async () => {
  const apiKey = dom.apiKey.value.trim();
  const diag = dom.apiDiagnostic;

  if (!apiKey) {
    showToast('Enter an API key first.', 'default');
    return;
  }

  diag.style.display = '';
  diag.innerHTML = '<span class="diag-label">Testing API key...</span>';
  dom.btnTestKey.disabled = true;
  dom.btnTestKey.textContent = 'Testing…';

  let html = '';
  html += '<span class="diag-label">API Key</span>';
  html += `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)} (${apiKey.length} chars)\n`;

  // Test each model with a minimal request
  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    html += `<span class="diag-label">Model: ${model}</span>`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say hello in exactly 3 words.' }] }],
          generationConfig: { maxOutputTokens: 20 },
        }),
      });

      const status = res.status;
      const statusText = res.statusText;

      // Capture relevant headers
      const rateLimitHeaders = {};
      for (const [key, val] of res.headers.entries()) {
        if (key.includes('rate') || key.includes('retry') || key.includes('quota') || key.includes('limit')) {
          rateLimitHeaders[key] = val;
        }
      }

      const body = await res.text();
      let bodyParsed;
      try { bodyParsed = JSON.parse(body); } catch { bodyParsed = null; }

      if (res.ok) {
        const reply = bodyParsed?.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
        html += `<span class="diag-ok">✓ ${status} OK</span>\n`;
        html += `Response: "${reply.trim()}"\n`;
      } else {
        const errMsg = bodyParsed?.error?.message || body.substring(0, 300);
        const errCode = bodyParsed?.error?.code || status;
        const errStatus = bodyParsed?.error?.status || statusText;
        html += `<span class="diag-err">✗ ${errCode} ${errStatus}</span>\n`;
        html += `Error: ${errMsg}\n`;
      }

      if (Object.keys(rateLimitHeaders).length > 0) {
        html += `Rate headers: ${JSON.stringify(rateLimitHeaders)}\n`;
      }

    } catch (networkErr) {
      html += `<span class="diag-err">✗ Network error: ${networkErr.message}</span>\n`;
    }
  }

  // Also test if the API is reachable at all
  html += '<span class="diag-label">List Models Endpoint</span>';
  try {
    const listRes = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`);
    const listBody = await listRes.json();
    if (listRes.ok && listBody.models) {
      const modelNames = listBody.models.slice(0, 5).map(m => m.name).join(', ');
      html += `<span class="diag-ok">✓ ${listRes.status} OK — ${listBody.models.length} models available</span>\n`;
      html += `First 5: ${modelNames}\n`;
    } else {
      html += `<span class="diag-err">✗ ${listRes.status}: ${listBody?.error?.message || 'Unknown error'}</span>\n`;
    }
  } catch (e) {
    html += `<span class="diag-err">✗ Network error: ${e.message}</span>\n`;
  }

  html += '<span class="diag-label">Timestamp</span>';
  html += new Date().toISOString();

  diag.innerHTML = html;
  dom.btnTestKey.disabled = false;
  dom.btnTestKey.textContent = 'Test Key';

  // Update status based on results
  if (html.includes('diag-ok')) {
    dom.apiStatus.textContent = '● Key valid';
    dom.apiStatus.className = 'api-status connected';
  } else {
    dom.apiStatus.textContent = '● All models failed';
    dom.apiStatus.className = 'api-status error';
  }
});

// ─── Input Mode Toggle ──────────────────────────────
dom.modeRaw.addEventListener('click', () => {
  currentMode = 'raw';
  dom.modeRaw.classList.add('active');
  dom.modeFields.classList.remove('active');
  dom.rawMode.style.display = '';
  dom.fieldsMode.style.display = 'none';
});

dom.modeFields.addEventListener('click', () => {
  currentMode = 'fields';
  dom.modeFields.classList.add('active');
  dom.modeRaw.classList.remove('active');
  dom.fieldsMode.style.display = '';
  dom.rawMode.style.display = 'none';
});

// ─── Character Count ────────────────────────────────
dom.rawBrief.addEventListener('input', () => {
  dom.charCount.textContent = `${dom.rawBrief.value.length} characters`;
});

// ─── Load Example ───────────────────────────────────
dom.loadExample.addEventListener('click', () => {
  dom.rawBrief.value = EXAMPLE_BRIEF;
  dom.charCount.textContent = `${EXAMPLE_BRIEF.length} characters`;
  dom.rawBrief.focus();
});

// ─── Nav Links ──────────────────────────────────────
dom.navLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection(link.dataset.section);
  });
});

// ═══════════════════════════════════════════════════
// STEP 1: BRIEF PARSER
// ═══════════════════════════════════════════════════
function parseBrief(input) {
  const text = input.trim();

  function extract(label, fallback = '') {
    const patterns = [
      new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:\\-—]\\s*(.+?)\\s*(?=\\n\\s*(?:Brand|Product|Price|Target|Audience|Tone|Emotional|Duration)\\s*[:\\-—]|$)`, 'is'),
      new RegExp(`(?:${label})\\s*[:\\-—]\\s*(.+?)\\s*$`, 'im'),
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1]) return m[1].trim();
    }
    return fallback;
  }

  const brand = extract('Brand(?:\\s*Name)?');
  const product = extract('Product(?:\\s*Description)?');
  const price = extract('Price');
  const audience = extract('Target\\s*Audience|Audience');
  const tone = extract('Tone(?:\\/Emotional\\s*Direction)?|Emotional\\s*Direction');
  const durationRaw = extract('Duration');

  let duration = 0;
  const durMatch = durationRaw.match(/(\d+)\s*(?:s(?:ec(?:ond)?s?)?)?/i);
  if (durMatch) {
    duration = parseInt(durMatch[1], 10);
  }

  return { brand, product, price, audience, tone, duration, durationRaw };
}

function getInputData() {
  if (currentMode === 'raw') {
    return dom.rawBrief.value;
  } else {
    const durVal = dom.fieldDuration.value.trim();
    const dur = durVal ? `${durVal} seconds` : '';
    return [
      `Brand: ${dom.fieldBrand.value.trim()}`,
      `Product: ${dom.fieldProduct.value.trim()}`,
      `Price: ${dom.fieldPrice.value.trim()}`,
      `Target Audience: ${dom.fieldAudience.value.trim()}`,
      `Tone: ${dom.fieldTone.value.trim()}`,
      `Duration: ${dur}`,
    ].join('\n');
  }
}

// ═══════════════════════════════════════════════════
// STEP 2: SCENE PLANNER
// ═══════════════════════════════════════════════════
function planScenes(brief) {
  const total = brief.duration;

  if (total <= 0) {
    return { scenes: [], error: 'Duration must be a positive number of seconds.' };
  }

  let hookDur, ctaDur, buildDur, payoffDur;

  if (total <= 10) {
    hookDur = Math.min(3, total);
    ctaDur = Math.min(3, total - hookDur);
    const remainder = total - hookDur - ctaDur;
    buildDur = Math.ceil(remainder / 2);
    payoffDur = remainder - buildDur;
  } else if (total <= 20) {
    hookDur = 4;
    ctaDur = 4;
    const remainder = total - hookDur - ctaDur;
    buildDur = Math.ceil(remainder * 0.55);
    payoffDur = remainder - buildDur;
  } else {
    hookDur = 5;
    ctaDur = Math.min(5, Math.round(total * 0.14));
    if (ctaDur < 3) ctaDur = 3;
    const remainder = total - hookDur - ctaDur;
    buildDur = Math.round(remainder * 0.5);
    payoffDur = remainder - buildDur;
  }

  if (hookDur > 5) hookDur = 5;

  const allocated = hookDur + buildDur + payoffDur + ctaDur;
  if (allocated !== total) {
    buildDur += total - allocated;
  }

  const scenes = [
    { label: 'HOOK', number: 1, duration: hookDur },
    { label: 'BUILD', number: 2, duration: buildDur },
    { label: 'PAYOFF', number: 3, duration: payoffDur },
    { label: 'CTA', number: 4, duration: ctaDur },
  ];

  if (total > 45 && buildDur > 10) {
    const build1 = Math.ceil(buildDur / 2);
    const build2 = buildDur - build1;
    scenes.splice(1, 1,
      { label: 'BUILD', number: 2, duration: build1 },
      { label: 'BUILD', number: 3, duration: build2 },
    );
    scenes.forEach((s, i) => (s.number = i + 1));
  }

  return { scenes, error: null };
}

// ═══════════════════════════════════════════════════
// STEPS 3 & 4: GEMINI AI — Voiceover + Veo Prompt
// ═══════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a world-class advertising creative director and copywriter who specializes in writing video ad scripts for Google Veo AI generation.

You will receive a brand brief and a scene plan. Your job is to write a complete ad script with a voiceover line and a Veo visual prompt for each scene.

## CRITICAL RULES FOR VOICEOVER

1. **Brand specificity is mandatory.** Every voiceover line must contain details so specific to THIS brand that the line could NOT work for any other product. Reference the actual product name, specific ingredients, exact claims, real benefits, the brand name, the price, or the target audience's specific lifestyle.

2. **Never write generic marketing copy.** Lines like "Your skin has been waiting for this" or "Experience the difference" are BANNED. These could apply to any brand and are worthless.

3. **Follow the emotional arc precisely:**
   - HOOK: Grab attention with the brand's single most compelling, specific claim or angle. Make the viewer unable to scroll past. Use the product's actual numbers, ingredients, or unique differentiator.
   - BUILD: Educate about what makes THIS product different. Reference real ingredients, real science, real materials, real process. Speak to the specific audience's values and lifestyle.
   - PAYOFF: Deliver the emotional climax tied to this brand's specific promise. Connect the product's concrete benefits to how the audience will feel.
   - CTA: Drive action with the brand name, price (if given), and a specific call to action. Tell them exactly what to do.

4. **Match the tone exactly.** If the brief says "calm confidence," every word choice must reflect that — sentence rhythm, vocabulary, intensity. Don't just pick synonyms; embody the tone's energy level, pacing, and personality.

5. **Word count must match duration.** Aim for approximately 2.5 words per second. A 5-second scene gets ~12 words. A 10-second scene gets ~25 words. Do NOT write too much or too little.

## CRITICAL RULES FOR VEO PROMPTS

1. **Every word must describe something Veo can visually render.** No metaphors, no emotions, no abstract concepts. Only concrete visual elements.

2. **Required format for each prompt:** Subject (what we see) + Action (what's happening) + Camera movement (dolly, crane, orbital, push-in, tracking, etc.) + Lighting (specific light source and quality) + Mood/atmosphere (visual atmosphere only) + Color palette + Technical specs.

3. **Be specific to the product category.** A serum prompt should describe liquid viscosity, glass bottles, droplets. A sneaker prompt should describe textile weave, sole tread, lacing. A tech product should describe machined edges, screen reflections, LED indicators.

4. **Match the visual language to the tone:**
   - Calm → soft diffused light, slow movements, muted tones, negative space
   - Bold → high contrast, dynamic angles, saturated colors, sharp movements
   - Luxury → rim lighting, dark backgrounds, gold accents, deliberate slowness
   - Playful → bright colors, bouncy movements, colorful backgrounds
   - Warm → practical lighting, amber tones, natural settings

5. **Always end with:** photorealistic, 4K, [duration] seconds, 24fps cinematic

6. **Ban list:** Do NOT use these words/phrases: "showcasing", "highlighting", "conveying", "representing", "symbolizing", "evoking", "suggesting", "implying". These are abstract and Veo cannot render them.

## OUTPUT FORMAT

Return a valid JSON array. Each element corresponds to one scene (in order) and must have exactly two fields:
- "voiceover": the spoken voiceover line (a string)
- "veo_prompt": the Veo-ready visual prompt (a string)

Return ONLY the JSON array. No markdown, no code fences, no explanation.`;

async function callGeminiAPI(brief, scenes, updateStatus) {
  const apiKey = dom.apiKey.value.trim();

  if (!apiKey) {
    throw new Error('Please enter your Gemini API key in the AI Settings panel above.');
  }

  // Build the user prompt with full brief and scene plan
  const scenePlanText = scenes.map((s) =>
    `Scene ${s.number} [${s.label}] — ${s.duration}s (~${Math.round(s.duration * 2.5)} words for voiceover)`
  ).join('\n');

  const userPrompt = `BRAND BRIEF:
Brand Name: ${brief.brand}
Product: ${brief.product}
Price: ${brief.price || 'Not specified'}
Target Audience: ${brief.audience}
Tone / Emotional Direction: ${brief.tone}
Total Duration: ${brief.duration} seconds

SCENE PLAN:
${scenePlanText}

Write the voiceover and Veo prompt for each scene. Remember: every line must be so specific to "${brief.brand}" and "${brief.product}" that it could NOT be reused for any other brand or product. Embody the "${brief.tone}" tone in every word choice.`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  };

  // Try each model in order until one works
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    console.log(`[Ad Script Builder] Trying model: ${model}`);
    if (updateStatus) updateStatus(`Trying ${model}…`);

    // Retry with exponential backoff for rate limits
    const MAX_RETRIES = 2;
    const BASE_DELAY_MS = 5000;

    let modelWorked = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        console.log(`[Ad Script Builder] ${model} attempt ${attempt}: HTTP ${response.status}`);

        if (response.ok) {
          const data = await response.json();
          const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!generatedText) {
            console.warn(`[Ad Script Builder] ${model}: Empty response body`, data);
            lastError = new Error(`${model} returned an empty response.`);
            break; // try next model
          }

          let cleanedText = generatedText.trim();
          if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
          }

          let parsed;
          try {
            parsed = JSON.parse(cleanedText);
          } catch (e) {
            console.error(`[Ad Script Builder] ${model}: JSON parse failed`, cleanedText);
            lastError = new Error('Failed to parse AI response.');
            break; // try next model
          }

          if (!Array.isArray(parsed) || parsed.length !== scenes.length) {
            lastError = new Error(`AI returned ${Array.isArray(parsed) ? parsed.length : 0} scenes but expected ${scenes.length}.`);
            break;
          }

          for (let i = 0; i < parsed.length; i++) {
            if (!parsed[i].voiceover || !parsed[i].veo_prompt) {
              lastError = new Error(`Scene ${i + 1} missing voiceover or veo_prompt.`);
              break;
            }
          }

          if (lastError && lastError.message.includes('missing')) break;

          console.log(`[Ad Script Builder] ✓ Success with ${model}`);
          dom.apiStatus.textContent = `● ${model}`;
          dom.apiStatus.className = 'api-status connected';
          return parsed;
        }

        // Handle error responses
        const errorBody = await response.text();
        let errorData;
        try { errorData = JSON.parse(errorBody); } catch { errorData = { rawBody: errorBody.substring(0, 500) }; }

        const errorMessage = errorData?.error?.message || `HTTP ${response.status}`;
        console.error(`[Ad Script Builder] ${model} error:`, {
          status: response.status,
          statusText: response.statusText,
          keyUsed: `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`,
          error: errorData?.error || errorBody.substring(0, 500),
        });

        if (response.status === 400) {
          // Don't hard-fail — try next model. Could be unsupported param, not invalid key.
          console.warn(`[Ad Script Builder] ${model}: 400 error, trying next model. Message: ${errorMessage}`);
          lastError = new Error(`${model}: ${errorMessage}`);
          break; // try next model
        }

        if (response.status === 403) {
          lastError = new Error(`${model}: Permission denied — ${errorMessage}`);
          break; // try next model
        }

        if (response.status === 429) {
          // Detect quota EXHAUSTION (limit: 0) vs temporary rate limit
          const isQuotaExhausted = errorMessage.includes('limit: 0') || errorMessage.includes('RESOURCE_EXHAUSTED');

          if (isQuotaExhausted) {
            console.warn(`[Ad Script Builder] ${model}: Free tier quota exhausted (limit: 0)`);
            lastError = new Error(`${model}: Free tier quota exhausted. Your API key's free quota is used up.`);
            break; // no point retrying — move to next model
          }

          if (attempt < MAX_RETRIES) {
            const retryAfter = response.headers.get('retry-after');
            const waitMs = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : BASE_DELAY_MS * Math.pow(2, attempt - 1);
            const waitSec = Math.ceil(waitMs / 1000);
            if (updateStatus) updateStatus(`${model}: rate limited — retrying in ${waitSec}s…`);
            console.log(`[Ad Script Builder] ${model}: 429, waiting ${waitSec}s`);
            await sleep(waitMs);
            continue;
          }
          lastError = new Error(`${model}: Rate limited after ${MAX_RETRIES} retries.`);
          break;
        }

        lastError = new Error(`${model}: ${errorMessage}`);
        break; // non-retryable, try next model

      } catch (fetchErr) {
        if (fetchErr.message.includes('Invalid Gemini API key')) throw fetchErr;
        console.error(`[Ad Script Builder] ${model} fetch error:`, fetchErr);
        lastError = fetchErr;
        break;
      }
    } // end retry loop
  } // end model loop

  // All models failed
  const isQuotaIssue = lastError?.message?.includes('quota exhausted');
  if (isQuotaIssue) {
    throw new Error(
      `Your Gemini API free tier quota is fully exhausted (limit: 0 across all models).\n\n` +
      `This is NOT a temporary rate limit — your project's free quota is used up.\n\n` +
      `Fix:\n` +
      `1. Go to aistudio.google.com/apikey\n` +
      `2. Click "Create API key" → "Create API key in new project"\n` +
      `3. Paste the new key here and try again\n\n` +
      `Or enable billing on your current GCP project for pay-as-you-go access.`
    );
  }
  cooldownUntil = Date.now() + 30000;
  startCooldownTimer();
  throw new Error(
    `All models failed. Last error: ${lastError?.message || 'Unknown error'}\n\n` +
    `Troubleshooting:\n` +
    `• Click "Test Key" to see detailed diagnostics\n` +
    `• Check https://aistudio.google.com/apikey for key status\n` +
    `• Try "Create API key in new project" for fresh quota\n` +
    `• Close any AI Studio tabs that may be consuming quota`
  );
}

// ─── Cooldown Timer ─────────────────────────────────
function startCooldownTimer() {
  const btnContent = dom.btnGenerate.querySelector('.btn-content');
  const originalHTML = btnContent.innerHTML;

  function tick() {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      cooldownUntil = 0;
      btnContent.innerHTML = originalHTML;
      dom.btnGenerate.disabled = false;
      return;
    }
    btnContent.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Cooldown ${remaining}s`;
    dom.btnGenerate.disabled = true;
    requestAnimationFrame(() => setTimeout(tick, 250));
  }
  tick();
}

// ═══════════════════════════════════════════════════
// STEP 5: VALIDATOR
// ═══════════════════════════════════════════════════
function validateScript(brief, scenes, voiceovers, veoPrompts) {
  const errors = [];
  const warnings = [];

  const totalDur = scenes.reduce((sum, s) => sum + s.duration, 0);
  if (totalDur !== brief.duration) {
    errors.push(`Total duration is ${totalDur}s but brief specifies ${brief.duration}s.`);
  }

  if (scenes.length === 0) {
    errors.push('No scenes were generated.');
  } else {
    if (scenes[0].label !== 'HOOK') {
      errors.push(`Scene 1 is labeled "${scenes[0].label}" — must be HOOK.`);
    }
    if (scenes[0].duration > 5) {
      errors.push(`HOOK scene is ${scenes[0].duration}s — must complete within 5 seconds.`);
    }
  }

  const labelSet = new Set(scenes.map((s) => s.label));
  ['HOOK', 'BUILD', 'PAYOFF', 'CTA'].forEach((lbl) => {
    if (!labelSet.has(lbl)) {
      errors.push(`Missing required scene label: ${lbl}.`);
    }
  });

  scenes.forEach((scene, i) => {
    if (!voiceovers[i] || voiceovers[i].trim().length === 0) {
      errors.push(`Scene ${scene.number} is missing a voiceover.`);
    }
    if (!veoPrompts[i] || veoPrompts[i].trim().length === 0) {
      errors.push(`Scene ${scene.number} is missing a Veo prompt.`);
    }
  });

  scenes.forEach((scene) => {
    if (scene.duration < 2 && scene.duration > 0) {
      warnings.push(`Scene ${scene.number} (${scene.label}) is only ${scene.duration}s — may be too short.`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════
// PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════
async function runPipeline() {
  const rawInput = getInputData();

  if (!rawInput || rawInput.trim().length < 10) {
    showToast('Please enter a brand brief first.', 'default');
    return;
  }

  const apiKey = dom.apiKey.value.trim();
  if (!apiKey) {
    showToast('Please enter your Gemini API key first.', 'default');
    dom.aiSettings.classList.add('open');
    dom.apiKey.focus();
    return;
  }

  // Check cooldown
  if (cooldownUntil > Date.now()) {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    showToast(`Rate limit cooldown active — ${remaining}s remaining.`, 'default');
    return;
  }

  switchSection('output');
  resetPipelineUI();

  let brief, scenePlan, voiceovers, veoPrompts, validation;

  try {
    // STEP 1: Parse
    setStepState('parser', 'active');
    await sleep(300);
    brief = parseBrief(rawInput);

    if (!brief.brand && !brief.product) {
      throw new Error('Could not extract brand name or product from the brief. Please check your input format.');
    }
    if (brief.duration <= 0) {
      throw new Error('Could not parse a valid duration. Please include "Duration: Xs" in your brief.');
    }

    setStepState('parser', 'done');
    renderParsedBrief(brief);

    // STEP 2: Plan scenes
    setStepState('planner', 'active');
    await sleep(250);
    scenePlan = planScenes(brief);
    if (scenePlan.error) throw new Error(scenePlan.error);
    setStepState('planner', 'done');

    // STEPS 3 & 4: AI Generation (voiceover + veo prompts in one call)
    setStepState('voiceover', 'active');
    const aiResult = await callGeminiAPI(brief, scenePlan.scenes, (statusMsg) => {
      // Update the pipeline UI with retry status
      const el = $(`.pipeline-step[data-step="voiceover"] .step-status`);
      if (el) el.textContent = statusMsg;
    });
    setStepState('voiceover', 'done');

    setStepState('veo', 'active');
    await sleep(200);
    voiceovers = aiResult.map((s) => s.voiceover);
    veoPrompts = aiResult.map((s) => s.veo_prompt);
    setStepState('veo', 'done');

    // STEP 5: Validate
    setStepState('validator', 'active');
    await sleep(200);
    validation = validateScript(brief, scenePlan.scenes, voiceovers, veoPrompts);
    setStepState('validator', validation.valid ? 'done' : 'error');
    renderValidation(validation);

    $$('.pipeline-connector').forEach((c) => c.classList.add('filled'));

    renderScenes(scenePlan.scenes, voiceovers, veoPrompts);
    generatedScript = buildScriptText(scenePlan.scenes, voiceovers, veoPrompts);
    dom.outputActions.style.display = '';

  } catch (err) {
    const steps = ['parser', 'planner', 'voiceover', 'veo', 'validator'];
    const activeStep = steps.find((s) => {
      const el = $(`.pipeline-step[data-step="${s}"]`);
      return el && el.classList.contains('active');
    });
    if (activeStep) setStepState(activeStep, 'error');
    showToast(err.message, 'default');
    console.error('Pipeline error:', err);
  }
}

// ─── Pipeline UI Helpers ────────────────────────────
function resetPipelineUI() {
  $$('.pipeline-step').forEach((el) => {
    el.classList.remove('active', 'done', 'error');
    el.querySelector('.step-status').textContent = 'Waiting';
  });
  $$('.pipeline-connector').forEach((c) => c.classList.remove('filled'));
  dom.parsedBrief.style.display = 'none';
  dom.validationResult.style.display = 'none';
  dom.sceneCards.innerHTML = '';
  dom.outputActions.style.display = 'none';
  dom.briefChips.innerHTML = '';
  generatedScript = null;
}

function setStepState(stepId, state) {
  const el = $(`.pipeline-step[data-step="${stepId}"]`);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  el.classList.add(state);
  const statusEl = el.querySelector('.step-status');
  const labels = { active: 'Running…', done: 'Complete', error: 'Failed' };
  statusEl.textContent = labels[state] || 'Waiting';

  if (state === 'done') {
    const prev = el.previousElementSibling;
    if (prev && prev.classList.contains('pipeline-connector')) {
      prev.classList.add('filled');
    }
  }
}

function renderParsedBrief(brief) {
  dom.parsedBrief.style.display = '';
  const chips = [
    { label: 'Brand', value: brief.brand || '' },
    { label: 'Product', value: (brief.product || '').length > 60 ? brief.product.substring(0, 60) + '…' : (brief.product || '') },
    { label: 'Price', value: brief.price || '' },
    { label: 'Audience', value: (brief.audience || '').length > 50 ? brief.audience.substring(0, 50) + '…' : (brief.audience || '') },
    { label: 'Tone', value: (brief.tone || '').length > 50 ? brief.tone.substring(0, 50) + '…' : (brief.tone || '') },
    { label: 'Duration', value: `${brief.duration}s` },
  ];

  dom.briefChips.innerHTML = chips
    .filter((c) => c.value)
    .map((c) => `<span class="brief-chip"><strong>${c.label}:</strong> ${escapeHtml(c.value)}</span>`)
    .join('');
}

function renderValidation(validation) {
  dom.validationResult.style.display = '';
  if (validation.valid) {
    dom.validationResult.className = 'validation-card pass';
    let html = `<span class="validation-icon">✓</span><div class="validation-text"><strong>All checks passed.</strong>`;
    if (validation.warnings.length > 0) {
      html += `<ul>${validation.warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('')}</ul>`;
    }
    html += `</div>`;
    dom.validationResult.innerHTML = html;
  } else {
    dom.validationResult.className = 'validation-card fail';
    let html = `<span class="validation-icon">✗</span><div class="validation-text"><strong>Validation failed:</strong><ul>`;
    html += validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    html += `</ul></div>`;
    dom.validationResult.innerHTML = html;
  }
}

function renderScenes(scenes, voiceovers, veoPrompts) {
  dom.sceneCards.innerHTML = '';

  scenes.forEach((scene, i) => {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.dataset.label = scene.label;
    card.style.animationDelay = `${i * 120}ms`;

    card.innerHTML = `
      <div class="scene-card-header">
        <div class="scene-label-group">
          <span class="scene-badge ${scene.label}">${scene.label}</span>
          <span class="scene-title">Scene ${scene.number}</span>
        </div>
        <span class="scene-duration">${scene.duration}s</span>
      </div>
      <div class="scene-card-body">
        <div class="scene-block">
          <div class="scene-block-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            Voiceover
          </div>
          <div class="voiceover-text">"${escapeHtml(voiceovers[i])}"</div>
        </div>
        <div class="scene-block">
          <div class="scene-block-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Veo Prompt
          </div>
          <div class="veo-prompt-text">${escapeHtml(veoPrompts[i])}</div>
        </div>
      </div>
    `;

    dom.sceneCards.appendChild(card);
  });
}

function buildScriptText(scenes, voiceovers, veoPrompts) {
  return scenes.map((scene, i) => {
    return [
      `[${scene.label}] Scene ${scene.number} — ${scene.duration}s`,
      `Voiceover: "${voiceovers[i]}"`,
      `Veo Prompt: ${veoPrompts[i]}`,
    ].join('\n');
  }).join('\n\n');
}

// ─── Button Handlers ────────────────────────────────
dom.btnGenerate.addEventListener('click', async () => {
  dom.btnGenerate.querySelector('.btn-content').style.display = 'none';
  dom.btnGenerate.querySelector('.btn-loading').style.display = '';
  dom.btnGenerate.disabled = true;

  await runPipeline();

  dom.btnGenerate.querySelector('.btn-content').style.display = '';
  dom.btnGenerate.querySelector('.btn-loading').style.display = 'none';
  dom.btnGenerate.disabled = false;
});

dom.btnCopy.addEventListener('click', () => {
  if (!generatedScript) return;
  navigator.clipboard.writeText(generatedScript).then(() => {
    showToast('Script copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Could not copy — try manually selecting the text.', 'default');
  });
});

dom.btnDownload.addEventListener('click', () => {
  if (!generatedScript) return;
  const blob = new Blob([generatedScript], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ad-script.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloading ad-script.txt', 'success');
});

dom.btnNew.addEventListener('click', () => {
  switchSection('input');
  resetPipelineUI();
});

// ─── Initialize ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  switchSection('input');
});
