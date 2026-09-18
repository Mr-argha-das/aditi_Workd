/**
 * INDEX MATRIX - Unified Database Engine
 * 
 * Hybrid MongoDB (Mongoose) + Local File Storage Fallback Engine
 * Supports:
 * - User Authentication & Profile (Name, Phone without OTP)
 * - Username & Password Change with Historical Audit Archives
 * - Admin-Only History Deletion Enforcement
 * - User-Scoped Crawl & Project History
 * - User-Scoped Bot Dispatch Logs & Stamps
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let mongoose = null;
try {
  mongoose = require('mongoose');
} catch (e) {
  console.warn('Mongoose package loading check:', e.message);
}

// Load environment variables from root .env if present
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    });
  } catch (e) {}
}

// Local Storage Directory
const IS_VERCEL = !!process.env.VERCEL;
const BASE_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : BASE_DATA_DIR;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const LOGS_FILE = path.join(DATA_DIR, 'dispatch-logs.json');
const LOGIN_EVENTS_FILE = path.join(DATA_DIR, 'login-events.json');
const GLOBAL_GSC_FILE = path.join(DATA_DIR, 'global-gsc.json');
const RELAY_LINKS_FILE = path.join(DATA_DIR, 'relay-links.json');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn('Failed to create DATA_DIR:', e.message);
  }
}

// When on Vercel, initialize /tmp/data with seed files from packaged data directory
if (IS_VERCEL && fs.existsSync(BASE_DATA_DIR)) {
  try {
    const files = fs.readdirSync(BASE_DATA_DIR);
    files.forEach(file => {
      const src = path.join(BASE_DATA_DIR, file);
      const dest = path.join(DATA_DIR, file);
      if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    });
  } catch (e) {
    console.warn('Vercel data seed error:', e.message);
  }
}


// Local Database Helpers
function readJsonFile(file, defaultValue = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message);
  }
  return defaultValue;
}

function writeJsonFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing ${file}:`, e.message);
  }
}

// Password Hashing Security (PBKDF2 with 10,000 iterations)
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !password || typeof storedHash !== 'string') return false;
  if (!storedHash.includes(':')) return false;
  try {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;
    const checkHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    const bufA = Buffer.from(originalHash, 'hex');
    const bufB = Buffer.from(checkHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) {
    return false;
  }
}

// MongoDB Connection State
let isMongoConnected = false;
let UserModel = null;
let HistoryModel = null;
let DispatchLogModel = null;
let LoginEventModel = null;
let RelayLinkModel = null;

async function initMongoSchemas() {
  if (!mongoose) return;

  const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: '' },
    phone: { type: String, default: '' },
    role: { type: String, default: 'user' },
    activeProject: { type: Object, default: null },
    gscCredentials: { type: Object, default: {} },
    passwordHistory: [{
      passwordHash: { type: String },
      changedAt: { type: Date, default: Date.now }
    }],
    usernameHistory: [{
      oldUsername: { type: String },
      changedAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date }
  });

  const HistorySchema = new mongoose.Schema({
    username: { type: String, required: true, index: true },
    id: { type: String, required: true },
    url: { type: String, required: true },
    siteName: { type: String },
    uploadedFileName: { type: String },
    uploadedFileSize: { type: String },
    uploadedFileDate: { type: String },
    keywordsCount: { type: Number, default: 0 },
    keywords: { type: Array, default: [] },
    submissionDate: { type: String },
    gscStatus: { type: String },
    overallScore: { type: Number, default: 0 },
    scores: { type: Object, default: {} },
    auditDetails: { type: Object, default: {} },
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    primaryKeywords: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now }
  }, { strict: false });

  const DispatchLogSchema = new mongoose.Schema({
    username: { type: String, required: true, index: true },
    id: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String, default: 'Webpage' },
    timestamp: { type: String, required: true },
    readableTime: { type: String },
    loadTime: { type: String, default: '1.1s' },
    type: { type: String, default: 'URL_UPDATED' },
    googlePingStatus: { type: Number, default: 200 },
    indexNowStatus: { type: Number, default: 200 },
    clientIp: { type: String, default: '127.0.0.1' },
    status: { type: String, default: 'DISPATCHED' },
    createdAt: { type: Date, default: Date.now }
  });

  const LoginEventSchema = new mongoose.Schema({
    id: { type: String },
    username: { type: String, required: true, index: true },
    type: { type: String, enum: ['login', 'logout'], required: true },
    ip: { type: String, default: 'unknown' },
    userAgent: { type: String, default: '' },
    timestamp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true }
  });

  const RelayLinkSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    url: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    domain: { type: String, default: '' },
    submittedAt: { type: String, default: () => new Date().toISOString() },
    lastPing: { type: String, default: () => new Date().toISOString() },
    botPingCount: { type: Number, default: 1 },
    status: { type: String, default: 'RELAYED' },
    source: { type: String, default: 'standalone' },
    createdAt: { type: Date, default: Date.now, index: true }
  });

  UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
  HistoryModel = mongoose.models.History || mongoose.model('History', HistorySchema);
  DispatchLogModel = mongoose.models.DispatchLog || mongoose.model('DispatchLog', DispatchLogSchema);
  LoginEventModel = mongoose.models.LoginEvent || mongoose.model('LoginEvent', LoginEventSchema);
  RelayLinkModel = mongoose.models.RelayLink || mongoose.model('RelayLink', RelayLinkSchema);
}

async function connectDb() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (mongoUri && mongoose) {
    try {
      console.log('🔄 Connecting to MongoDB database...');
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000
      });
      isMongoConnected = true;
      await initMongoSchemas();
      console.log('✅ MongoDB connected successfully to INDEX MATRIX database.');
    } catch (err) {
      console.warn('⚠️  MongoDB connection notice:', err.message);
      console.log('📁 Using local persistent JSON database fallback (seamless operation).');
      isMongoConnected = false;
    }
  } else {
    console.log('📁 Local persistent JSON database active (Ready for MongoDB string in .env).');
  }
}

/* ==========================================================================
   User Management Methods
   ========================================================================== */

