const { generateViaPlaywright } = require('./playwright-agent');
const { buildPrompt } = require('./prompt-builder');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    // Check if persistent Chrome profile exists (from login.js)
    const profileDir = path.join(__dirname, 'chrome-profile');
    const hasProfile = fs.existsSync(profileDir) && fs.readdirSync(profileDir).length > 0;

    if (!hasProfile) {
      console.error('❌ No Chrome profile found. Run "node login.js" first to log in.');
      process.exit(1);
    }

    // Default to a cinematic test if no argument is provided
    const rawQuery = process.argv[2] || "/cinematic 3d donut with fluidity physics interactive";
    
    console.log(`[Test] Raw query: "${rawQuery}"`);
    const finalPrompt = buildPrompt(rawQuery);
    console.log(`[Test] Transformed prompt length: ${finalPrompt.length} chars`);

    console.log('\n--- Starting local Playwright generation (using Chrome profile)...');
    const startTime = Date.now();
    
    const result = await generateViaPlaywright(finalPrompt, {
      useProfile: true
    });
    
    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n✅ Success in ${timeTaken} seconds!`);
    console.log(`HTML Length: ${result.html?.length || 0} chars`);
    console.log(`Has </html>: ${result.html?.includes('</html>') ? 'YES' : 'NO'}`);
    
    fs.writeFileSync(path.join(__dirname, 'test-output.html'), result.html);
    console.log('Saved to test-output.html');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  }
})();
