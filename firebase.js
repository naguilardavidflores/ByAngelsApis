const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let db = null;
let isMock = false;
let mockData = null;

// Cache memory and TTL (5 minutes)
const firestoreCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

// FUNCIÓN 1: Configurar y obtener los parámetros de credenciales de Firebase
function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : '';

  return {
    projectId,
    clientEmail,
    privateKey
  };
}


// Inicialización de Firebase Admin SDK usando los parámetros configurados
try {
  const credentials = getFirebaseConfig();

  if (credentials.projectId && credentials.clientEmail && credentials.privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      })
    });
    db = admin.firestore();
    console.log(`Connected to Firebase Firestore project: ${credentials.projectId}`);
  } else {
    throw new Error('Firebase parameters are incomplete.');
  }
} catch (error) {
  console.warn('⚠️ Firebase initialization failed or credentials invalid. Using local Mock Database.');
  isMock = true;
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (fs.existsSync(mockFilePath)) {
    mockData = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
    console.log(`Loaded local mock database fallback. Core has ${mockData.shopReel.length} products.`);
  } else {
    console.error('❌ Error: mockData.json not found!');
    mockData = { shopReel: [], musics: [] };
  }
}

// FUNCIÓN 2: Ejecutar peticiones a la base de datos (con fallback automático y caché)
async function executeFirebaseQuery(collectionName) {
  if (isMock) {
    return mockData[collectionName] || [];
  }

  const now = Date.now();
  if (firestoreCache[collectionName] && (now - firestoreCache[collectionName].timestamp < CACHE_TTL_MS)) {
    console.log(`[Cache Hit] Serving collection "${collectionName}" from memory`);
    return firestoreCache[collectionName].data;
  }

  try {
    console.log(`[Cache Miss] Fetching collection "${collectionName}" from Firebase Firestore`);
    const snapshot = await db.collection(collectionName).get();
    const items = [];
    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });
    
    // Save to cache
    firestoreCache[collectionName] = {
      timestamp: now,
      data: items
    };

    return items;
  } catch (error) {
    console.error(`Error querying Firestore collection "${collectionName}":`, error);
    // Fallback de seguridad al archivo JSON local (también lo cacheamos temporalmente para no reintentar fallidos infinitamente)
    const mockFilePath = path.join(__dirname, 'mockData.json');
    if (fs.existsSync(mockFilePath)) {
      const data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
      const fallbackData = data[collectionName] || [];
      firestoreCache[collectionName] = {
        timestamp: now,
        data: fallbackData
      };
      return fallbackData;
    }
    return [];
  }
}

module.exports = {
  db,
  isMock,
  getFirebaseConfig,
  executeFirebaseQuery
};