async function findUser(username) {
  if (!username) return null;
  const cleanUsername = username.toLowerCase().trim();

  if (isMongoConnected && UserModel) {
    try {
      const user = await UserModel.findOne({ username: cleanUsername });
      if (user) return user.toObject();
    } catch (e) {}
  }

  const users = readJsonFile(USERS_FILE, []);
  return users.find(u => u.username === cleanUsername) || null;
}

async function createUser(username, password, role = 'user', displayName = '', phone = '') {
  if (!username || !password) throw new Error('Username and password are required');
  const cleanUsername = username.toLowerCase().trim();

  if (cleanUsername.length < 3) throw new Error('Username must be at least 3 characters');
  if (password.length < 4) throw new Error('Password must be at least 4 characters');

  const existing = await findUser(cleanUsername);
  if (existing) throw new Error('Username already exists');

  const passwordHash = hashPassword(password);
  const now = new Date();

  if (isMongoConnected && UserModel) {
    const newUser = await UserModel.create({
      username: cleanUsername,
      passwordHash,
      displayName: displayName || cleanUsername,
      phone: phone || '',
      role,
      passwordHistory: [],
      usernameHistory: [],
      createdAt: now
    });
    return newUser.toObject();
  }

  const users = readJsonFile(USERS_FILE, []);
  const newUser = {
    id: 'usr_' + Date.now(),
    username: cleanUsername,
    passwordHash,
    displayName: displayName || cleanUsername,
    phone: phone || '',
    role,
    passwordHistory: [],
    usernameHistory: [],
    createdAt: now.toISOString()
  };
  users.push(newUser);
  writeJsonFile(USERS_FILE, users);
  return newUser;
}

async function verifyUserCredentials(username, password) {
  const user = await findUser(username);
  if (!user) return null;

  if (verifyPassword(password, user.passwordHash)) {
    if (isMongoConnected && UserModel) {
      UserModel.updateOne({ username: user.username }, { lastLogin: new Date() }).exec().catch(() => {});
    } else {
      const users = readJsonFile(USERS_FILE, []);
      const idx = users.findIndex(u => u.username === user.username);
      if (idx !== -1) {
        users[idx].lastLogin = new Date().toISOString();
        writeJsonFile(USERS_FILE, users);
      }
    }
    return {
      username: user.username,
      role: user.role || 'user',
      displayName: user.displayName || user.username,
      phone: user.phone || ''
    };
  }
  return null;
}

