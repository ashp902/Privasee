const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');
const dotenv = require('dotenv');
const path = require('path');
const SensitiveImage = require('./models/SensitiveImage.js');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Google OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Google Vision API Client
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// ----------- Routes -----------

// Proxy image request
app.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing URL');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.send(response.data);
  } catch (error) {
    console.error('Failed to proxy image:', error.message);
    res.status(500).send('Failed to load image');
  }
});

// Google OAuth redirect
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid'
    ]
  });
  res.redirect(url);
});

// Exchange code for tokens
app.post('/auth/google/callback', async (req, res) => {
  const { code } = req.body;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      scope: tokens.scope,
    });
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    res.status(400).json({ error: 'Failed to exchange code' });
  }
});

// Verify ID token directly
app.post('/auth/google/token', async (req, res) => {
  const { idToken } = req.body;
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    res.json({ verified: true, user: payload });
  } catch (error) {
    console.error('Error verifying ID Token:', error);
    res.status(400).json({ message: 'Token verification failed' });
  }
});

// Fetch photos
app.post('/photos', async (req, res) => {
  const { accessToken } = req.body;
  try {
    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    res.json(response.data.mediaItems);
  } catch (error) {
    console.error('Failed to fetch photos:', error.message);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// OCR
app.post('/ocr', async (req, res) => {
  const { imageUrl } = req.body;
  try {
    const [result] = await visionClient.textDetection(imageUrl);
    const detections = result.textAnnotations;
    if (detections.length > 0) {
      const fullText = detections[0].description;
      const sensitiveWords = detections.slice(1).map(d => ({
        text: d.description,
        boundingPoly: d.boundingPoly,
      }));
      res.json({ fullText, sensitiveWords });
    } else {
      res.json({ fullText: '', sensitiveWords: [] });
    }
  } catch (error) {
    console.error('Error during OCR:', error);
    res.status(500).json({ message: 'OCR failed' });
  }
});

// PII Detection using Gemini
app.post('/checkSensitiveText', async (req, res) => {
  const { text } = req.body;
  try {
    const geminiResponse = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [
          {
            parts: [
              {
                text: `You are given OCR extracted text from an image.

Your job is to decide whether the text contains personally identifiable information (PII).

If it does:
- Reply in this JSON format: 
  {"type": "SSN", "value": "123-45-6789"}

If it does NOT:
- Reply exactly: {"type": "Not Sensitive", "value": ""}

Allowed types are: SSN, Phone Number, Email Address, Name, Address, Credit Card, Other PII.

Here is the text:
"${text}"

Only reply with the JSON, nothing else.`
              },
            ],
          },
        ],
      },
      { params: { key: process.env.GEMINI_API_KEY } }
    );
    let geminiText = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    geminiText = geminiText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(geminiText);
    res.json({ type: parsed.type, value: parsed.value });
  } catch (error) {
    console.error('Gemini API failed:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to classify text' });
  }
});

// Save sensitive status
app.post('/mark-sensitive', async (req, res) => {
  const { imageId, status } = req.body;
  if (!imageId || !status) {
    return res.status(400).json({ error: 'Missing imageId or status' });
  }
  try {
    await SensitiveImage.create({ imageId, status });
    res.status(200).json({ message: 'Image marked' });
  } catch (error) {
    console.error('Error marking image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all previously marked images
app.get('/get-marked-images', async (req, res) => {
  try {
    const marked = await SensitiveImage.find({}, 'imageId');
    const markedIds = marked.map(doc => doc.imageId);
    res.json({ marked: markedIds });
  } catch (error) {
    console.error('Error fetching marked images:', error);
    res.status(500).json({ error: 'Failed to fetch marked images' });
  }
});

// Serve React frontend
const fs = require('fs');

const buildPath = path.join(__dirname, 'build', 'index.html');

if (fs.existsSync(buildPath)) {
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('/{*any}', (req, res) => {
    res.sendFile(buildPath);
  });
} else {
  console.warn('⚠️ Build folder not found. React frontend will not be served.');
}


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
