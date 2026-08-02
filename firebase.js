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

/**
 * Creates a new product in the ShopReel collection.
 * Automatically calculates the next incrementing numorden value.
 */
async function createShopReelProduct(productData) {
  // Fetch existing items to calculate auto-incrementing numorden
  const existingProducts = await executeFirebaseQuery('ShopReel');
  let maxOrder = 0;
  existingProducts.forEach(p => {
    const val = Number(p.numorden !== undefined ? p.numorden : p.numOrden);
    if (!isNaN(val) && val > maxOrder) {
      maxOrder = val;
    }
  });

  const nextOrder = maxOrder + 1;
  const formattedProduct = {
    Nombre: productData.Nombre || '',
    Categoria: productData.Categoria || 'Casual',
    Color: productData.Color || '',
    Precio: String(productData.Precio || '0.00'),
    Nuevo: productData.Nuevo === true || productData.Nuevo === 'Si' || productData.Nuevo === 'true' ? 'Si' : 'No',
    Tendencia: productData.Tendencia === true || productData.Tendencia === 'Si' || productData.Tendencia === 'true' ? 'Si' : 'No',
    numorden: String(nextOrder),
    imgReel0: productData.imgReel0 || '',
    imgReel1: productData.imgReel1 || '',
    imgReel2: productData.imgReel2 || '',
    imgReel3: productData.imgReel3 || '',
    imgReel4: productData.imgReel4 || '',
    imgReel5: productData.imgReel5 || '',
    imgReel6: productData.imgReel6 || ''
  };

  // Invalidate cache
  delete firestoreCache['ShopReel'];

  if (!isMock && db) {
    try {
      const docRef = await db.collection('ShopReel').add({
        ...formattedProduct,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
      });
      return { id: docRef.id, ...formattedProduct };
    } catch (err) {
      console.error('Error creating product in Firestore:', err);
    }
  }

  // Mock Fallback
  const mockFilePath = path.join(__dirname, 'mockData.json');
  const newId = 'prod_' + Date.now();
  const createdItem = { id: newId, ...formattedProduct };

  if (!mockData.shopReel) mockData.shopReel = [];
  mockData.shopReel.push(createdItem);

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(mockData, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not update mockData.json on create:', err.message);
  }

  return createdItem;
}

/**
 * Updates an existing product in the ShopReel collection without modifying its numorden.
 */