/* ==========================================================================
   User Profile & Password Update with History Archive
   ========================================================================== */

async function getUserProfile(username) {
  const user = await findUser(username);
  if (!user) return null;

  return {
    username: user.username,
    displayName: user.displayName || '',
    phone: user.phone || '',
    role: user.role || 'user',
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    passwordHistoryCount: (user.passwordHistory || []).length,
    usernameHistoryCount: (user.usernameHistory || []).length,
    usernameHistory: user.usernameHistory || [],
    passwordHistory: (user.passwordHistory || []).map(p => ({
      changedAt: p.changedAt
    }))
  };
}

async function updateUserProfile(currentUsername, updates, requestingUser) {
  const user = await findUser(currentUsername);
  if (!user) throw new Error('User not found');

  const isSelfOrAdmin = requestingUser.username === user.username || requestingUser.role === 'admin';
  if (!isSelfOrAdmin) throw new Error('Unauthorized profile modification attempt');

  const now = new Date();
  let updatedUsername = user.username;
  let updatedPasswordHash = user.passwordHash;
  const usernameHistory = user.usernameHistory || [];
  const passwordHistory = user.passwordHistory || [];

  // 1. Update Name & Phone (without OTP)
  let updatedDisplayName = updates.displayName !== undefined ? updates.displayName.trim() : (user.displayName || '');
  let updatedPhone = updates.phone !== undefined ? updates.phone.trim() : (user.phone || '');

  // 2. Update Username (Archives old username into usernameHistory)
  if (updates.newUsername && updates.newUsername.toLowerCase().trim() !== user.username) {
    const cleanNewUsername = updates.newUsername.toLowerCase().trim();
    if (cleanNewUsername.length < 3) throw new Error('New username must be at least 3 characters');

    const usernameTaken = await findUser(cleanNewUsername);
    if (usernameTaken) throw new Error(`Username "${cleanNewUsername}" is already taken`);

    // Archive current username
    usernameHistory.push({
      oldUsername: user.username,
      changedAt: now
    });
    updatedUsername = cleanNewUsername;

    // Migrate user's history and logs to new username
    await migrateUserRecords(user.username, cleanNewUsername);
  }

  // 3. Update Password (Verifies current password & archives old password hash into passwordHistory)
  if (updates.newPassword) {
    if (updates.newPassword.length < 4) throw new Error('New password must be at least 4 characters');

    // Admin can reset password without knowing old password; regular user must provide currentPassword
    if (requestingUser.role !== 'admin') {
      if (!updates.currentPassword) throw new Error('Current password is required to set a new password');
      if (!verifyPassword(updates.currentPassword, user.passwordHash)) {
        throw new Error('Current password does not match');
      }
    }

    // Archive old password hash into history
    passwordHistory.push({
      passwordHash: user.passwordHash,
      changedAt: now
    });

    updatedPasswordHash = hashPassword(updates.newPassword);
  }

  // Save changes to MongoDB or Local JSON
  if (isMongoConnected && UserModel) {
    await UserModel.updateOne(
      { username: user.username },
      {
        username: updatedUsername,
        displayName: updatedDisplayName,
        phone: updatedPhone,
        passwordHash: updatedPasswordHash,
        usernameHistory,
        passwordHistory
      }
    );
  } else {
    const users = readJsonFile(USERS_FILE, []);
    const idx = users.findIndex(u => u.username === user.username);
    if (idx !== -1) {
      users[idx] = {
        ...users[idx],
        username: updatedUsername,
        displayName: updatedDisplayName,
        phone: updatedPhone,
        passwordHash: updatedPasswordHash,
        usernameHistory,
        passwordHistory
      };
      writeJsonFile(USERS_FILE, users);
    }
  }

  return {
    username: updatedUsername,
    displayName: updatedDisplayName,
    phone: updatedPhone,
    role: user.role || 'user',
    usernameChanged: updatedUsername !== user.username,
    passwordChanged: !!updates.newPassword
  };
}

