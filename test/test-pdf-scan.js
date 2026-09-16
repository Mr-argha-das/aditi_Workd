const assert = require('assert');

async function testPdfKeywordScan() {
  console.log('🧪 Testing PDF Parsing & Keyword Scanning Endpoints...\n');

  const path = require('path');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.connectDb();
  const randomSuffix = Date.now().toString().slice(-4);
  const testUser = `pdf_test_${randomSuffix}`;
  const testPass = 'PdfTestPass123!';
  await db.createUser(testUser, testPass, 'admin', 'PDF Test Admin');

  // 1. Admin login to obtain session token
  const loginRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testUser, password: testPass })
  });
  assert.strictEqual(loginRes.status, 200);
  const cookieHeader = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('✓ Logged in and received session cookie');

  // 2. Create a valid binary PDF buffer with keyword content
  const pdfText = 'Cloud Architecture Enterprise Security Automation Machine Learning Data Analytics Performance Optimization Kubernetes Container Deployment Continuous Integration';
  
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${pdfText.length + 30} >>
stream
BT
/F1 18 Tf
50 720 Td
(${pdfText}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000350 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
450
%%EOF`;

  const pdfBuffer = Buffer.from(pdfString);

  // 3. Construct FormData with the PDF file
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const bodyBuffer = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="seo_strategy_sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    pdfBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  console.log('Testing POST /api/upload-file with real PDF file...');
  const uploadRes = await fetch('http://localhost:8080/api/upload-file', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': cookieHeader
    },
    body: bodyBuffer
  });

  assert.strictEqual(uploadRes.status, 200, `Upload failed with status ${uploadRes.status}`);
  const uploadData = await uploadRes.json();
  assert.strictEqual(uploadData.success, true);
  assert.strictEqual(uploadData.fileName, 'seo_strategy_sample.pdf');
  assert(uploadData.keywordsCount > 0, `Expected keywordsCount > 0, got ${uploadData.keywordsCount}`);
  assert(Array.isArray(uploadData.keywords));
  
  console.log(`✓ PDF Upload & NLP Keyword Parser verified!`);
  console.log(`  File: ${uploadData.fileName} (${uploadData.fileSize})`);
  console.log(`  Extracted Keywords Count: ${uploadData.keywordsCount}`);
  console.log(`  Sample Top Keywords:`, uploadData.keywords.slice(0, 5).map(k => `${k.term} (${k.count}x, ${k.intent})`));

  // 4. Test plain text file upload
  const textContent = 'Digital Marketing Organic Search Technical SEO Website Optimization Meta Tags Link Building SERP Ranking Crawlability Schema Markup';
  const boundaryTxt = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const txtBuffer = Buffer.concat([
    Buffer.from(`--${boundaryTxt}\r\nContent-Disposition: form-data; name="file"; filename="keywords_list.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(textContent),
    Buffer.from(`\r\n--${boundaryTxt}--\r\n`)
  ]);

  console.log('\nTesting POST /api/upload-file with plain text file...');
  const txtUploadRes = await fetch('http://localhost:8080/api/upload-file', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryTxt}`,
      'Cookie': cookieHeader
    },
    body: txtBuffer
  });
  assert.strictEqual(txtUploadRes.status, 200);
  const txtData = await txtUploadRes.json();
  assert.strictEqual(txtData.success, true);
  assert(txtData.keywordsCount > 0);
  console.log(`✓ Plain Text Upload verified! Extracted ${txtData.keywordsCount} keywords from ${txtData.fileName}.`);

  // Clean up sandbox test user from MongoDB Atlas
  const mongoose = require('mongoose');
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    await mongoose.connection.collection('users').deleteOne({ username: testUser });
    await mongoose.connection.collection('loginevents').deleteMany({ username: testUser });
    await mongoose.disconnect();
  }
  const fs = require('fs');
  const lFile = path.join(__dirname, '..', 'data', 'login-events.json');
  if (fs.existsSync(lFile)) {
    const lList = JSON.parse(fs.readFileSync(lFile, 'utf8') || '[]');
    fs.writeFileSync(lFile, JSON.stringify(lList.filter(l => l.username !== testUser), null, 2), 'utf8');
  }

  console.log('\n====================================================');
  console.log('🎉 ALL PDF & DOCUMENT KEYWORD PARSER TESTS PASSED!');
  console.log('====================================================\n');
  process.exit(0);
}

testPdfKeywordScan().catch(err => {
  console.error('\n❌ PDF Keyword Scan Test Failed:', err);
  process.exit(1);
});
