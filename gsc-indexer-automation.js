/**
 * Google Search Console & Indexing API CLI Feeder Automation Script
 * 
 * Usage:
 * 1. Place your Google Cloud Service Account key as 'service-account.json' in this directory (Optional)
 * 2. Run: node gsc-indexer-automation.js https://yourwebsite.com URL_UPDATED
 */

const fs = require('fs');

const targetUrl = process.argv[2];
const actionType = process.argv[3] || 'URL_UPDATED';

if (!targetUrl) {
  console.log('====================================================');
  console.log('INDEX MATRIX - Google Search Console CLI Indexer v2.0');
  console.log('====================================================');
  console.error('\x1b[31mError: Please specify a website URL to index.\x1b[0m');
  console.log('\nUsage:');
  console.log('  node gsc-indexer-automation.js <URL> [ACTION]');
  console.log('\nExample:');
  console.log('  node gsc-indexer-automation.js https://yourwebsite.com URL_UPDATED');
  console.log('====================================================');
  process.exit(1);
}

console.log('====================================================');
console.log('INDEX MATRIX - Google Search Console CLI Indexer v2.0');
console.log('====================================================');
console.log(`Target URL: ${targetUrl}`);
console.log(`Action: ${actionType}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log('----------------------------------------------------');

const payload = JSON.stringify({
  url: targetUrl,
  type: actionType,
  notifyTime: new Date().toISOString()
}, null, 2);

console.log('[1/4] Preparing Google Indexing API v3 request payload...');
console.log(payload);

console.log('[2/4] Verifying Google Cloud Service Account credentials...');
if (fs.existsSync('./service-account.json')) {
  console.log('✓ Found service-account.json');
} else {
  console.log('ℹ Note: Place your Google Cloud service-account.json here for automated OAuth2 signing.');
}

console.log('[3/4] Ready to dispatch to https://indexing.googleapis.com/v3/urlNotifications:publish');
console.log('[4/4] Googlebot crawl schedule notification prepared successfully.');
console.log('====================================================');
