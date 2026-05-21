/**
 * Canvas Agent — Automates Google Gemini Canvas using Playwright
 * 
 * Replaces Stagehand/Browserbase with raw Playwright.
 * Uses storageState JSON to persist Google login cookies across Render free tier ephemeral restarts.
 */

const { chromium } = require('playwright');

/**
 * Generate a visualization by automating Google Gemini Canvas.
 * 
 * @param {string} query - The prompt for the visualization
 * @param {object} opts - Options including storageState
 * @returns {Promise<{html: string, storageState: string}>}
 */
async function generateViaPlaywright(query, opts) {
  const { storageState } = opts;
  
  console.log(`[Canvas] Starting Playwright for: "${query}"`);

  // Parse storageState if provided as JSON string
  let parsedState = undefined;
  if (storageState) {
    try {
      parsedState = JSON.parse(storageState);
      console.log(`[Canvas] Loaded storageState (cookies: ${parsedState.cookies?.length || 0})`);
    } catch (e) {
      console.warn(`[Canvas] Failed to parse storageState JSON: ${e.message}`);
    }
  } else {
    console.log('[Canvas] No storageState provided (will likely need login)');
  }

  // Launch Chromium
  // Disable dev-shm-usage and sandbox to help with memory constraints on Render
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--single-process'
    ]
  });

  try {
    const context = await browser.newContext({
      storageState: parsedState,
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // STEP 1: Navigate to Gemini
    console.log('[Canvas] Navigating to gemini.google.com...');
    await page.goto('https://gemini.google.com', { waitUntil: 'networkidle', timeout: 30000 });
    
    // Check if we hit the login page
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      throw new Error('NOT_LOGGED_IN: Must log in first using the /login endpoint');
    }

    // Determine the chat input selector
    const chatInput = page.locator('[contenteditable="true"]').or(
      page.locator('textarea[aria-label*="prompt"]')
    ).or(
      page.locator('.ql-editor')
    );

    // Wait for the chat input to be visible (confirms we are logged in and page loaded)
    await chatInput.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      throw new Error('NOT_LOGGED_IN: Could not find chat input. Session may have expired.');
    });
    console.log('[Canvas] Logged in and on chat page ✓');

    // STEP 2: Click "+" → Click "Canvas"
    console.log('[Canvas] Opening Canvas mode...');
    
    const plusButton = page.locator('button[aria-label*="more"]').or(
      page.locator('button:has(mat-icon:has-text("add"))')
    ).or(
      page.locator('button mat-icon:has-text("add")')
    ).first();

    await plusButton.click({ timeout: 5000 });
    await page.waitForTimeout(1000); // Wait for menu animation
    
    const canvasOption = page.locator('text=Canvas').or(
      page.locator('text="Code, write, or make slides"')
    ).first();
    await canvasOption.click({ timeout: 5000 });

    console.log('[Canvas] Canvas mode activated ✓');
    await page.waitForTimeout(1000);

    // STEP 3: Type the prompt and send
    const canvasPrompt = buildCanvasPrompt(query);
    console.log(`[Canvas] Typing prompt (${canvasPrompt.length} chars)...`);
    
    // Some editors need click before fill, others don't.
    const input = chatInput.first();
    await input.click();
    
    // Depending on the element type, fill or press keys
    const tag = await input.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'textarea' || tag === 'input') {
        await input.fill(canvasPrompt);
    } else {
        // For contenteditable, typing might be safer if fill clears styling weirdly, but Playwright's fill usually handles it.
        // Let's use fill, if it fails, fallback to keyboard type.
        try {
           await input.fill(canvasPrompt);
        } catch {
           await page.keyboard.type(canvasPrompt, { delay: 1 });
        }
    }
    
    await page.waitForTimeout(500);

    // Send the message
    const sendButton = page.locator('button[aria-label*="Send"]').or(
      page.locator('button[aria-label*="submit"]')
    ).or(
      page.locator('button mat-icon:has-text("send")')
    ).first();
    await sendButton.click();

    console.log('[Canvas] Prompt sent ✓ Waiting for generation...');

    // STEP 4: Wait for Canvas to generate
    // Canvas takes 30s-3min+ to generate. Wait up to 5 minutes.
    console.log('[Canvas] Waiting for Canvas code panel...');
    
    // Wait for the code block or code editor to appear
    const codePanel = page.locator('[class*="code-block"], [class*="code-editor"], pre code, .monaco-editor').first();
    await codePanel.waitFor({ state: 'visible', timeout: 300000 }); // 5 minutes
    console.log('[Canvas] Canvas panel detected ✓');
    
    // Give it a moment to finish streaming/rendering
    await page.waitForTimeout(5000); 

    // Check if it's still generating (stop button visible) and wait for it to disappear
    const stopButton = page.locator('button[aria-label*="Stop"]').first();
    if (await stopButton.isVisible().catch(() => false)) {
        console.log('[Canvas] Waiting for generation to complete...');
        await stopButton.waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
    }

    // STEP 5: Click "Code" tab if needed
    console.log('[Canvas] Switching to Code view (if applicable)...');
    try {
      const codeTab = page.locator('button:has-text("Code"), [role="tab"]:has-text("Code")').first();
      if (await codeTab.isVisible({ timeout: 2000 })) {
        await codeTab.click();
        await page.waitForTimeout(2000);
        console.log('[Canvas] Code view active ✓');
      }
    } catch (e) {
      console.log('[Canvas] Code tab not found or not needed');
    }

    // STEP 6: Extract the code
    console.log('[Canvas] Extracting code...');
    
    let html = await page.evaluate(() => {
        const codeSelectors = [
          '.code-block code',
          '.code-content',
          '[class*="code-editor"] code',
          '[class*="code-editor"] pre',
          '[class*="CodeMirror"] .CodeMirror-code',
          '.monaco-editor .view-lines',
          '.monaco-editor',
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
            if (text.length > longestCode.length && (text.includes('<!DOCTYPE') || text.includes('<html'))) {
              longestCode = text;
            }
          });
        }
        
        // Shadow DOM check
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

    html = html.trim();
    html = html.replace(/^```(?:html|xml)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const doctypeIdx = html.search(/<!DOCTYPE\s+html/i);
    const htmlIdx = html.search(/<html\b/i);
    const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlIdx;
    if (startIdx > 0) html = html.slice(startIdx);

    if (!html || html.length < 300) {
      throw new Error(`Code extraction failed — got ${html.length} chars.`);
    }

    console.log(`[Canvas] ✅ Extracted ${html.length} chars of HTML`);

    // STEP 7: Save state and return
    const newState = await context.storageState();
    const newStateJson = JSON.stringify(newState);
    
    return { html, storageState: newStateJson };

  } finally {
    try { await browser.close(); } catch (e) {}
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

module.exports = { generateViaPlaywright };