async function migrateUserRecords(oldUsername, newUsername) {
  if (isMongoConnected) {
    if (HistoryModel) {
      await HistoryModel.updateMany({ username: oldUsername }, { username: newUsername }).catch(() => {});
    }
    if (DispatchLogModel) {
      await DispatchLogModel.updateMany({ username: oldUsername }, { username: newUsername }).catch(() => {});
    }
    if (LoginEventModel) {
      await LoginEventModel.updateMany({ username: oldUsername }, { username: newUsername }).catch(() => {});
    }
  }

  let history = readJsonFile(HISTORY_FILE, []);
  history = history.map(h => h.username === oldUsername ? { ...h, username: newUsername } : h);
  writeJsonFile(HISTORY_FILE, history);

  let logs = readJsonFile(LOGS_FILE, []);
  logs = logs.map(l => l.username === oldUsername ? { ...l, username: newUsername } : l);
  writeJsonFile(LOGS_FILE, logs);

  let events = readJsonFile(LOGIN_EVENTS_FILE, []);
  events = events.map(e => e.username === oldUsername ? { ...e, username: newUsername } : e);
  writeJsonFile(LOGIN_EVENTS_FILE, events);
}

/* ==========================================================================
   User-Scoped Crawl & Project History Methods (Admin-Only Deletion)
   ========================================================================== */

async function getUserHistory(username) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) return [];

  if (isMongoConnected && HistoryModel) {
    try {
      const records = await HistoryModel.find({ username: cleanUsername })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      return records;
    } catch (e) {}
  }

  const allHistory = readJsonFile(HISTORY_FILE, []);
  return allHistory.filter(item => item.username && item.username.toLowerCase() === cleanUsername);
}

async function saveUserHistory(username, item) {
  if (!item || !item.url) throw new Error('Invalid project record');
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('User identity required to save project record');

  const record = {
    ...item,
    username: cleanUsername,
    id: item.id || 'proj_' + Date.now(),
    createdAt: item.createdAt || new Date().toISOString()
  };

  if (isMongoConnected && HistoryModel) {
    try {
      await HistoryModel.findOneAndUpdate(
        { username: cleanUsername, url: item.url },
        record,
        { upsert: true, returnDocument: 'after' }
      );
    } catch (e) {
      console.error('MongoDB save history error:', e.message);
    }
  }

  let history = readJsonFile(HISTORY_FILE, []);
  history = history.filter(p => !(p.username === cleanUsername && (p.url === item.url || p.id === item.id)));
  history.unshift(record);
  if (history.length > 200) history = history.slice(0, 200);
  writeJsonFile(HISTORY_FILE, history);

  return record;
}

async function deleteUserHistory(requestingUser, username, projectId) {
  // STRICT PERMISSION: Only admin can delete history
  if (!requestingUser || requestingUser.role !== 'admin') {
    throw new Error('Permission denied. Only administrators can delete history records.');
  }

  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('Target username required');

  if (isMongoConnected && HistoryModel) {
    try {
      await HistoryModel.deleteOne({
        username: cleanUsername,
        $or: [{ id: projectId }, { url: projectId }]
      });
    } catch (e) {}
  }

  let history = readJsonFile(HISTORY_FILE, []);
  history = history.filter(p => !(p.username === cleanUsername && (p.id === projectId || p.url === projectId)));
  writeJsonFile(HISTORY_FILE, history);
  return true;
}

async function clearAllUserHistory(requestingUser, username) {
  // STRICT PERMISSION: Only admin can clear all history
  if (!requestingUser || requestingUser.role !== 'admin') {
    throw new Error('Permission denied. Only administrators can clear history records.');
  }

  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('Target username required');

  if (isMongoConnected && HistoryModel) {
    try {
      await HistoryModel.deleteMany({ username: cleanUsername });
    } catch (e) {}
  }

  await clearActiveProject(cleanUsername);

  let history = readJsonFile(HISTORY_FILE, []);
  history = history.filter(p => p.username !== cleanUsername);
  writeJsonFile(HISTORY_FILE, history);
  return true;
}

