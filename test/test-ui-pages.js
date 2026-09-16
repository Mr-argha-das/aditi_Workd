const assert = require('assert');

async function testAllPages() {
  console.log('🔍 Testing All Application Pages & Assets...\n');

  const path = require('path');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.connectDb();
  const randomSuffix = Date.now().toString().slice(-4);
  const adminUser = `ui_test_${randomSuffix}`;
  const adminPass = 'UiTestPass123!';
  await db.createUser(adminUser, adminPass, 'admin', 'UI Test Admin');

  const loginRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPass })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const pages = [
    { url: '/login.html', isPublic: true, name: 'Portal Gatekeeper' },
    { url: '/index.html', isPublic: false, name: 'Master Dashboard' },
    { url: '/indexer.html', isPublic: false, name: 'Bot Indexer' },
    { url: '/keywords.html', isPublic: false, name: 'Keywords & Files' },
    { url: '/console.html', isPublic: false, name: 'Google Console Hub' },
    { url: '/audit.html', isPublic: false, name: 'Technical SEO Audit' },
    { url: '/reports.html', isPublic: false, name: 'Schema & Export' },
    { url: '/admin/admin.html', isPublic: false, name: 'Admin Control Center' }
  ];

  for (const page of pages) {
    const headers = page.isPublic ? {} : { 'Cookie': adminCookie };
    const res = await fetch(`http://localhost:8080${page.url}`, { headers });
    assert.strictEqual(res.status, 200, `Page ${page.url} returned status ${res.status}`);
    const text = await res.text();
    assert(text.includes('INDEX MATRIX'), `Page ${page.url} missing dynamic brand name INDEX MATRIX`);
    console.log(`✓ ${page.name} (${page.url}) verified -> HTTP 200 OK`);
  }

  // Check static CSS & JS files
  const assets = [
    '/css/style.css',
    '/js/app.js',
    '/js/indexer.js',
    '/js/pdf-parser.js',
    '/seo-nexus-pixel.js'
  ];

  for (const asset of assets) {
    const res = await fetch(`http://localhost:8080${asset}`);
    assert.strictEqual(res.status, 200, `Asset ${asset} returned status ${res.status}`);
    console.log(`✓ Static asset (${asset}) verified -> HTTP 200 OK`);
  }

  // Clean up sandbox test user from MongoDB Atlas
  const mongoose = require('mongoose');
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    await mongoose.connection.collection('users').deleteOne({ username: adminUser });
    await mongoose.connection.collection('loginevents').deleteMany({ username: adminUser });
    await mongoose.disconnect();
  }
  const fs = require('fs');
  const lFile = path.join(__dirname, '..', 'data', 'login-events.json');
  if (fs.existsSync(lFile)) {
    const lList = JSON.parse(fs.readFileSync(lFile, 'utf8') || '[]');
    fs.writeFileSync(lFile, JSON.stringify(lList.filter(l => l.username !== adminUser), null, 2), 'utf8');
  }

  console.log('\n🎉 ALL PAGES AND ASSETS VALIDATED WITH ZERO ERRORS!');
  process.exit(0);
}

testAllPages().catch(err => {
  console.error('❌ Page validation failed:', err);
  process.exit(1);
});
