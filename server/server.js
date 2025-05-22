const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { Logging } = require('@google-cloud/logging');

dotenv.config();

console.log()

// Initialize Firebase Admin SDK
console.log('Service Account ENV:', process.env.FIRESTORE_SERVICE_ACCOUNT_KEY);
const serviceAccount = require(process.env.FIRESTORE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const imagesRef = db.collection('SensitiveImages');

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

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

// Google Analytics tracking function
const trackGAEvent = async (eventName, params = {}) => {
  const measurementId = process.env.GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;

  try {
    await axios.post(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        client_id: 'backend-service',
        events: [
          {
            name: eventName,
            params: {
              engagement_time_msec: '100',
              ...params,
            },
          },
        ],
      }
    );
  } catch (error) {
    console.error('Failed to send GA event:', error.message);
  }
};

// Google Cloud Logging
const logging = new Logging();
const log = logging.log('privasee-backend-events');

const logRequest = async (label, requestData) => {
  const metadata = {
    resource: { type: 'global' },
    labels: { source: label },
  };
  const entry = log.entry(metadata, requestData);
  try {
    await log.write(entry);
  } catch (err) {
    console.error('Cloud Logging write failed:', err.message);
  }
};

// ========== Routes ==========

app.post('/log/frontend', async (req, res) => {
  const { source, event, data } = req.body;
  if (!event || !source) return res.status(400).json({ error: 'Missing fields' });

  try {
    await logRequest(source, {
      event,
      ...data,
      timestamp: new Date().toISOString(),
    });
    res.status(200).json({ message: 'Logged to Cloud' });
  } catch (error) {
    console.error('Failed to log frontend event:', error.message);
    res.status(500).json({ error: 'Logging failed' });
  }
});

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

// Google OAuth Redirect
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ],
  });
  res.redirect(url);
});

app.post('/auth/google/callback', async (req, res) => {
  const { code } = req.body;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.json(tokens);
  } catch (error) {
    console.error('Token exchange failed:', error);
    res.status(400).json({ error: 'Exchange failed' });
  }
});

app.post('/auth/google/token', async (req, res) => {
  const { idToken } = req.body;
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    res.json({ verified: true, user: ticket.getPayload() });
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(400).json({ message: 'Token verification failed' });
  }
});

app.post('/photos', async (req, res) => {
  const { accessToken } = req.body;
  try {
    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.json(response.data.mediaItems);
  } catch (error) {
    console.error('Failed to fetch photos:', error.message);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

app.post('/ocr', async (req, res) => {
  const { imageUrl } = req.body;
  try {
    const [result] = await visionClient.textDetection(imageUrl);
    const detections = result.textAnnotations || [];
    const fullText = detections[0]?.description || '';
    const sensitiveWords = detections.slice(1).map(d => ({
      text: d.description,
      boundingPoly: d.boundingPoly,
    }));

    await logRequest('ocr', {
      event: 'OCR Completed',
      imageUrl,
      charCount: fullText.length,
      sensitiveWordCount: sensitiveWords.length,
      timestamp: new Date().toISOString(),
    });

    await trackGAEvent('ocr_completed', { image_url: imageUrl });

    res.json({ fullText, sensitiveWords });
  } catch (error) {
    console.error('OCR failed:', error);
    res.status(500).json({ message: 'OCR failed' });
  }
});

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
                text: `You are given OCR extracted text from an image.\n\nYour job is to decide whether the text contains personally identifiable information (PII).\n\nIf it does:\n- Reply in this JSON format: \n  {"type": "SSN", "value": "123-45-6789"}\n\nIf it does NOT:\n- Reply exactly: {"type": "Not Sensitive", "value": ""}\n\nAllowed types are: SSN, Phone Number, Email Address, Name, Address, Credit Card, Other PII.\n\nHere is the text:\n"${text}"\n\nOnly reply with the JSON, nothing else.`,
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

    await logRequest('gemini', {
      event: 'Gemini Classification',
      resultType: parsed.type,
      timestamp: new Date().toISOString(),
    });

    await trackGAEvent('gemini_classified', { type: parsed.type });

    res.json({ type: parsed.type, value: parsed.value });
  } catch (error) {
    console.error('Gemini failed:', error.message);
    res.status(500).json({ error: 'Failed to classify text' });
  }
});

app.post('/mark-sensitive', async (req, res) => {
  const { imageId, status } = req.body;
  if (!imageId || !status) return res.status(400).json({ error: 'Missing imageId or status' });

  try {
    await imagesRef.doc(imageId).set({ imageId, status, updatedAt: Date.now() });
    await trackGAEvent('image_marked', { status });
    res.status(200).json({ message: 'Image marked' });
  } catch (error) {
    console.error('Firestore write error:', error);
    res.status(500).json({ error: 'Failed to save image' });
  }
});

app.get('/get-marked-images', async (req, res) => {
  try {
    const snapshot = await imagesRef.get();
    const markedIds = snapshot.docs.map(doc => doc.id);
    res.json({ marked: markedIds });
  } catch (error) {
    console.error('Failed to fetch marked:', error);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Serve React frontend
const buildPath = path.join(__dirname, 'build', 'index.html');
if (fs.existsSync(buildPath)) {
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('/{*any}', (req, res) => res.sendFile(buildPath));
} else {
  console.warn('⚠️ Build folder not found. React frontend will not be served.');
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
