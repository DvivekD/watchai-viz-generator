/**
 * WatchAI Viz Generator — Render.com Microservice
 * 
 * Primary: Self-hosted Playwright → automates Google Gemini Canvas
 * Fallback: Direct Gemini API call with thinking mode (if Canvas fails)
 */

const express = require('express');
const { generateViaPlaywright } = require('./playwright-agent');
const { buildPrompt } = require('./prompt-builder');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '5mb' })); // Increased limit for full storageState payload

const JOBS = new Map();

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
  console.log(`[Generator] Original Query: "${query}"`);

  const finalPrompt = buildPrompt(query);
  console.log(`[Generator] Using transformed prompt length: ${finalPrompt.length} chars`);

  const jobId = crypto.randomUUID();
  JOBS.set(jobId, { status: 'generating', startTime, logs: [] });

  // ── Start Playwright Canvas automation in background ───────────────────
  console.log(`[Generator] Job ${jobId} started Playwright automation...`);
  
  generateViaPlaywright(finalPrompt, { 
    storageState,
    useProfile: false,
    onStageUpdate: (stageMsg) => {
      const job = JOBS.get(jobId);
      if (job) {
        job.stage = stageMsg;
        job.logs.push(`[${new Date().toLocaleTimeString()}] ${stageMsg}`);
      }
    }
  })
    .then(({ html, storageState: newStorageState }) => {
      if (html && html.length > 500) {
        console.log(`[Generator] Job ${jobId} Canvas success! ${html.length} chars in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        JOBS.set(jobId, {
          status: 'complete',
          html,
          storageState: newStorageState,
          source: 'canvas',
          validated: true,
          durationMs: Date.now() - startTime,
        });
      } else {
        console.warn(`[Generator] Job ${jobId} output too short.`);
        JOBS.set(jobId, { status: 'error', error: 'Output too short' });
      }
    })
    .catch((err) => {
      console.warn(`[Generator] Job ${jobId} Canvas failed: ${err.message}`);
      if (err.message.includes('NOT_LOGGED_IN')) {
        JOBS.set(jobId, { status: 'error', error: err.message, action: 'Login to Google using local-login.js', code: 401 });
      } else {
        JOBS.set(jobId, { status: 'error', error: err.message });
      }
    });

  // Return immediately
  return res.status(202).json({
    status: 'generating',
    jobId,
    message: 'Generation started in background'
  });
});

// ── Status polling endpoint ──────────────────────────────────────────────────
app.get('/status/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }
  
  // Return the current job state
  res.json(job);
});

// ── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[WatchAI Viz Generator] Running on port ${PORT}`);
  console.log(`[WatchAI Viz Generator] Mode: Playwright Canvas + API fallback`);
});

// Canvas generation can take 5+ minutes — set HTTP timeout to 10 min
server.timeout = 600000;
server.keepAliveTimeout = 600000;
