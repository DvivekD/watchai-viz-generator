const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('Launching Playwright in headed mode...');
  console.log('We need to capture your Google login session to use on the server.');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://gemini.google.com');
  console.log('\n======================================================');
  console.log('Please log into your Google account in the browser window.');
  console.log('Waiting for you to reach the Gemini chat interface...');
  console.log('======================================================\n');
  
  // Wait until we see the chat input which indicates successful login
  try {
    await page.waitForSelector('[contenteditable="true"], textarea[aria-label*="prompt"], .ql-editor', { timeout: 300000 });
  } catch (e) {
    console.error('Timed out waiting for login. Please try again.');
    await browser.close();
    process.exit(1);
  }
  
  console.log('Logged in successfully! Saving storage state...');
  const state = await context.storageState();
  const outputPath = path.join(__dirname, 'storageState.json');
  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2));
  
  console.log('\n✅ Saved to storageState.json!');
  console.log('\nNow upload the contents of this file to Cloudflare KV:');
  console.log(`wrangler kv:key put --binding=WATCHAI_KV "playwright_storage_state" --path="storageState.json"`);
  
  await browser.close();
})();
