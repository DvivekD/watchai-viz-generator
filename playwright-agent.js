/**
 * Canvas Agent — Automates Google Gemini Canvas using Playwright
 * 
 * Exact flow (matches Gemini UI as of May 2026):
 *   1. Navigate → wait for chat input (proves logged in)
 *   2. Click model dropdown → select "3.1 Pro"
 *   3. Click "+" → select "Canvas"
 *   4. Type raw user prompt → send
 *   5. Canvas code panel opens automatically, poll until </html> appears
 *   6. Click code area → Ctrl+A → Ctrl+C → read clipboard
 * 
 * Two modes:
 *   LOCAL:  Uses persistent Chrome profile (./chrome-profile/) — no cookie hassle
 *   SERVER: Uses storageState JSON (for Render deployment)
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');

/**
 * Generate a visualization by automating Google Gemini Canvas.
 * @param {string} query The transformed user prompt
 * @param {object} opts Options { storageState, useProfile, onStageUpdate }
 */
async function generateViaPlaywright(query, opts = {}) {
  const { storageState, useProfile, onStageUpdate } = opts;

  const logStage = (msg) => {
    console.log(msg);
    if (onStageUpdate) onStageUpdate(msg.replace(/^\[Canvas\]\s*/, ''));
  };

  logStage(`[Canvas] Starting Playwright for: "${query.slice(0, 30)}..."`);

  // Decide mode: persistent profile (local) or storageState (server)
  const hasProfile = fs.existsSync(PROFILE_DIR) && fs.readdirSync(PROFILE_DIR).length > 0;
  const useLocalProfile = useProfile !== false && hasProfile;

  let context, browser, page;

  if (useLocalProfile) {
    // ── LOCAL MODE: Use persistent Chrome profile ──────────────────────
    console.log('[Canvas] Using persistent Chrome profile (local mode)');
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = context.pages()[0] || await context.newPage();
    browser = null; // persistent context doesn't have a separate browser object

  } else {
    // ── SERVER MODE: Use storageState JSON ──────────────────────────────
    let parsedState = undefined;
    if (storageState) {
      try {
        // Handle both string (from raw HTTP) and object (from Express JSON parser)
        parsedState = typeof storageState === 'string' ? JSON.parse(storageState) : storageState;
        console.log(`[Canvas] Loaded storageState (cookies: ${parsedState.cookies?.length || 0})`);
      } catch (e) {
        console.warn(`[Canvas] Failed to parse storageState: ${e.message}`);
      }
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage', 
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    context = await browser.newContext({
      storageState: parsedState,
      viewport: { width: 1280, height: 900 }
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();
  }

  try {
    // Ensure tmp dir exists for screenshots
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    // ── STEP 1: Navigate to Gemini ──────────────────────────────────────
    console.log('[Canvas] Navigating to gemini.google.com...');
    await page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      await page.screenshot({ path: './tmp/err-not-logged-in.png' });
      throw new Error('NOT_LOGGED_IN: Redirected to login page. Run "node login.js" first.');
    }

    // Wait for the chat input bar (proves we're logged in)
    const chatInput = page.getByRole('textbox').last();
    await chatInput.waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
      await page.screenshot({ path: './tmp/err-not-logged-in.png' });
      throw new Error('NOT_LOGGED_IN: Could not find chat input. Run "node login.js" first.');
    });

    // Extra login check: look for "Sign in" button
    const signInBtn = page.locator('a:has-text("Sign in"), button:has-text("Sign in")').first();
    const isSignedOut = await signInBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (isSignedOut) {
      await page.screenshot({ path: './tmp/err-not-logged-in.png' });
      throw new Error('NOT_LOGGED_IN: "Sign in" button visible. Run "node login.js" first.');
    }

    console.log('[Canvas] Logged in ✓');
    await page.screenshot({ path: './tmp/step1-loaded.png' });

    // ── STEP 2: Select "3.1 Pro" model ──────────────────────────────────
    console.log('[Canvas] Selecting 3.1 Pro model...');
    try {
      // The model button is near the right side of the input bar, shows current model name
      const modelBtn = page.locator('button').filter({ hasText: /Flash|Pro|Gemini|Model/i }).last();
      await modelBtn.waitFor({ state: 'visible', timeout: 5000 });
      await modelBtn.click({ force: true });
      console.log('[Canvas] Model dropdown opened ✓');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: './tmp/step2-model-dropdown.png' });

      // Click "3.1 Pro"
      const proItem = page.getByText('3.1 Pro').first();
      await proItem.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      await proItem.click({ force: true, timeout: 5000 });
      console.log('[Canvas] 3.1 Pro selected ✓');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: './tmp/step3-model-selected.png' });
    } catch (e) {
      console.log(`[Canvas] Model selection failed: ${e.message}. Proceeding with default.`);
      await page.screenshot({ path: './tmp/err-model-select.png' });
    }

    // ── STEP 3: Click "+" → Select "Canvas" ─────────────────────────────
    logStage('[Canvas] Opening Canvas mode...');
    try {
      // Use Playwright's spatial selector to find the button visually to the left of the input (max 150px away)
      // This completely avoids clicking random buttons in the sidebar.
      let plusBtn = page.locator('button:left-of([contenteditable="true"], 150)').filter({ state: 'visible' }).first();
      
      if (await plusBtn.count() === 0) {
         plusBtn = page.locator('button:left-of(textarea, 150)').filter({ state: 'visible' }).first();
      }
      if (await plusBtn.count() === 0) {
         plusBtn = page.locator('button:left-of(.ql-editor, 150)').filter({ state: 'visible' }).first();
      }
      if (await plusBtn.count() === 0) {
         // Ultimate fallback: strictly match upload/attach tooltips
         plusBtn = page.locator('button[aria-label*="upload" i], button[aria-label*="attach" i]').filter({ state: 'visible' }).first();
      }

      await plusBtn.waitFor({ state: 'visible', timeout: 5000 });
      await plusBtn.click({ force: true });
      console.log('[Canvas] "+" menu opened ✓');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: './tmp/step4-plus-menu.png' });

      // Click "Canvas" in the menu
      // Make this extremely robust: Try by role + name, then by class + text, then by raw substring
      let canvasItem = page.getByRole('menuitem', { name: /Canvas/i }).first();
      if (await canvasItem.count() === 0) {
        canvasItem = page.locator('.mat-mdc-menu-item, [role="menuitem"], li').filter({ hasText: /Canvas/i }).first();
      }
      if (await canvasItem.count() === 0) {
        canvasItem = page.locator('text=Canvas').last(); // last() usually picks the deepest text node, which is the button itself
      }
      
      await canvasItem.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await canvasItem.click({ force: true, timeout: 5000 });
      console.log('[Canvas] Canvas mode activated ✓');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: './tmp/step5-canvas-selected.png' });
    } catch (e) {
      console.log(`[Canvas] Canvas selection failed: ${e.message}. Sending in standard mode.`);
      await page.screenshot({ path: './tmp/err-canvas-select.png' });
    }

    // ── STEP 4: Type raw prompt and send ─────────────────────────────────
    logStage(`[Canvas] Typing prompt...`);

    // Re-locate the input (may have changed after Canvas activation)
    const input = page.locator('[contenteditable="true"]').or(
      page.locator('textarea[aria-label*="prompt" i]')
    ).or(
      page.locator('textarea[aria-label*="write" i]')
    ).or(
      page.locator('.ql-editor')
    ).first();
    await input.click({ force: true });
    await page.waitForTimeout(300);

    try {
      await input.fill(query);
    } catch {
      await page.keyboard.type(query, { delay: 1 });
    }
    await page.waitForTimeout(500);

    // Click send
    const sendBtn = page.locator(
      'button[aria-label*="Send" i], button[aria-label*="submit" i]'
    ).first();
    await sendBtn.click({ force: true });
    console.log('[Canvas] Prompt sent ✓');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: './tmp/step6-prompt-sent.png' });

    // ── STEP 5: Switch to Code View & Wait for </html> ──────────────────
    logStage('[Canvas] Waiting for Canvas generation...');
    
    // Wait for the "Code" toggle button to appear (exact match, visible)
    const codeBtn = page.getByText('Code', { exact: true }).and(page.locator(':visible')).first();

    let waitedMs = 0;
    while (waitedMs < 300000) {
      if (await codeBtn.isVisible()) {
        break;
      }
      await page.waitForTimeout(5000);
      waitedMs += 5000;
      console.log(`[Canvas] Still waiting for Canvas to open... (${waitedMs / 1000}s)`);
      // Save a debug screenshot so we can see what's happening
      await page.screenshot({ path: './tmp/debug-waiting-canvas.png' });
    }

    if (!(await codeBtn.isVisible())) {
       console.log('[Canvas] Error: Canvas panel never opened after 5 minutes.');
       process.exit(1);
    }
    console.log('[Canvas] Code toggle button found! Waiting 2s for UI to settle...');
    await page.waitForTimeout(2000); // Let the Canvas slide-in animation finish

    console.log('[Canvas] Clicking Code toggle...');
    let switched = false;
    for (let i = 0; i < 3; i++) {
      try {
        await codeBtn.click({ force: true, timeout: 5000 });
      } catch (e) {
        console.log('[Canvas] Standard click failed, using evaluate click...');
        await codeBtn.evaluate(node => node.click()).catch(() => {});
      }
      await page.waitForTimeout(1500);
      
      // Verify it switched by checking if code elements exist in the DOM
      switched = await page.evaluate(() => document.querySelectorAll('.monaco-editor, pre code, [class*="code-editor"], [class*="code-block"]').length > 0);
      if (switched) break;
    }
    
    logStage(`[Canvas] Polling for generation to finish...`);

    const MAX_WAIT_MS = 600000; // 10 min max
    const POLL_INTERVAL_MS = 10000; // every 10s
    const startTime = Date.now();
    let generationDone = false;
    let html = '';

    while (Date.now() - startTime < MAX_WAIT_MS) {
      // Find the editor to focus it
      const codeArea = page.locator('.monaco-editor, pre code, [class*="code-editor"], [class*="code-block"]').first();
      await codeArea.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);

      // Extract code via clipboard to bypass Monaco virtualization
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+C');
      await page.waitForTimeout(500);

      try {
        html = await page.evaluate(() => navigator.clipboard.readText());
      } catch (e) {
        console.log(`[Canvas] Clipboard read failed: ${e.message}`);
      }

      if (html && html.includes('</html>')) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        logStage(`[Canvas] Generation complete. (${elapsed}s)`);
        generationDone = true;
        break;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[Canvas] Still generating... (${elapsed}s elapsed)`);
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    if (!generationDone) {
      console.warn('[Canvas] Timed out waiting for </html>. Proceeding with what we have...');
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: './tmp/step6-generation-done.png' });

    // Fallback: Copy code button (if clipboard loop failed)
    if (!html || html.length < 500) {
      try {
        const copyBtn = page.locator('button[aria-label*="Copy" i], button:has-text("Copy code")').first();
        if (await copyBtn.isVisible({ timeout: 2000 })) {
          await copyBtn.click();
          await page.waitForTimeout(1000);
          html = await page.evaluate(() => navigator.clipboard.readText());
          console.log(`[Canvas] Fallback Copy button used: ${html.length} chars`);
        }
      } catch (e) {}
    }

    // Fallback: DOM extraction (if all clipboard attempts fail)
    if (!html || html.length < 500) {
      console.log('[Canvas] Falling back to DOM extraction...');
      html = await page.evaluate(() => {
        const sels = ['pre code', 'code', 'pre', '.monaco-editor .view-lines', '.monaco-editor'];
        let longest = '';
        for (const s of sels) {
          document.querySelectorAll(s).forEach(el => {
            const t = (el.textContent || '').trim();
            if (t.length > longest.length && (t.includes('<!DOCTYPE') || t.includes('<html'))) longest = t;
          });
        }
        return longest;
      });
    }

    // ── Clean up ────────────────────────────────────────────────────────
    html = (html || '').trim();
    html = html.replace(/^```(?:html|xml)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const doctypeIdx = html.search(/<!DOCTYPE\s+html/i);
    const htmlIdx2 = html.search(/<html\b/i);
    const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlIdx2;
    if (startIdx > 0) html = html.slice(startIdx);

    if (html.includes('</html>')) {
      console.log('[Canvas] ✅ Full HTML with closing </html> tag');
    } else {
      console.warn('[Canvas] ⚠ HTML may be truncated (no </html>)');
    }

    if (!html || html.length < 300) {
      throw new Error(`Code extraction failed — got ${html.length} chars.`);
    }

    console.log(`[Canvas] ✅ Extracted ${html.length} chars`);

    // Save updated state for server mode
    const newState = await context.storageState();
    return { html, storageState: JSON.stringify(newState) };

  } finally {
    try { await context.close(); } catch (e) {}
    if (browser) try { await browser.close(); } catch (e) {}
  }
}

module.exports = { generateViaPlaywright };