/* ==========================================================================
   Active Project State Methods (MongoDB-Driven, Zero Local Storage)
   ========================================================================== */

async function getActiveProject(username) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) return null;

  if (isMongoConnected && UserModel) {
    try {
      const user = await UserModel.findOne({ username: cleanUsername }, { activeProject: 1 }).lean();
      if (user && user.activeProject && (user.activeProject.targetUrl || user.activeProject.url)) {
        return user.activeProject;
      }
    } catch (e) {
      console.error('MongoDB getActiveProject error:', e.message);
    }
  }

  // Never auto-fetch old URLs from past history. Only an explicitly active scan is returned.
  return null;
}

async function setActiveProject(username, projectData) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('User required');

  if (isMongoConnected && UserModel) {
    try {
      await UserModel.updateOne({ username: cleanUsername }, { $set: { activeProject: projectData } });
    } catch (e) {
      console.error('MongoDB setActiveProject error:', e.message);
    }
  }
  return projectData;
}

async function clearActiveProject(username) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) return;

  if (isMongoConnected && UserModel) {
    try {
      await UserModel.updateOne({ username: cleanUsername }, { $unset: { activeProject: 1 } });
    } catch (e) {
      console.error('MongoDB clearActiveProject error:', e.message);
    }
  }
}

/* ==========================================================================
   Google Search Console Credentials in MongoDB
   ========================================================================== */

async function getGscCredentials(username) {
  const cleanUsername = (username || '').toLowerCase().trim();
  let userCreds = null;

  if (cleanUsername) {
    if (isMongoConnected && UserModel) {
      try {
        const user = await UserModel.findOne({ username: cleanUsername }, { gscCredentials: 1 }).lean();
        userCreds = user?.gscCredentials;
      } catch (e) {}
    } else {
      const users = readJsonFile(USERS_FILE, []);
      const user = users.find(u => (u.username || '').toLowerCase() === cleanUsername);
      userCreds = user?.gscCredentials;
    }
  }

  // If user has specific credentials configured, return them
  if (userCreds && (userCreds.serviceAccountKey || (userCreds.email && userCreds.token))) {
    return userCreds;
  }

  // Fallback 1: Organization-Wide Master Service Account in global-gsc.json
  const globalCreds = readJsonFile(GLOBAL_GSC_FILE, null);
  if (globalCreds && (globalCreds.serviceAccountKey || (globalCreds.email && globalCreds.token))) {
    return { ...globalCreds, isGlobal: true };
  }

  // Fallback 2: Any Admin user credentials saved in MongoDB / users.json
  if (isMongoConnected && UserModel) {
    try {
      const adminUser = await UserModel.findOne(
        { role: 'admin', $or: [{ 'gscCredentials.email': { $exists: true } }, { 'gscCredentials.serviceAccountKey': { $exists: true } }] },
        { gscCredentials: 1 }
      ).lean();
      if (adminUser?.gscCredentials && (adminUser.gscCredentials.email || adminUser.gscCredentials.serviceAccountKey)) {
        return { ...adminUser.gscCredentials, isGlobal: true };
      }
    } catch (e) {}
  } else {
    const users = readJsonFile(USERS_FILE, []);
    const adminUser = users.find(u => u.role === 'admin' && (u.gscCredentials?.email || u.gscCredentials?.serviceAccountKey));
    if (adminUser?.gscCredentials) {
      return { ...adminUser.gscCredentials, isGlobal: true };
    }
  }

  // Fallback 3: service-account.json placed in workspace root
  const rootSaPath = path.join(__dirname, 'service-account.json');
  if (fs.existsSync(rootSaPath)) {
    try {
      const saContent = JSON.parse(fs.readFileSync(rootSaPath, 'utf8'));
      if (saContent.client_email && saContent.private_key) {
        return {
          email: saContent.client_email,
          token: saContent.private_key,
          serviceAccountKey: saContent,
          projectId: saContent.project_id,
          isGlobal: true,
          source: 'service-account.json'
        };
      }
    } catch (e) {}
  }

  return {};
}

