const fs = require('fs');
const path = require('path');

try {
  // Read the raw cookies array exported from the Cookie-Editor extension
  const rawData = fs.readFileSync(path.join(__dirname, 'raw-cookies.json'), 'utf8');
  let rawCookies = JSON.parse(rawData);

  // If it's not an array, maybe they pasted something else
  if (!Array.isArray(rawCookies)) {
    throw new Error('Expected an array of cookies. Please make sure you used Export -> JSON in the Cookie-Editor extension.');
  }

  // Ensure numeric expires
  const formattedCookies = rawCookies.map(c => {
    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: typeof c.expirationDate === 'number' ? c.expirationDate : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: c.sameSite && c.sameSite !== 'unspecified' ? c.sameSite : 'Lax',
    };
  });

  const storageState = {
    cookies: formattedCookies,
    origins: []
  };

  fs.writeFileSync(
    path.join(__dirname, 'storageState.json'), 
    JSON.stringify(storageState, null, 2)
  );

  console.log('✅ Successfully converted raw-cookies.json to Playwright storageState.json format!');
  console.log('\nNow upload to Cloudflare KV:');
  console.log(`wrangler kv:key put --binding=WATCHAI_KV "playwright_storage_state" --path="storageState.json"`);
  
} catch (e) {
  console.error('❌ Error:', e.message);
}
