const express = require('express');
const cors = require('cors');
const https = require('https');
const compression = require('compression');
require('dotenv').config();
const { 
  executeFirebaseQuery, 
  isMock, 
  getContactoInfo, 
  getNextContactoNumber,
  createShopReelProduct,
  updateShopReelProduct,
  deleteShopReelProduct,
  getCierreConfig,
  updateCierreConfig,
  getDescuentosConfig,
  updateDescuentosConfig,
  updateNoticeConfig,
  updateInicioConfig,
  createMusicTrack,
  updateMusicTrack,
  deleteMusicTrack
} = require('./firebase');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(compression());
app.use(cors());
app.use(express.json());

// Logger middleware
app.use((req, reqResponse, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '🚀 ByAngels Backend API is running successfully!',
    endpoints: [
      '/api/health',
      '/api/shopreel',
      '/api/Musics',
      '/api/notice',
      '/api/inicio',
      '/api/contacto',
      '/api/contacto/next',
      '/api/pinterest-video'
    ]
  });
});

// Extract raw MP4 or HLS video URL from Pinterest Pin link
app.get('/api/pinterest-video', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL parameter required' });

    console.log(`[Pinterest Parser] Fetching raw video for: ${targetUrl}`);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    const html = await response.text();
    
    // 1. Direct .mp4 video link (720p, 1080p, exp, mc, etc.)
    const mp4Match = html.match(/(https?:\\\/\\\/v\d*\.pinimg\.com\\\/videos\\\/[^\s"'\\>]+\.mp4|https?:\/\/v\d*\.pinimg\.com\/videos\/[^\s"'\\>]+\.mp4)/i);
    
    if (mp4Match && mp4Match[0]) {
      const cleanUrl = mp4Match[0].replace(/\\/g, '');
      console.log(`[Pinterest Parser] Successfully extracted MP4: ${cleanUrl}`);
      return res.json({ videoUrl: cleanUrl });
    }
    
    // 2. .m3u8 HLS stream URL
    const m3u8Match = html.match(/(https?:\\\/\\\/v\d*\.pinimg\.com\\\/videos\\\/[^\s"'\\>]+\.m3u8|https?:\/\/v\d*\.pinimg\.com\/videos\/[^\s"'\\>]+\.m3u8)/i);
    if (m3u8Match && m3u8Match[0]) {
      const cleanUrl = m3u8Match[0].replace(/\\/g, '');
      console.log(`[Pinterest Parser] Successfully extracted HLS .m3u8: ${cleanUrl}`);
      return res.json({ videoUrl: cleanUrl });
    }

    // 3. Fallback search inside JSON data script tags
    const urlInJson = html.match(/https?:\/\/v\d*\.pinimg\.com\/videos\/[^\s"'\\>]+\.(mp4|m3u8)/i);
    if (urlInJson && urlInJson[0]) {
      const cleanUrl = urlInJson[0].replace(/\\/g, '');
      console.log(`[Pinterest Parser] Successfully extracted video from JSON metadata: ${cleanUrl}`);
      return res.json({ videoUrl: cleanUrl });
    }
    
    return res.status(404).json({ error: 'No direct MP4 or video stream found on Pinterest pin page' });
  } catch (err) {
    console.error(`[Pinterest Parser] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    databaseMode: isMock ? 'mock-local-json' : 'firebase-firestore',
    port: PORT
  });
});

// GET /api/shopreel - Retrieves clothes catalog with search and style filtering
app.get('/api/shopreel', async (req, res) => {
  try {
    const products = await executeFirebaseQuery('ShopReel');
    const { search, style } = req.query;

    let filteredProducts = [...products];

    // Filter by style (category or boolean flags)
    if (style && style.trim() !== '') {
      const targetStyle = style.trim().toLowerCase();
      if (targetStyle !== 'precio_asc' && targetStyle !== 'precio-asc' && targetStyle !== 'precio_desc' && targetStyle !== 'precio-desc') {
        if (targetStyle === 'nuevo' || targetStyle === 'new') {
          filteredProducts = filteredProducts.filter(p =>
            p.Nuevo === true ||
            p.Nuevo === 'true' ||
            (typeof p.Nuevo === 'string' && (p.Nuevo.toLowerCase() === 'si' || p.Nuevo.toLowerCase() === 'yes' || p.Nuevo.toLowerCase() === 'true'))
          );
        } else if (targetStyle === 'tendencia' || targetStyle === 'trending') {
          filteredProducts = filteredProducts.filter(p =>
            p.Tendencia === true ||
            p.Tendencia === 'true' ||
            (typeof p.Tendencia === 'string' && (p.Tendencia.toLowerCase() === 'si' || p.Tendencia.toLowerCase() === 'yes' || p.Tendencia.toLowerCase() === 'true'))
          );
        } else {
          // Matches Categoria exactly (case-insensitive)
          filteredProducts = filteredProducts.filter(p =>
            p.Categoria && p.Categoria.toLowerCase() === targetStyle
          );
        }
      }
    }

    // Filter by text search
    if (search && search.trim() !== '') {
      const query = search.trim().toLowerCase();
      filteredProducts = filteredProducts.filter(p =>
        p.Nombre && p.Nombre.toLowerCase().includes(query)
      );
    }

    // Sort products based on price or priority 'numorden'
    const sortStyle = style ? style.trim().toLowerCase() : '';
    if (sortStyle === 'precio_asc' || sortStyle === 'precio-asc') {
      filteredProducts.sort((a, b) => (Number(a.Precio) || 0) - (Number(b.Precio) || 0));
    } else if (sortStyle === 'precio_desc' || sortStyle === 'precio-desc') {
      filteredProducts.sort((a, b) => (Number(b.Precio) || 0) - (Number(a.Precio) || 0));
    } else {
      filteredProducts.sort((a, b) => {
        const numA = Number(a.numorden !== undefined ? a.numorden : a.numOrden);
        const numB = Number(b.numorden !== undefined ? b.numorden : b.numOrden);
        const orderA = (a.numorden !== undefined && a.numorden !== null && a.numorden !== '' && !isNaN(numA)) ? numA : Infinity;
        const orderB = (b.numorden !== undefined && b.numorden !== null && b.numorden !== '' && !isNaN(numB)) ? numB : Infinity;
        return orderA - orderB;
      });
    }

    res.json(filteredProducts);
  } catch (error) {
    console.error('Error fetching shopreel products:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/shopreel - Create a new product (Auto-increments numorden)
app.post('/api/shopreel', async (req, res) => {
  try {
    const newProduct = await createShopReelProduct(req.body);
    res.status(201).json(newProduct);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// PUT /api/shopreel/:id - Update an existing product
app.put('/api/shopreel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedProduct = await updateShopReelProduct(id, req.body);
    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// DELETE /api/shopreel/:id - Delete a product
app.delete('/api/shopreel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteShopReelProduct(id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET /api/musics - Retrieves background music track lists
app.get('/api/Musics', async (req, res) => {
  try {
    const tracks = await executeFirebaseQuery('Musics');
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching Musics:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/Musics - Create a new music track
app.post('/api/Musics', async (req, res) => {
  try {
    const newTrack = await createMusicTrack(req.body);
    res.status(201).json(newTrack);
  } catch (error) {
    console.error('Error creating music track:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// PUT /api/Musics/:id - Update an existing music track
app.put('/api/Musics/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedTrack = await updateMusicTrack(id, req.body);
    res.json(updatedTrack);
  } catch (error) {
    console.error('Error updating music track:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// DELETE /api/Musics/:id - Delete a music track
app.delete('/api/Musics/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteMusicTrack(id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting music track:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET /api/inicio - Retrieves start view configurations
app.get('/api/inicio', async (req, res) => {
  try {
    const inicioData = await executeFirebaseQuery('Inicio');
    res.json(inicioData);
  } catch (error) {
    console.error('Error fetching Inicio:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/inicio - Updates start view configuration (Welcome screen video URL)
app.post('/api/inicio', async (req, res) => {
  try {
    const body = req.body || {};
    const videoUrl = body.UrlInicio || body.url || body.urlInicio || (typeof body === 'string' ? body : '');
    const updated = await updateInicioConfig(videoUrl);
    res.json(updated);
  } catch (error) {
    console.error('Error updating Inicio:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});


// GET /api/notice - Retrieves news/notices lists
app.get('/api/notice', async (req, res) => {
  try {
    const noticeData = await executeFirebaseQuery('Notice');
    res.json(noticeData);
  } catch (error) {
    console.error('Error fetching Notice:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/notice - Updates news/notices image reels
app.post('/api/notice', async (req, res) => {
  try {
    const updated = await updateNoticeConfig(req.body);
    res.json(updated);
  } catch (error) {
    console.error('Error updating Notice:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET /api/contacto - Consults current contact document/info without advancing index
app.get('/api/contacto', async (req, res) => {
  try {
    const contactoInfo = await getContactoInfo();
    res.json(contactoInfo);
  } catch (error) {
    console.error('Error fetching contacto info:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET & POST /api/contacto/next - Rotates and gets the next WhatsApp number for customer orders
const handleNextContacto = async (req, res) => {
  try {
    const nextContacto = await getNextContactoNumber();
    res.json(nextContacto);
  } catch (error) {
    console.error('Error fetching next contacto number:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};

app.get('/api/contacto/next', handleNextContacto);
app.post('/api/contacto/next', handleNextContacto);
app.post('/api/contacto', handleNextContacto);

// GET /api/cierre - Retrieves order closing countdown configuration
app.get('/api/cierre', async (req, res) => {
  try {
    const config = await getCierreConfig();
    res.json(config);
  } catch (error) {
    console.error('Error fetching cierre config:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/cierre - Updates order closing countdown configuration
app.post('/api/cierre', async (req, res) => {
  try {
    const updated = await updateCierreConfig(req.body);
    res.json(updated);
  } catch (error) {
    console.error('Error updating cierre config:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET /api/descuentos - Retrieves price-range volume discount rules
app.get('/api/descuentos', async (req, res) => {
  try {
    const rules = await getDescuentosConfig();
    res.json(rules);
  } catch (error) {
    console.error('Error fetching descuentos config:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// POST /api/descuentos - Updates price-range volume discount rules
app.post('/api/descuentos', async (req, res) => {
  try {
    const updated = await updateDescuentosConfig(req.body);
    res.json(updated);
  } catch (error) {
    console.error('Error updating descuentos config:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// GET /api/proxy-video/* - Proxies video streams and segment files to bypass CORS restrictions
app.get('/api/proxy-video/*', (req, res) => {
  let targetUrl = req.params[0];
  if (!targetUrl) return res.status(400).send('Missing video path');

  // If the path doesn't start with a protocol, prepend the Pinterest video domain
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `https://v1.pinimg.com/videos/${targetUrl}`;
  }

  // Preserve query parameters if they exist
  const queryStrIndex = req.url.indexOf('?');
  if (queryStrIndex !== -1) {
    targetUrl += req.url.substring(queryStrIndex);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  const followGet = (urlToFetch) => {
    https.get(urlToFetch, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        followGet(proxyRes.headers.location);
      } else {
        res.statusCode = proxyRes.statusCode;
        if (proxyRes.headers['content-type']) {
          res.setHeader('content-type', proxyRes.headers['content-type']);
        }
        if (proxyRes.headers['content-length']) {
          res.setHeader('content-length', proxyRes.headers['content-length']);
        }
        proxyRes.pipe(res);
      }
    }).on('error', (err) => {
      console.error('Video proxy error:', err);
      res.status(500).send(err.message);
    });
  };

  followGet(targetUrl);
});




// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 ByAngels Backend API running on http://localhost:${PORT}`);
    console.log(`Database mode: ${isMock ? 'LOCAL MOCK' : 'FIREBASE CLOUD'}`);
  });
}

module.exports = app;