async function saveGscCredentials(username, creds) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('User required');

  if (isMongoConnected && UserModel) {
    try {
      await UserModel.updateOne({ username: cleanUsername }, { $set: { gscCredentials: creds } });
    } catch (e) {}
  }
  const users = readJsonFile(USERS_FILE, []);
  const u = users.find(x => (x.username || '').toLowerCase() === cleanUsername);
  if (u) {
    u.gscCredentials = creds;
    writeJsonFile(USERS_FILE, users);
  }

  // Save as Organization-Wide Master Service Account so all employees share it automatically
  const isAdmin = u?.role === 'admin' || cleanUsername.includes('admin');
  if (isAdmin || creds.setAsGlobal !== false || !fs.existsSync(GLOBAL_GSC_FILE)) {
    writeJsonFile(GLOBAL_GSC_FILE, { ...creds, isGlobal: true, configuredBy: cleanUsername, updatedAt: new Date().toISOString() });
  }

  return creds;
}

/* ==========================================================================
   User-Scoped Bot Dispatch Logs & Stamps (Admin-Only Deletion)
   ========================================================================== */

async function getUserDispatchLogs(username) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) return [];

  if (isMongoConnected && DispatchLogModel) {
    try {
      const logs = await DispatchLogModel.find({ username: cleanUsername })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      return logs;
    } catch (e) {}
  }

  const allLogs = readJsonFile(LOGS_FILE, []);
  return allLogs.filter(log => log.username && log.username.toLowerCase() === cleanUsername);
}

async function saveUserDispatchLog(username, entry) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('User identity required to save dispatch log');

  const logEntry = {
    ...entry,
    username: cleanUsername,
    id: entry.id || 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  if (isMongoConnected && DispatchLogModel) {
    try {
      await DispatchLogModel.create(logEntry);
    } catch (e) {
      console.error('MongoDB save dispatch log error:', e.message);
    }
  }

  let logs = readJsonFile(LOGS_FILE, []);
  logs.unshift(logEntry);
  if (logs.length > 500) logs.length = 500;
  writeJsonFile(LOGS_FILE, logs);

  return logEntry;
}

async function clearUserDispatchLogs(requestingUser, username) {
  // STRICT PERMISSION: Only admin can clear logs
  if (!requestingUser || requestingUser.role !== 'admin') {
    throw new Error('Permission denied. Only administrators can clear dispatch logs.');
  }

  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) throw new Error('Target username required');

  if (isMongoConnected && DispatchLogModel) {
    try {
      await DispatchLogModel.deleteMany({ username: cleanUsername });
    } catch (e) {}
  }

  let logs = readJsonFile(LOGS_FILE, []);
  logs = logs.filter(l => l.username && l.username.toLowerCase() !== cleanUsername);
  writeJsonFile(LOGS_FILE, logs);
  return true;
}

/* ==========================================================================
   Login Event Tracking (Per-User Auth Audit Log)
   ========================================================================== */

async function saveLoginEvent(username, type, ip, userAgent) {
  const cleanUsername = (username || 'anonymous').toLowerCase().trim();
  const event = {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    username: cleanUsername,
    type,
    ip: ip || 'unknown',
    userAgent: userAgent || '',
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && LoginEventModel) {
    try { await LoginEventModel.create(event); } catch (e) {}
  }

  let events = readJsonFile(LOGIN_EVENTS_FILE, []);
  events.unshift(event);
  if (events.length > 5000) events = events.slice(0, 5000);
  writeJsonFile(LOGIN_EVENTS_FILE, events);
  return event;
}

async function getLoginEvents(username, limit) {
  const lim = limit || 100;
  const cleanUsername = username ? username.toLowerCase().trim() : null;

  if (isMongoConnected && LoginEventModel) {
    try {
      const query = cleanUsername ? { username: cleanUsername } : {};
      return await LoginEventModel.find(query).sort({ createdAt: -1 }).limit(lim).lean();
    } catch (e) {}
  }

  let events = readJsonFile(LOGIN_EVENTS_FILE, []);
  if (cleanUsername) events = events.filter(e => e.username === cleanUsername);
  return events.slice(0, lim);
}

