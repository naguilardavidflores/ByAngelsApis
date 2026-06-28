const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let db = null;
let isMock = false;
let mockData = null;

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

// FUNCIÓN 2: Ejecutar peticiones a la base de datos (con fallback automático)
async function executeFirebaseQuery(collectionName) {
  if (isMock) {
    return mockData[collectionName] || [];
  }

  try {
    const snapshot = await db.collection(collectionName).get();
    const items = [];
    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });
    return items;
  } catch (error) {
    console.error(`Error querying Firestore collection "${collectionName}":`, error);
    // Fallback de seguridad al archivo JSON local
    const mockFilePath = path.join(__dirname, 'mockData.json');
    if (fs.existsSync(mockFilePath)) {
      const data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
      return data[collectionName] || [];
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
