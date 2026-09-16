const assert = require('assert');
const mongoose = require('mongoose');

async function runTests() {
  console.log('🧪 Starting INDEX MATRIX Automated Test Suite...\n');

  // Test 1: Config endpoint
  console.log('Test 1: Fetching /api/config...');
  const cfgRes = await fetch('http://localhost:8080/api/config');
  const cfg = await cfgRes.json();
  assert.strictEqual(cfg.appName, 'INDEX MATRIX');
  assert.strictEqual(typeof cfg.mongoConnected, 'boolean');
  assert.strictEqual(typeof cfg.maxLoginAttempts, 'number');
  console.log('✓ Config endpoint verified:', cfg);

  // Test 2: Unauthenticated gatekeeper protection
  console.log('\nTest 2: Verifying gatekeeper redirects unauthenticated requests...');
  const unauthRes = await fetch('http://localhost:8080/index.html', { redirect: 'manual' });
  assert.strictEqual(unauthRes.status, 302);
  const location = unauthRes.headers.get('location');
  assert(location.includes('/login.html'));
  console.log('✓ Unauthenticated redirect verified: 302 ->', location);

  // Test 3: Temporary sandbox admin login
  const path = require('path');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.connectDb();
  const randomSuffix = Date.now().toString().slice(-4);
  const testAdminUsername = `test_admin_${randomSuffix}`;
  const testAdminPassword = 'TempAdminSecretPass123!';
  await db.createUser(testAdminUsername, testAdminPassword, 'admin', 'Test Admin');

  console.log(`\nTest 3: Testing administrator login for temporary test admin "${testAdminUsername}"...`);
  const loginRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testAdminUsername, password: testAdminPassword })
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.strictEqual(loginData.success, true);
  assert.strictEqual(loginData.user.username, testAdminUsername.toLowerCase());
  assert.strictEqual(loginData.user.role, 'admin');
  const adminCookie = loginRes.headers.get('set-cookie');
  assert(adminCookie && adminCookie.includes('index_matrix_session='));
  console.log(`✓ Temporary admin "${testAdminUsername}" login successful. Session token generated.`);

  const adminCookieHeader = adminCookie.split(';')[0];

  // Test 4: Access protected page with admin cookie
  console.log('\nTest 4: Accessing /index.html with admin session cookie...');
  const authPageRes = await fetch('http://localhost:8080/index.html', {
    headers: { 'Cookie': adminCookieHeader }
  });
  assert.strictEqual(authPageRes.status, 200);
  const htmlContent = await authPageRes.text();
  assert(htmlContent.includes('INDEX MATRIX'));
  console.log('✓ Protected page accessed successfully (HTTP 200 OK).');

  // Test 5: Register a new user & test user isolation
  const userRandomSuffix = (Date.now() + 7).toString().slice(-4);
  const testUsername = `user_${userRandomSuffix}`;
  console.log(`\nTest 5: Registering new test user "${testUsername}"...`);
  const regRes = await fetch('http://localhost:8080/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testUsername, password: 'initialPassword123' })
  });
  const regData = await regRes.json();
  assert.strictEqual(regData.success, true);
  assert.strictEqual(regData.user.username, testUsername);
  assert.strictEqual(regData.user.role, 'user');
  let userCookieHeader = regRes.headers.get('set-cookie').split(';')[0];
  console.log(`✓ User "${testUsername}" registered successfully.`);

  // Test 6: Setup Profile Name & Phone Number (Without OTP)
  console.log('\nTest 6: Setting up Full Name and Phone Number (without OTP)...');
  const profileUpdateRes = await fetch('http://localhost:8080/api/user/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({
      displayName: 'Alex Cyber',
      phone: '+1 (555) 987-6543'
    })
  });
  assert.strictEqual(profileUpdateRes.status, 200);
  const profileUpdateData = await profileUpdateRes.json();
  assert.strictEqual(profileUpdateData.success, true);
  assert.strictEqual(profileUpdateData.user.displayName, 'Alex Cyber');
  assert.strictEqual(profileUpdateData.user.phone, '+1 (555) 987-6543');

  // Verify profile via GET /api/user/profile
  const getProfileRes = await fetch('http://localhost:8080/api/user/profile', {
    headers: { 'Cookie': userCookieHeader }
  });
  const profileDetails = await getProfileRes.json();
  assert.strictEqual(profileDetails.profile.displayName, 'Alex Cyber');
  assert.strictEqual(profileDetails.profile.phone, '+1 (555) 987-6543');
  console.log('✓ Name and Phone updated without OTP successfully.');

  // Test 7: Password Change & Verification of Password History Archival
  console.log('\nTest 7: Changing password and checking passwordHistory archival...');
  const pwdChangeRes = await fetch('http://localhost:8080/api/user/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({
      currentPassword: 'initialPassword123',
      newPassword: 'brandNewSecurePassword456!'
    })
  });
  assert.strictEqual(pwdChangeRes.status, 200);
  const pwdChangeData = await pwdChangeRes.json();
  assert.strictEqual(pwdChangeData.passwordChanged, true);

  // Check audit trail
  const getProfileWithPwdHist = await (await fetch('http://localhost:8080/api/user/profile', {
    headers: { 'Cookie': userCookieHeader }
  })).json();
  assert.strictEqual(getProfileWithPwdHist.profile.passwordHistoryCount, 1);
  assert.strictEqual(getProfileWithPwdHist.profile.passwordHistory.length, 1);
  console.log('✓ Old password hash archived into passwordHistory.');

  // Test 8: Username Change & Verification of Username History Archival
  console.log('\nTest 8: Changing username and checking usernameHistory archival...');
  const newUsername = `nexus_${userRandomSuffix}`;
  const unameChangeRes = await fetch('http://localhost:8080/api/user/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({
      newUsername: newUsername
    })
  });
  assert.strictEqual(unameChangeRes.status, 200);
  const unameChangeData = await unameChangeRes.json();
  assert.strictEqual(unameChangeData.usernameChanged, true);
  assert.strictEqual(unameChangeData.user.username, newUsername);

  // Update session cookie header to new signed token
  const updatedCookie = unameChangeRes.headers.get('set-cookie');
  if (updatedCookie) {
    userCookieHeader = updatedCookie.split(';')[0];
  }

  // Check username audit trail
  const getProfileWithUnameHist = await (await fetch('http://localhost:8080/api/user/profile', {
    headers: { 'Cookie': userCookieHeader }
  })).json();
  assert.strictEqual(getProfileWithUnameHist.profile.username, newUsername);
  assert.strictEqual(getProfileWithUnameHist.profile.usernameHistoryCount, 1);
  assert.strictEqual(getProfileWithUnameHist.profile.usernameHistory[0].oldUsername, testUsername);
  console.log(`✓ Old username "${testUsername}" archived in usernameHistory, active username is "${newUsername}".`);

  // Test 9: Enriched /api/scan with security headers & OpenGraph
  console.log('\nTest 9: Testing enriched /api/scan with Security & Protocol headers...');
  const scanRes = await fetch('http://localhost:8080/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://github.com' })
  });
  assert.strictEqual(scanRes.status, 200);
  const scanData = await scanRes.json();
  assert(scanData.targetUrl.includes('github.com'));
  assert(scanData.scores.security >= 50);
  assert(scanData.auditDetails.securityHeaders);
  assert(scanData.auditDetails.ogTags);
  console.log(`✓ Live scan verified with securityScore: ${scanData.scores.security}/100, OpenGraph title: "${scanData.auditDetails.ogTags.title.substring(0, 30)}..."`);

  // Test 10: XML Sitemap Extractor endpoint
  console.log('\nTest 10: Testing XML Sitemap Extractor (/api/sitemap/extract)...');
  const sitemapRes = await fetch('http://localhost:8080/api/sitemap/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  assert.strictEqual(sitemapRes.status, 200);
  const sitemapData = await sitemapRes.json();
  assert.strictEqual(sitemapData.success, true);
  assert(Array.isArray(sitemapData.urls));
  console.log(`✓ Sitemap endpoint functional. Discovered ${sitemapData.totalUrls} child URLs.`);

  // Test 11: Google Cloud Service Account Validator (/api/gsc/verify-sa)
  console.log('\nTest 11: Testing Service Account Validator (/api/gsc/verify-sa)...');
  const sampleSa = {
    type: 'service_account',
    project_id: 'index-matrix-prod',
    private_key_id: 'key12345678',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----',
    client_email: 'seo-bot@index-matrix-prod.iam.gserviceaccount.com',
    client_id: '1234567890'
  };
  const saRes = await fetch('http://localhost:8080/api/gsc/verify-sa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ serviceAccount: sampleSa })
  });
  assert.strictEqual(saRes.status, 200);
  const saData = await saRes.json();
  assert.strictEqual(saData.valid, true);
  assert.strictEqual(saData.projectId, 'index-matrix-prod');
  assert.strictEqual(saData.clientEmail, 'seo-bot@index-matrix-prod.iam.gserviceaccount.com');
  console.log('✓ Service Account JSON validated successfully.');

  // Test 12: Competitor Keyword Gap Analysis (/api/keywords/compare)
  console.log('\nTest 12: Testing Competitor Gap Analysis (/api/keywords/compare)...');
  const compRes = await fetch('http://localhost:8080/api/keywords/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({
      targetUrl: 'https://stripe.com',
      competitorUrl: 'https://linear.app'
    })
  });
  assert.strictEqual(compRes.status, 200);
  const compData = await compRes.json();
  assert.strictEqual(compData.success, true);
  assert(compData.target.totalKeywords >= 0);
  assert(compData.competitor.totalKeywords >= 0);
  assert(Array.isArray(compData.analysis.competitorGaps));
  console.log(`✓ Competitor Gap Analysis functional. Gaps found: ${compData.analysis.competitorExclusiveCount}, Overlap: ${compData.analysis.overlapCount}`);

  // Test 13: Project History Isolation
  console.log('\nTest 13: Testing Project History user scoping...');
  const newProj = {
    id: `proj_${Date.now()}`,
    url: 'https://mytestsite.com',
    siteName: 'My Test Site',
    uploadedFileName: 'keywords.pdf',
    uploadedFileSize: '42.5 KB',
    uploadedFileDate: 'Sep 4, 2026',
    keywordsCount: 15,
    keywords: [{ term: 'cloud seo automation', count: 5, density: '2.4%', intent: 'Commercial', difficulty: 45 }],
    submissionDate: 'Sep 4, 2026',
    gscStatus: 'Scanned',
    overallScore: 92
  };

  const addHistRes = await fetch('http://localhost:8080/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify(newProj)
  });
  assert.strictEqual(addHistRes.status, 200);

  const getHistRes = await fetch('http://localhost:8080/api/history', {
    headers: { 'Cookie': userCookieHeader }
  });
  const userHistory = await getHistRes.json();
  assert(userHistory.some(p => p.url === 'https://mytestsite.com'));
  console.log('✓ Project history scoped and persisted successfully for user.');

  // Test 14: Non-admin deletion prevention
  console.log('\nTest 14: Verifying regular user CANNOT delete project history (Admin-Only rule)...');
  const userDelRes = await fetch(`http://localhost:8080/api/history/${newProj.id}`, {
    method: 'DELETE',
    headers: { 'Cookie': userCookieHeader }
  });
  assert.strictEqual(userDelRes.status, 403);
  const delErr = await userDelRes.json();
  assert(delErr.error.includes('Permission denied'));
  console.log('✓ Regular user deletion correctly rejected with HTTP 403 Forbidden.');

  // Test 16: Broken Link & Redirect Chain Inspector (/api/links/check)
  console.log('\nTest 16: Testing Broken Link & Redirect Chain Inspector (/api/links/check)...');
  const sampleLinks = [
    { url: 'https://github.com', anchorText: 'GitHub Home', type: 'External' },
    { url: 'http://httpstat.us/301', anchorText: 'Redirect Test', type: 'External' },
    { url: 'https://httpstat.us/404', anchorText: 'Broken Link Test', type: 'External' }
  ];
  const linkCheckRes = await fetch('http://localhost:8080/api/links/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ targetUrl: 'https://github.com', links: sampleLinks })
  });
  assert.strictEqual(linkCheckRes.status, 200);
  const linkCheckData = await linkCheckRes.json();
  assert.strictEqual(linkCheckData.success, true);
  assert(Array.isArray(linkCheckData.links));
  assert.strictEqual(linkCheckData.links.length, 3);
  assert(linkCheckData.summary);
  assert(typeof linkCheckData.summary.healthScore === 'number');
  console.log(`✓ Broken Link Inspector functional. Probed ${linkCheckData.links.length} links with Health Score: ${linkCheckData.summary.healthScore}%.`);

  // Test 17: SEO Health Score History & Velocity Timeline (/api/history/timeline)
  console.log('\nTest 17: Testing Score History Timeline (/api/history/timeline)...');
  const timelineRes = await fetch('http://localhost:8080/api/history/timeline', {
    headers: { 'Cookie': userCookieHeader }
  });
  assert.strictEqual(timelineRes.status, 200);
  const timelineData = await timelineRes.json();
  assert.strictEqual(timelineData.success, true);
  assert(Array.isArray(timelineData.timeline));
  console.log(`✓ Score Timeline functional. Fetched ${timelineData.timeline.length} historical checkpoints.`);

  // Test 18: Authentic Google Indexing API without credentials returns honest 401
  console.log('\nTest 18: Testing authentic Google Indexing API (/api/gsc/publish)...');
  const gscUnauthRes = await fetch('http://localhost:8080/api/gsc/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  assert([401, 403].includes(gscUnauthRes.status), `Expected 401 or 403, got ${gscUnauthRes.status}`);
  const gscUnauthData = await gscUnauthRes.json();
  assert.strictEqual(gscUnauthData.success, false);
  console.log(`✓ Authentic Google Indexing response verified: HTTP ${gscUnauthRes.status} (No fake 200 masking).`);

  // Test 19: Authentic IndexNow protocol endpoint (/api/indexnow/publish)
  console.log('\nTest 19: Testing authentic IndexNow endpoint (/api/indexnow/publish)...');
  const indexNowRes = await fetch('http://localhost:8080/api/indexnow/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  assert.strictEqual(indexNowRes.status, 400);
  const indexNowData = await indexNowRes.json();
  assert.strictEqual(indexNowData.keyRequired, true);
  console.log('✓ Authentic IndexNow response verified: 400 Bad Request with keyRequired prompt.');

  // Test 20: Real Googlebot Technical Crawlability Inspector (/api/gsc/inspect)
  console.log('\nTest 20: Testing real Googlebot Technical Inspector (/api/gsc/inspect)...');
  const inspectRes = await fetch('http://localhost:8080/api/gsc/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  assert.strictEqual(inspectRes.status, 200);
  const inspectData = await inspectRes.json();
  assert.strictEqual(inspectData.success, true);
  assert.strictEqual(inspectData.httpStatus, 200);
  assert(inspectData.crawledAs.includes('Googlebot'));
  assert(typeof inspectData.isIndexable === 'boolean');
  assert(typeof inspectData.robotsTxt === 'object');
  console.log(`✓ Real Googlebot Inspector verified: HTTP ${inspectData.httpStatus}, Crawled as: ${inspectData.crawledAs}, Indexable: ${inspectData.isIndexable}.`);

  // Test 21: Dead URL should be rejected before Google Search Console link generation
  console.log('\nTest 21: Testing dead URL rejection before GSC deep-link generation...');
  const deadPingRes = await fetch('http://localhost:8080/api/crawler/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://httpstat.us/404' })
  });
  assert.strictEqual(deadPingRes.status, 404);
  const deadPingData = await deadPingRes.json();
  assert.strictEqual(deadPingData.success, false);
  assert.strictEqual(deadPingData.gscDeepLink, null);
  console.log('✓ Dead URL rejected before GSC deep-link generation: 404 Not Found blocked.');

  // Test 22: 1-Click Google WebSub Hub Crawler Ping (/api/crawler/ping) - No JSON key required
  console.log('\nTest 22: Testing 1-Click Google WebSub Crawler Ping (/api/crawler/ping)...');
  const pingRes = await fetch('http://localhost:8080/api/crawler/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': userCookieHeader },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  assert.strictEqual(pingRes.status, 200);
  const pingData = await pingRes.json();
  assert.strictEqual(pingData.success, true);
  assert.strictEqual(typeof pingData.googleWebSub, 'object');
  assert(pingData.gscDeepLink.includes('search.google.com/search-console/inspect'));
  const gscLink = new URL(pingData.gscDeepLink);
  assert.strictEqual(gscLink.searchParams.get('url'), 'https://example.com');
  assert.strictEqual(gscLink.searchParams.get('resource_id'), 'https://example.com/');
  console.log(`✓ 1-Click Google WebSub Ping verified: Status ${pingData.status} (Google Frontend hub), Deep-link: ${pingData.gscDeepLink}.`);

  // Cleanup: Remove temporary test user and test records to prevent test pollution
  try {
    const fs = require('fs');
    const path = require('path');
    const db = require('../db.js');
    await db.connectDb();
    const tempUsers = [testAdminUsername, testUsername, newUsername];
    if (db.isMongoConnected()) {
      const mongoose = require('mongoose');
      const UserModel = mongoose.models.User;
      const HistoryModel = mongoose.models.History;
      const DispatchLogModel = mongoose.models.DispatchLog;
      const LoginEventModel = mongoose.models.LoginEvent;
      if (UserModel) await UserModel.deleteMany({ username: { $in: tempUsers } });
      if (HistoryModel) await HistoryModel.deleteMany({ username: { $in: tempUsers } });
      if (DispatchLogModel) await DispatchLogModel.deleteMany({ username: { $in: tempUsers } });
      if (LoginEventModel) await LoginEventModel.deleteMany({ username: { $in: tempUsers } });
    }
    const uFile = path.join(__dirname, '..', 'data', 'users.json');
    if (fs.existsSync(uFile)) {
      const uList = JSON.parse(fs.readFileSync(uFile, 'utf8') || '[]');
      fs.writeFileSync(uFile, JSON.stringify(uList.filter(u => !tempUsers.includes(u.username)), null, 2), 'utf8');
    }
    const hFile = path.join(__dirname, '..', 'data', 'history.json');
    if (fs.existsSync(hFile)) {
      const hList = JSON.parse(fs.readFileSync(hFile, 'utf8') || '[]');
      fs.writeFileSync(hFile, JSON.stringify(hList.filter(h => !tempUsers.includes(h.username)), null, 2), 'utf8');
    }
    const dFile = path.join(__dirname, '..', 'data', 'dispatch-logs.json');
    if (fs.existsSync(dFile)) {
      const dList = JSON.parse(fs.readFileSync(dFile, 'utf8') || '[]');
      fs.writeFileSync(dFile, JSON.stringify(dList.filter(d => !tempUsers.includes(d.username)), null, 2), 'utf8');
    }
    const lFile = path.join(__dirname, '..', 'data', 'login-events.json');
    if (fs.existsSync(lFile)) {
      const lList = JSON.parse(fs.readFileSync(lFile, 'utf8') || '[]');
      fs.writeFileSync(lFile, JSON.stringify(lList.filter(l => !tempUsers.includes(l.username)), null, 2), 'utf8');
    }
    console.log('✓ Automated test sandbox data completely expunged from MongoDB Atlas & local files.');
  } catch (e) {
    console.error('Teardown warning:', e.message);
  }

  console.log('\n====================================================');
  console.log('🎉 ALL 21 AUTOMATED API & FEATURE TESTS PASSED 100%!');
  console.log('====================================================\n');
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
