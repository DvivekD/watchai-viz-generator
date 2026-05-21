const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

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
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    rl.question('Press ENTER here in the terminal once you have fully logged in and see the Gemini chat screen... ', () => {
      rl.close();
      resolve();
    });
  });
  
  console.log('Logged in successfully! Saving storage state...');
  const state = await context.storageState();
  const outputPath = path.join(__dirname, 'storageState.json');
  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2));
  
  console.log('\n✅ Saved to storageState.json!');
  console.log('\nNow upload the contents of this file to Cloudflare KV:');
  console.log(`wrangler kv:key put --binding=WATCHAI_KV "playwright_storage_state" --path="storageState.json"`);
  
  await browser.close();
})();
