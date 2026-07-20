const express = require('express');
const cors = require('cors');
const https = require('https');
const compression = require('compression');
require('dotenv').config();
const { executeFirebaseQuery, isMock } = require('./firebase');

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

    // Filter by text search
    if (search && search.trim() !== '') {
      const query = search.trim().toLowerCase();
      filteredProducts = filteredProducts.filter(p =>
        p.Nombre && p.Nombre.toLowerCase().includes(query)
      );
    }

    // Sort products: priority to 'numorden' (ascending), items without 'numorden' go to the end
    filteredProducts.sort((a, b) => {
      const numA = Number(a.numorden);
      const numB = Number(b.numorden);
      const orderA = (a.numorden !== undefined && a.numorden !== null && a.numorden !== '' && !isNaN(numA)) ? numA : Infinity;
      const orderB = (b.numorden !== undefined && b.numorden !== null && b.numorden !== '' && !isNaN(numB)) ? numB : Infinity;
      return orderA - orderB;
    });

    res.json(filteredProducts);
  } catch (error) {
    console.error('Error fetching shopreel products:', error);
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

app.listen(PORT, () => {
  console.log(`🚀 ByAngels Backend API running on http://localhost:${PORT}`);
  console.log(`Database mode: ${isMock ? 'LOCAL MOCK' : 'FIREBASE CLOUD'}`);
});
