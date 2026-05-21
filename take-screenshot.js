const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('Launching browser to capture screenshot...');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 198, height: 242 } // Apple Watch dimensions
  });
  
  const fileUrl = 'file://' + path.join(__dirname, 'test-output.html').replace(/\\/g, '/');
  console.log('Navigating to', fileUrl);
  
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  
  // Wait a few seconds for the Three.js scene to render and any animations to start
  await page.waitForTimeout(3000);
  
  const screenshotPath = 'C:\\Users\\V\\.gemini\\antigravity\\brain\\46bcaf83-ddd7-4bfa-88f7-68a640a66ca5\\screenshot.png';
  await page.screenshot({ path: screenshotPath });
  
  console.log('Screenshot saved to', screenshotPath);
  await browser.close();
})();