async function updateShopReelProduct(id, productData) {
  delete firestoreCache['ShopReel'];

  const updatedFields = {
    Nombre: productData.Nombre || '',
    Categoria: productData.Categoria || 'Casual',
    Color: productData.Color || '',
    Precio: String(productData.Precio || '0.00'),
    Nuevo: productData.Nuevo === true || productData.Nuevo === 'Si' || productData.Nuevo === 'true' ? 'Si' : 'No',
    Tendencia: productData.Tendencia === true || productData.Tendencia === 'Si' || productData.Tendencia === 'true' ? 'Si' : 'No',
    imgReel0: productData.imgReel0 || '',
    imgReel1: productData.imgReel1 || '',
    imgReel2: productData.imgReel2 || '',
    imgReel3: productData.imgReel3 || '',
    imgReel4: productData.imgReel4 || '',
    imgReel5: productData.imgReel5 || '',
    imgReel6: productData.imgReel6 || ''
  };

  if (productData.numorden !== undefined && productData.numorden !== null) {
    updatedFields.numorden = String(productData.numorden);
  }

  if (!isMock && db) {
    try {
      await db.collection('ShopReel').doc(id).set(
        {
          ...updatedFields,
          actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return { id, ...updatedFields };
    } catch (err) {
      console.error('Error updating product in Firestore:', err);
    }
  }

  // Mock Fallback
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (mockData.shopReel) {
    const idx = mockData.shopReel.findIndex(p => p.id === id);
    if (idx !== -1) {
      mockData.shopReel[idx] = { ...mockData.shopReel[idx], ...updatedFields };
    }
  }

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(mockData, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not update mockData.json on update:', err.message);
  }

  return { id, ...updatedFields };
}

/**
 * Deletes a product from the ShopReel collection.
 */
async function deleteShopReelProduct(id) {
  delete firestoreCache['ShopReel'];

  if (!isMock && db) {
    try {
      await db.collection('ShopReel').doc(id).delete();
      return { success: true, id };
    } catch (err) {
      console.error('Error deleting product from Firestore:', err);
    }
  }

  // Mock Fallback
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (mockData.shopReel) {
    mockData.shopReel = mockData.shopReel.filter(p => p.id !== id);
  }

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(mockData, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not update mockData.json on delete:', err.message);
  }

  return { success: true, id };
}

const DEFAULT_CIERRE_CONFIG = {
  // Ciclo 1 (Primera Entrega semanal)
  diaInicio1: 'Lunes',
  horaInicio1: '08:00',
  diaFin1: 'Miércoles',
  horaFin1: '23:59',

  // Ciclo 2 (Segunda Entrega semanal)
  diaInicio2: 'Jueves',
  horaInicio2: '08:00',
  diaFin2: 'Sábado',
  horaFin2: '23:59',

  titulo: 'Cierre de Pedidos',
  activo: true
};

/**
 * Retrieves the Order Closing schedule configuration from Firestore or Mock DB.
 */
async function getCierreConfig() {
  if (!isMock && db) {
    try {
      const docRef = db.collection('config').doc('cierre');
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        return { ...DEFAULT_CIERRE_CONFIG, ...docSnap.data() };
      }
    } catch (err) {
      console.warn('⚠️ Error reading cierre config from Firestore:', err.message);
    }
  }

  // Fallback to Mock Data
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (fs.existsSync(mockFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
      if (data.cierreConfig) return { ...DEFAULT_CIERRE_CONFIG, ...data.cierreConfig };
    } catch (e) {}
  }

  return DEFAULT_CIERRE_CONFIG;
}

/**
 * Updates the Order Closing schedule configuration in Firestore or Mock DB.
 */
async function updateCierreConfig(configData) {
  const updated = {
    diaInicio1: configData.diaInicio1 || 'Lunes',
    horaInicio1: configData.horaInicio1 || '08:00',
    diaFin1: configData.diaFin1 || 'Miércoles',
    horaFin1: configData.horaFin1 || '23:59',

    diaInicio2: configData.diaInicio2 || 'Jueves',
    horaInicio2: configData.horaInicio2 || '08:00',
    diaFin2: configData.diaFin2 || 'Sábado',
    horaFin2: configData.horaFin2 || '23:59',

    titulo: configData.titulo || 'Cierre de Pedidos',
    activo: configData.activo !== false
  };

  if (!isMock && db) {
    try {
      const docRef = db.collection('config').doc('cierre');
      await docRef.set({
        ...updated,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return updated;
    } catch (err) {
      console.error('Error updating cierre config in Firestore:', err.message);
    }
  }

  // Mock Fallback
  const mockFilePath = path.join(__dirname, 'mockData.json');
  mockData.cierreConfig = updated;

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(mockData, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not update mockData.json on cierre config:', err.message);
  }

  return updated;
}

const DEFAULT_DESCUENTOS_CONFIG = [
  {
    id: 'rango_1',
    nombre: '',
    rangoInicio: '',
    rangoFin: '',
    activo: true,
    escalones: []
  }
];

/**
 * Retrieves the Price-Range Volume Discount Rules from Firestore or Mock DB.
 */
async function getDescuentosConfig() {
  if (!isMock && db) {
    try {
      const docRef = db.collection('config').doc('descuentos');
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        const data = docSnap.data();
        if (data && Array.isArray(data.rangos)) {
          return data.rangos;
        }
      }
    } catch (err) {
      console.warn('⚠️ Error reading descuentos config from Firestore:', err.message);
    }
  }

  // Fallback to Mock Data
  const mockFilePath = path.join(__dirname, 'mockData.json');
  if (fs.existsSync(mockFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(mockFilePath, 'utf8'));
      if (Array.isArray(data.descuentosConfig)) return data.descuentosConfig;
    } catch (e) {}
  }

  return DEFAULT_DESCUENTOS_CONFIG;
}

/**
 * Updates the Price-Range Volume Discount Rules in Firestore or Mock DB.
 */
async function updateDescuentosConfig(rangosData) {
  const rangos = Array.isArray(rangosData) ? rangosData : DEFAULT_DESCUENTOS_CONFIG;

  if (!isMock && db) {
    try {
      const docRef = db.collection('config').doc('descuentos');
      await docRef.set({
        rangos,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return rangos;
    } catch (err) {
      console.error('Error updating descuentos config in Firestore:', err.message);
    }
  }

  // Mock Fallback
  const mockFilePath = path.join(__dirname, 'mockData.json');
  mockData.descuentosConfig = rangos;

  try {
    if (fs.existsSync(mockFilePath)) {
      fs.writeFileSync(mockFilePath, JSON.stringify(mockData, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Could not update mockData.json on descuentos config:', err.message);
  }

  return rangos;
}

module.exports = {
  db,
  isMock,
  getFirebaseConfig,
  executeFirebaseQuery,
  getContactoInfo,
  getNextContactoNumber,
  createShopReelProduct,
  updateShopReelProduct,
  deleteShopReelProduct,
  getCierreConfig,
  updateCierreConfig,
  getDescuentosConfig,
  updateDescuentosConfig
};



