/**
 * login.js — One-time login using your REAL Chrome browser
 * 
 * Launches a persistent Chrome profile so you log in once and stay logged in forever.
 * Google won't block this because it's your actual Chrome, not Playwright's Chromium.
 * 
 * Usage:  node login.js
 * 
 * After logging in, close the browser. Your session is saved to ./chrome-profile/
 * All future test-local.js runs will reuse this session automatically.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');

(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  WatchAI — Google Login (Real Chrome + Persistent Profile) ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Profile directory: ${PROFILE_DIR}`);
  console.log('');

  // Create profile dir if needed
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    console.log('Created fresh profile directory.');
  } else {
    console.log('Reusing existing profile directory.');
  }

  console.log('');
  console.log('Launching Chrome... Log in to your Google account on the page that opens.');
  console.log('Once you see "Your move, Iron" (or your Gemini homepage), close the browser.');
  console.log('');

  // Launch REAL Chrome (not Playwright's Chromium) with a persistent profile
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',        // Use the real Chrome installed on this PC
    headless: false,           // Headed so you can log in manually
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',  // Hide automation flags
    ],
    ignoreDefaultArgs: ['--enable-automation'],  // Remove the automation banner
  });

  const page = context.pages()[0] || await context.newPage();
  
  // Navigate to Gemini
  await page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded' });
  
  console.log('Browser is open. Please:');
  console.log('  1. Sign in to your Google account');
  console.log('  2. Make sure you see the Gemini chat page');
  console.log('  3. Close the browser window when done');
  console.log('');
  console.log('Waiting for you to close the browser...');

  // Wait for the browser to be closed by the user
  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  console.log('');
  console.log('✅ Login session saved to ./chrome-profile/');
  console.log('   You can now run: node test-local.js');
  console.log('');
  process.exit(0);
})();
