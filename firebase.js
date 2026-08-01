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

// Default WhatsApp numbers for round-robin load distribution
const DEFAULT_WHATSAPP_NUMBERS = [
  '51900962934',
  '51931248203',
  '51928391496'
];

/**
 * Retrieves current contact configuration from Firestore or Mock DB
 */
async function getContactoInfo() {
  if (!isMock && db) {
    try {
      const docRef = db.collection('contacto').doc('contacto');
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        return { id: docSnap.id, ...docSnap.data() };
      }
      // Check collection if doc 'contacto' doesn't exist directly
      const snapshot = await db.collection('contacto').get();
      if (!snapshot.empty) {
        const firstDoc = snapshot.docs[0];
        return { id: firstDoc.id, ...firstDoc.data() };
      }
    } catch (err) {
      console.warn('⚠️ Error fetching contacto info from Firestore:', err.message);
    }
  }

  // Fallback / Mock mode
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (fs.existsSync(mockFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
      if (data.contacto) return data.contacto;
    } catch (e) {}
  }

  return {
    numeros: DEFAULT_WHATSAPP_NUMBERS,
    indiceActual: 0
  };
}

/**
 * Gets the next rotated WhatsApp number for client orders and updates the database document.
 * If document "contacto" does not exist in Firestore or Mock DB, creates it starting with index 0.
 */
async function getNextContactoNumber() {
  if (!isMock && db) {
    try {
      const docRef = db.collection('contacto').doc('contacto');
      const docSnap = await docRef.get();

      let numeros = DEFAULT_WHATSAPP_NUMBERS;
      let indiceActual = 0;
      let targetRef = docRef;

      if (!docSnap.exists) {
        // Check if any doc exists in collection 'contacto'
        const snapshot = await db.collection('contacto').get();
        if (snapshot.empty) {
          console.log('📌 Firestore document "contacto" does not exist. Creating default document starting at index 0...');
          const initialData = {
            numeros: DEFAULT_WHATSAPP_NUMBERS,
            indiceActual: 0,
            creadoEn: admin.firestore.FieldValue.serverTimestamp(),
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
          };
          await docRef.set(initialData);
        } else {
          targetRef = snapshot.docs[0].ref;
          const data = snapshot.docs[0].data();
          if (Array.isArray(data.numeros) && data.numeros.length > 0) {
            numeros = data.numeros;
          }
          if (typeof data.indiceActual === 'number') {
            indiceActual = data.indiceActual;
          }
        }
      } else {
        const data = docSnap.data();
        if (Array.isArray(data.numeros) && data.numeros.length > 0) {
          numeros = data.numeros;
        }
        if (typeof data.indiceActual === 'number') {
          indiceActual = data.indiceActual;
        }
      }

      // Calculate index for current customer
      const currentIndex = (indiceActual % numeros.length + numeros.length) % numeros.length;
      const selectedNumber = numeros[currentIndex];

      // Advance index for the next customer
      const nextIndex = (currentIndex + 1) % numeros.length;
      await targetRef.set({
        numeros,
        indiceActual: nextIndex,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`📱 [Firestore Contact Rotation] Client connected to: ${selectedNumber} (Index: ${currentIndex} -> Next: ${nextIndex})`);

      return {
        whatsappNumber: selectedNumber,
        indiceActual: currentIndex,
        nextIndice: nextIndex,
        numeros
      };
    } catch (error) {
      console.error('❌ Firestore Contact Rotation Error:', error.message);
    }
  }

  // Local Mock / Fallback Mode
  const mockFilePath = path.join(__dirname, 'mockData.json');
  let data = mockData;
  if (fs.existsSync(mockFilePath)) {
    try {
      data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
    } catch (e) {
      data = mockData || {};
    }
  }

  if (!data.contacto || !Array.isArray(data.contacto.numeros) || data.contacto.numeros.length === 0) {
    data.contacto = {
      id: 'contacto_doc',
      numeros: DEFAULT_WHATSAPP_NUMBERS,
      indiceActual: 0
    };
  }

  const numeros = data.contacto.numeros;
  const currentIndex = (data.contacto.indiceActual % numeros.length + numeros.length) % numeros.length;
  const selectedNumber = numeros[currentIndex];
  const nextIndex = (currentIndex + 1) % numeros.length;

  data.contacto.indiceActual = nextIndex;
  mockData = data;

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not persist updated mockData.json:', err.message);
  }

  console.log(`📱 [Mock Contact Rotation] Client connected to: ${selectedNumber} (Index: ${currentIndex} -> Next: ${nextIndex})`);

  return {
    whatsappNumber: selectedNumber,
    indiceActual: currentIndex,
    nextIndice: nextIndex,
    numeros
  };
}

module.exports = {
  db,
  isMock,
  getFirebaseConfig,
  executeFirebaseQuery,
  getContactoInfo,
  getNextContactoNumber
};