/* ==========================================================================
   Admin-Only: Global Data Retrieval Across All Users
   ========================================================================== */

async function getAllUsers() {
  if (isMongoConnected && UserModel) {
    try {
      const users = await UserModel.find({}).select('-passwordHash -passwordHistory').lean();
      return users.map(u => ({
        username: u.username,
        displayName: u.displayName || '',
        phone: u.phone || '',
        role: u.role || 'user',
        createdAt: u.createdAt,
        lastLogin: u.lastLogin
      }));
    } catch (e) {}
  }
  const users = readJsonFile(USERS_FILE, []);
  return users.map(u => ({
    username: u.username,
    displayName: u.displayName || '',
    phone: u.phone || '',
    role: u.role || 'user',
    createdAt: u.createdAt,
    lastLogin: u.lastLogin
  }));
}

async function getAllHistoryAdmin() {
  if (isMongoConnected && HistoryModel) {
    try {
      return await HistoryModel.find({}).sort({ createdAt: -1 }).limit(500).lean();
    } catch (e) {}
  }
  const all = readJsonFile(HISTORY_FILE, []);
  return all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 500);
}

async function getAllDispatchLogsAdmin() {
  if (isMongoConnected && DispatchLogModel) {
    try {
      return await DispatchLogModel.find({}).sort({ createdAt: -1 }).limit(500).lean();
    } catch (e) {}
  }
  const all = readJsonFile(LOGS_FILE, []);
  return all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 500);
}

async function getScoreTimeline(username, targetUrl) {
  const cleanUsername = (username || '').toLowerCase().trim();
  if (!cleanUsername) return [];

  let history = await getUserHistory(cleanUsername);
  if (targetUrl) {
    history = history.filter(h => h.url === targetUrl || (targetUrl && (targetUrl.includes(h.url) || h.url.includes(targetUrl))));
  }

  const timeline = [];
  history.forEach(item => {
    const pt = {
      id: item.id,
      url: item.url,
      siteName: item.siteName || item.url,
      date: item.submissionDate || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Recent'),
      timestamp: item.createdAt || new Date().toISOString(),
      overall: item.overallScore || item.scores?.overall || 0,
      onPage: item.scores?.onPage || 0,
      performance: item.scores?.performance || 0,
      crawlability: item.scores?.crawlability || 0,
      security: item.scores?.security || 85,
      keywordsCount: item.keywordsCount || (item.keywords || []).length || 0
    };
    timeline.push(pt);
  });

  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return timeline;
}

/* ==========================================================================
   Tool 3.5: Public Crawl Relay Hub Store (Deduplicated Public Ingestion)
   ========================================================================== */
async function saveRelayLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return [];
  const now = new Date().toISOString();
  const added = [];

  // 1. Primary: MongoDB Cloud Persistence (Survives all deployments, serverless cold starts & git updates)
  if (isMongoConnected && RelayLinkModel) {
    try {
      for (const item of links) {
        if (!item || !item.url) continue;
        let hostname = '';
        try { hostname = new URL(item.url).hostname; } catch (e) { hostname = item.url; }

        const existingDoc = await RelayLinkModel.findOne({ url: item.url });
        if (existingDoc) {
          existingDoc.botPingCount = (existingDoc.botPingCount || 1) + 1;
          existingDoc.lastPing = now;
          if (item.title && (!existingDoc.title || existingDoc.title === existingDoc.url)) {
            existingDoc.title = item.title;
          }
          await existingDoc.save();
          added.push(existingDoc.toObject());
        } else {
          const docId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
          const created = await RelayLinkModel.create({
            id: docId,
            url: item.url,
            title: item.title || hostname,
            domain: hostname,
            submittedAt: now,
            lastPing: now,
            botPingCount: 1,
            status: 'RELAYED',
            source: item.source || 'standalone'
          });
          added.push(created.toObject());
        }
      }

      // Also mirror to local file for fast caching
      const existing = readJsonFile(RELAY_LINKS_FILE, []);
      for (const a of added) {
        const idx = existing.findIndex(e => e.url === a.url);
        if (idx !== -1) {
          existing[idx] = a;
        } else {
          existing.unshift(a);
        }
      }
      writeJsonFile(RELAY_LINKS_FILE, existing.slice(0, 500));
      return added;
    } catch (err) {
      console.warn('MongoDB saveRelayLinks warning, falling back to local file:', err.message);
    }
  }

  // 2. Fallback: Local JSON File Storage
  const existing = readJsonFile(RELAY_LINKS_FILE, []);
  for (const item of links) {
    if (!item || !item.url) continue;
    let hostname = '';
    try { hostname = new URL(item.url).hostname; } catch (e) { hostname = item.url; }

    const idx = existing.findIndex(e => e.url === item.url);
    if (idx !== -1) {
      existing[idx].botPingCount = (existing[idx].botPingCount || 1) + 1;
      existing[idx].lastPing = now;
      if (item.title && (!existing[idx].title || existing[idx].title === existing[idx].url)) {
        existing[idx].title = item.title;
      }
      added.push(existing[idx]);
    } else {
      const entry = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
        url: item.url,
        title: item.title || hostname,
        domain: hostname,
        submittedAt: now,
        lastPing: now,
        botPingCount: 1,
        status: 'RELAYED',
        source: item.source || 'standalone'
      };
      existing.unshift(entry);
      added.push(entry);
    }
  }

  const trimmed = existing.slice(0, 500);
  writeJsonFile(RELAY_LINKS_FILE, trimmed);
  return added;
}

