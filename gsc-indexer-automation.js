/**
 * INDEX MATRIX - Google Indexing API payload helper.
 *
 * This script validates the target and prepares a payload. It does not claim
 * that Google received, crawled, or indexed the URL. The official Indexing API
 * is intended for eligible content/properties and requires real credentials.
 */
const fs = require('fs');

const targetUrl = process.argv[2];
const actionType = process.argv[3] || 'URL_UPDATED';

if (!targetUrl) {
  console.error('Usage: node gsc-indexer-automation.js <URL> [URL_UPDATED|URL_DELETED]');
  process.exit(1);
}

let parsed;
try { parsed = new URL(targetUrl); } catch (e) {
  console.error('Invalid URL:', targetUrl);
  process.exit(1);
}
if (!['http:', 'https:'].includes(parsed.protocol)) {
  console.error('Only HTTP/HTTPS URLs are supported.');
  process.exit(1);
}

if (!['URL_UPDATED', 'URL_DELETED'].includes(actionType)) {
  console.error('Action must be URL_UPDATED or URL_DELETED.');
  process.exit(1);
}

const payload = {
  url: parsed.toString(),
  type: actionType,
  notifyTime: new Date().toISOString()
};

console.log('====================================================');
console.log('INDEX MATRIX - Google Indexing API Payload Helper');
console.log('====================================================');
console.log('Target URL:', payload.url);
console.log('Action:', payload.type);
console.log('Timestamp:', payload.notifyTime);
console.log('----------------------------------------------------');
console.log('[1/3] Payload prepared:');
console.log(JSON.stringify(payload, null, 2));
console.log('[2/3] Credential check:');
console.log(fs.existsSync('./service-account.json')
  ? 'service-account.json found. Real API delivery still requires eligible content/property and correct OAuth scopes.'
  : 'service-account.json not found. No Google API request was sent.');
console.log('[3/3] Delivery status: NOT_SENT_BY_THIS_HELPER');
console.log('Note: payload preparation is not proof of Google discovery, crawl, or indexing.');
console.log('====================================================');
