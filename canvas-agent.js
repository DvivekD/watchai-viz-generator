/**
 * Canvas Agent — Automates Google Gemini Canvas
 * 
 * Exact flow (matching the real Gemini UI):
 * 1. Click "+" in chat input → Click "Canvas" from dropdown
 * 2. Type the visualization prompt → Send
 * 3. Wait for Canvas panel to appear (right side)
 * 4. Click "Code" tab (top-right of Canvas panel)
 * 5. Select all code (Ctrl+A) → Extract the full HTML
 * 6. Return the raw HTML
 * 
 * Uses Stagehand (AI-driven, no brittle CSS selectors)
 * Runs in Browserbase cloud browser (free tier, no local Chrome needed)
 */

const { Stagehand } = require('@browserbasehq/stagehand');
const { z } = require('zod');

/**
 * Generate a visualization by automating Google Gemini Canvas.
 */
async function generateViaCanvas(query, opts) {
  const {
    browserbaseApiKey,
    browserbaseProjectId,
    geminiApiKey,
  } = opts;

  console.log(`[Canvas] Starting for: "${query}"`);

  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: browserbaseApiKey,
    projectId: browserbaseProjectId,
    modelName: 'google/gemini-2.0-flash',
    modelClientOptions: { apiKey: geminiApiKey },
    browserbaseSessionCreateParams: {
      projectId: browserbaseProjectId,
      keepAlive: true,
    },
    enableCaching: true,
    verbose: 1,
  });

  await stagehand.init();
  const page = stagehand.page;
  console.log(`[Canvas] Session: https://www.browserbase.com/sessions/${stagehand.browserbaseSessionID}`);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Navigate to Gemini
    // ═══════════════════════════════════════════════════════════════════
    await page.goto('https://gemini.google.com', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check if logged in — look for the chat input
    const loginCheck = await stagehand.observe(
      'Is there an "Ask Gemini" input field or text area visible?'
    );
    if (!loginCheck || loginCheck.length === 0) {
      throw new Error(
        'NOT_LOGGED_IN: Log in via Browserbase dashboard → ' +
        `https://www.browserbase.com/sessions/${stagehand.browserbaseSessionID}`
      );
    }
    console.log('[Canvas] Logged in ✓');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Click "+" → Click "Canvas"
    // ═══════════════════════════════════════════════════════════════════
    console.log('[Canvas] Opening Canvas mode...');

    // Click the "+" button in the chat input area to open the tools menu
    await stagehand.act({
      action: 'Click the "+" button or plus icon on the left side of the chat input area to open the tools menu',
    });
    await page.waitForTimeout(1500);

    // Click "Canvas" from the dropdown menu
    await stagehand.act({
      action: 'Click "Canvas" from the dropdown menu. It says "Code, write, or make slides"',
    });
    await page.waitForTimeout(1500);

    console.log('[Canvas] Canvas mode activated ✓');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Type the prompt and send
    // ═══════════════════════════════════════════════════════════════════
    const canvasPrompt = buildCanvasPrompt(query);
    console.log(`[Canvas] Typing prompt (${canvasPrompt.length} chars)...`);

    // Click the chat input field
    await stagehand.act({
      action: 'Click on the chat input field or text area where you type messages',
    });
    await page.waitForTimeout(500);

    // Type the prompt using keyboard (handles long text better than act)
    await page.keyboard.type(canvasPrompt, { delay: 3 });
    await page.waitForTimeout(500);

    // Send the message
    await stagehand.act({
      action: 'Click the send button (arrow icon) to submit the message, or press Enter',
    });

    console.log('[Canvas] Prompt sent ✓ Waiting for generation...');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Wait for Canvas to generate
    // ═══════════════════════════════════════════════════════════════════
    // Canvas takes 30s-3min+ to generate. We poll every 8 seconds.
    let canvasReady = false;
    const maxWaitSec = 300; // 5 minutes max
    const pollInterval = 8000;
    const maxPolls = Math.ceil((maxWaitSec * 1000) / pollInterval);

    for (let i = 0; i < maxPolls; i++) {
      await page.waitForTimeout(pollInterval);
      const elapsed = ((i + 1) * pollInterval / 1000).toFixed(0);

      // Check for Canvas panel appearing on the right side
      const canvasPanel = await stagehand.observe(
        'Is there a Canvas panel on the right side of the screen showing either: ' +
        '1. A code editor with HTML code, or ' +
        '2. A preview/rendered visualization, or ' +
        '3. "Code" and "Preview" buttons at the top-right of a panel? ' +
        'These appear when Canvas has finished generating.'
      );

      if (canvasPanel && canvasPanel.length > 0) {
        canvasReady = true;
        console.log(`[Canvas] Canvas panel detected after ${elapsed}s ✓`);
        break;
      }

      // Check if still generating
      const generating = await stagehand.observe(
        'Is there a loading indicator, spinning animation, typing dots, or "stop generating" button visible?'
      );

      if (generating && generating.length > 0) {
        console.log(`[Canvas] Still generating... (${elapsed}s)`);
      } else if (i > 5) {
        // After 40s with no loading indicator and no canvas, check for errors
        const errorCheck = await stagehand.observe(
          'Is there an error message, "Try again" button, or "something went wrong" text visible?'
        );
        if (errorCheck && errorCheck.length > 0) {
          throw new Error('Canvas generation failed — error message appeared');
        }
      }
    }

    if (!canvasReady) {
      throw new Error(`Canvas did not generate within ${maxWaitSec}s`);
    }

    // Wait a moment for Canvas to fully render
    await page.waitForTimeout(3000);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Click "Code" tab to see raw HTML
    // ═══════════════════════════════════════════════════════════════════
    console.log('[Canvas] Switching to Code view...');

    try {
      await stagehand.act({
        action: 'Click the "Code" button or tab at the top-right of the Canvas panel to show the raw source code instead of the preview',
      });
      await page.waitForTimeout(2000);
      console.log('[Canvas] Code view active ✓');
    } catch (e) {
      console.log('[Canvas] Code button not found — might already be in code view');
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Select all + Extract the code
    // ═══════════════════════════════════════════════════════════════════
    console.log('[Canvas] Extracting code...');

    // Method 1: Try clicking inside the code area and doing Ctrl+A + copy
    let html = '';

    try {
      // Click inside the code editor area
      await stagehand.act({
        action: 'Click inside the code editor area where the HTML source code is displayed',
      });
      await page.waitForTimeout(500);

      // Select all with Ctrl+A
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.waitForTimeout(300);

      // Copy with Ctrl+C
      await page.keyboard.down('Control');
      await page.keyboard.press('c');
      await page.keyboard.up('Control');
      await page.waitForTimeout(300);

      // Read clipboard
      html = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    } catch (e) {
      console.log('[Canvas] Clipboard method failed, trying DOM extraction...');
    }

    // Method 2: Direct DOM extraction from the code editor
    if (!html || html.length < 300) {
      html = await page.evaluate(() => {
        // Canvas code editor typically renders in code elements or pre elements
        const codeSelectors = [
          // Canvas-specific selectors
          '.code-block code',
          '.code-content',
          '[class*="code-editor"] code',
          '[class*="code-editor"] pre',
          '[class*="CodeMirror"] .CodeMirror-code',
          // Monaco editor (Google often uses this)
          '.monaco-editor .view-lines',
          '.monaco-editor',
          // Generic code blocks
          'code-block',
          'pre code',
          'code',
          'pre',
        ];

        let longestCode = '';
        for (const sel of codeSelectors) {
          const els = document.querySelectorAll(sel);
          els.forEach(el => {
            const text = (el.textContent || el.innerText || '').trim();
            // Must look like HTML and be longer than what we have
            if (text.length > longestCode.length && text.includes('<!DOCTYPE') || text.includes('<html')) {
              longestCode = text;
            }
          });
        }

        // Also try to find the code in any shadow DOMs
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => {
          if (el.shadowRoot) {
            const shadowCode = el.shadowRoot.querySelectorAll('code, pre');
            shadowCode.forEach(sc => {
              const text = (sc.textContent || '').trim();
              if (text.length > longestCode.length && (text.includes('<!DOCTYPE') || text.includes('<html'))) {
                longestCode = text;
              }
            });
          }
        });

        return longestCode;
      });
    }

    // Method 3: Stagehand extract as last resort
    if (!html || html.length < 300) {
      console.log('[Canvas] Trying Stagehand extract...');
      try {
        const result = await stagehand.extract({
          instruction: 'Extract the COMPLETE HTML source code visible in the Canvas code editor. ' +
            'Get everything from <!DOCTYPE html> to </html>. Return the full raw code, do not truncate.',
          schema: z.object({
            html: z.string().describe('The complete HTML source code from the Canvas editor'),
          }),
        });
        html = result.html || '';
      } catch (e) {
        console.log('[Canvas] Stagehand extract failed:', e.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: Clean up and validate
    // ═══════════════════════════════════════════════════════════════════
    html = html.trim();

    // Strip any markdown fences
    html = html
      .replace(/^```(?:html|xml)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Find HTML start
    const doctypeIdx = html.search(/<!DOCTYPE\s+html/i);
    const htmlIdx = html.search(/<html\b/i);
    const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlIdx;
    if (startIdx > 0) html = html.slice(startIdx);

    if (!html || html.length < 300) {
      throw new Error(`Code extraction failed — got ${html.length} chars. Try the Browserbase live view to debug.`);
    }

    console.log(`[Canvas] ✅ Extracted ${html.length} chars of HTML`);
    return html;

  } finally {
    try { await stagehand.close(); } catch (e) {}
  }
}

/**
 * Build a prompt that makes Canvas produce a watch-optimized Three.js visualization
 */
function buildCanvasPrompt(query) {
  return `Create a self-contained HTML file with Three.js for: ${query}

Technical requirements:
- Single HTML file, all CSS in <style>, all JS in <script>
- Load Three.js from CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
- Dark background #050505, viewport: 198x242px (Apple Watch)
- Use MeshStandardMaterial with emissive glow, particle effects (300+ THREE.Points), smooth auto-orbit camera
- Add wheel/scroll event listener — for layered/exploded views: scroll controls explodeFactor (0-1 separating layers). For others: scroll controls zoom.
- Glassmorphic HUD: backdrop-filter:blur(12px), rgba(0,0,0,0.5) bg, 9px font, border-radius:10px
- Status pill at bottom center showing state ("Scroll to explore", current layer name, etc.)
- HSL color palette: cyan(195°), emerald(150°), amber(35°), violet(270°)
- WebGLRenderer: antialias:false, powerPreference:"low-power", pixelRatio max 1.5
- All variables/functions in GLOBAL scope (var, not let/const at top level). No modules, no IIFEs.
- Call init() at bottom of script. After first render call: window.__hideWatchVizLoader && window.__hideWatchVizLoader("first-render")
- NEVER use optional chaining (?.) on left side of assignments (breaks Safari/WebKit)
- Under 200 meshes, under 2000 points. No GLTF, no textures, no external libs except Three.js.

Make it visually cinematic — glowing emissive materials, particle atmosphere, smooth animations, professional quality.`;
}

module.exports = { generateViaCanvas };