async function getRelayLinks(limit = 100) {
  if (isMongoConnected && RelayLinkModel) {
    try {
      const docs = await RelayLinkModel.find().sort({ submittedAt: -1 }).limit(limit);
      if (docs && docs.length > 0) {
        return docs.map(d => d.toObject());
      }
    } catch (e) {
      console.warn('MongoDB getRelayLinks warning:', e.message);
    }
  }
  const list = readJsonFile(RELAY_LINKS_FILE, []);
  return list.slice(0, limit);
}

async function getRelayStats() {
  if (isMongoConnected && RelayLinkModel) {
    try {
      const totalLinks = await RelayLinkModel.countDocuments();
      const latest = await RelayLinkModel.findOne().sort({ submittedAt: -1 });
      const pingsAgg = await RelayLinkModel.aggregate([
        { $group: { _id: null, total: { $sum: '$botPingCount' } } }
      ]);
      const totalPings = (pingsAgg && pingsAgg[0]?.total) || totalLinks;
      return {
        totalLinks,
        totalPings,
        lastUpdated: latest?.lastPing || latest?.submittedAt || new Date().toISOString()
      };
    } catch (e) {
      console.warn('MongoDB getRelayStats warning:', e.message);
    }
  }

  const list = readJsonFile(RELAY_LINKS_FILE, []);
  const totalPings = list.reduce((acc, curr) => acc + (curr.botPingCount || 1), 0);
  return {
    totalLinks: list.length,
    totalPings,
    lastUpdated: list[0]?.lastPing || list[0]?.submittedAt || new Date().toISOString()
  };
}

async function clearRelayLinks() {
  if (isMongoConnected && RelayLinkModel) {
    try {
      await RelayLinkModel.deleteMany({});
    } catch (e) {}
  }
  writeJsonFile(RELAY_LINKS_FILE, []);
  return true;
}

module.exports = {
  connectDb,
  hashPassword,
  verifyPassword,
  findUser,
  createUser,
  verifyUserCredentials,
  getUserProfile,
  updateUserProfile,
  getUserHistory,
  saveUserHistory,
  deleteUserHistory,
  clearAllUserHistory,
  getUserDispatchLogs,
  saveUserDispatchLog,
  clearUserDispatchLogs,
  getScoreTimeline,
  saveLoginEvent,
  getLoginEvents,
  getAllUsers,
  getAllHistoryAdmin,
  getAllDispatchLogsAdmin,
  getActiveProject,
  setActiveProject,
  clearActiveProject,
  getGscCredentials,
  saveGscCredentials,
  saveRelayLinks,
  getRelayLinks,
  getRelayStats,
  clearRelayLinks,
  isMongoConnected: () => isMongoConnected
};
