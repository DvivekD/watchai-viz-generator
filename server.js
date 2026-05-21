/**
 * WatchAI Viz Generator — Render.com Microservice
 * 
 * Primary: Self-hosted Playwright → automates Google Gemini Canvas
 * Fallback: Direct Gemini API call with thinking mode (if Canvas fails)
 */

const express = require('express');
const { generateViaPlaywright } = require('./playwright-agent');

const app = express();
app.use(express.json({ limit: '5mb' })); // Increased limit for full storageState payload

const PORT = process.env.PORT || 3000;

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'ok',
  service: 'watchai-viz-generator',
  mode: 'playwright-canvas',
}));
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'playwright' }));

// ── Main generation endpoint ─────────────────────────────────────────────────
app.post('/generate', async (req, res) => {
  const { query, classification, apiKey, storageState } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const startTime = Date.now();
  console.log(`[Generator] Starting for: "${query}"`);

  const geminiApiKey = apiKey || process.env.GEMINI_API_KEY;

  // ── Try Playwright Canvas automation first ───────────────────────────
  try {
    console.log('[Generator] Attempting Playwright Canvas automation...');
    
    const { html, storageState: newStorageState } = await generateViaPlaywright(query, {
      storageState,
    });

    if (html && html.length > 500) {
      console.log(`[Generator] Canvas success! ${html.length} chars in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      return res.json({
        html,
        storageState: newStorageState,
        source: 'canvas',
        validated: true,
        durationMs: Date.now() - startTime,
      });
    }

    console.warn('[Generator] Canvas returned too-short output, falling back to API');
  } catch (canvasErr) {
    console.warn(`[Generator] Canvas failed: ${canvasErr.message}`);
    
    // If not logged in, return 401 so the client can notify the user
    if (canvasErr.message.includes('NOT_LOGGED_IN')) {
      return res.status(401).json({
        error: canvasErr.message,
        action: 'Login to Google using local-login.js',
      });
    }
  }

  // ── Fallback: Direct Gemini API ──────────────────────────────────────
  if (!geminiApiKey) {
    return res.status(400).json({ error: 'Canvas failed and no Gemini API key provided for fallback' });
  }

  try {
    console.log('[Generator] Falling back to Gemini API...');
    const html = await callGeminiApi(query, classification || {}, geminiApiKey);
    
    return res.json({
      html,
      source: 'api',
      validated: false,
      durationMs: Date.now() - startTime,
    });
  } catch (apiErr) {
    console.error(`[Generator] API fallback also failed: ${apiErr.message}`);
    return res.status(500).json({ error: apiErr.message });
  }
});

// ── Direct Gemini API call (fallback) ────────────────────────────────────────
async function callGeminiApi(query, classification, apiKey) {
  const model = 'gemini-3.5-flash';
  const region = 'us-central1';
  const projectId = process.env.VERTEX_PROJECT_ID || 'firm-champion-495408-h6';

  const title = classification.title || query;
  const brief = classification.brief || '';

  const systemPrompt = `You are a world-class 3D visualization engineer. Create stunning, interactive Three.js scenes for the Apple Watch (198x242 viewport).
Requirements: Complete self-contained HTML, Three.js from CDN (r128), dark bg #050505, MeshStandardMaterial with emissive, particle effects, scroll interactivity, glassmorphic HUD, global scope vars, call init() at bottom, call window.__hideWatchVizLoader after first render.`;

  const userPrompt = `Create: "${query}" (${title}). ${brief}. Output ONLY raw HTML, no markdown.`;

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 32000,
        temperature: 0.35,
        topP: 0.9,
        thinkingConfig: { thinkingBudget: 8192 },
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let html = '';
  for (const part of parts) {
    if (part.text && !part.thought) html += part.text;
  }

  html = html.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const idx = html.search(/<!DOCTYPE\s+html/i);
  if (idx > 0) html = html.slice(idx);

  return html;
}

// ── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[WatchAI Viz Generator] Running on port ${PORT}`);
  console.log(`[WatchAI Viz Generator] Mode: Playwright Canvas + API fallback`);
});

// Canvas generation can take 5+ minutes — set HTTP timeout to 10 min
server.timeout = 600000;
server.keepAliveTimeout = 600000;
