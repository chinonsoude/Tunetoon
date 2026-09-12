/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require('firebase-admin');
const QRCode = require('qrcode'); // popular Node library
const archiver = require("archiver");
const axios = require("axios");

// 🔒 Simple in-memory rate limiter
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;

// 🔒 Per-token scan cap
const MAX_SCANS_PER_TOKEN = 1000;

const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip);

  // Remove old timestamps
  const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  recent.push(now);
  rateLimitMap.set(ip, recent);

  return recent.length > MAX_REQUESTS_PER_WINDOW;
}


// 🌐 Reusable CORS helper
function applyCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }

  return false;
}

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();

exports.downloadTunetoon = onRequest(async (req, res) => {
  try {
    // 🌐 Apply CORS
    if (applyCors(req, res)) return;

    // 🔐 Verify Firebase Auth token
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).send("Unauthorized");
    }

    const token = authHeader.split("Bearer ")[1];

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (e) {
      return res.status(401).send("Invalid token");
    }

    // 🔒 Restrict to your client only
    const allowedUid = "VauKveVSg5dHBOnsojTW8Jq7Exg1";

    if (decoded.uid !== allowedUid) {
      return res.status(403).send("Forbidden");
    }

    const recordingId = req.query.recordingId;

    if (!recordingId) {
      return res.status(400).send("Missing recordingId");
    }

    // 1. Get Firestore doc
    const doc = await admin.firestore()
      .collection("recordings")
      .doc(recordingId)
      .get();

    if (!doc.exists) {
      return res.status(404).send("Recording not found");
    }

    const data = doc.data();

    if (!data.audioPath || !data.imagePath) {
      return res.status(400).send("Missing files");
    }

    const bucket = admin.storage().bucket();

    const [imageBuffer] = await bucket
      .file(data.imagePath)
      .download();

    const [audioBuffer] = await bucket
      .file(data.audioPath)
      .download();

    // 3. Setup zip stream
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tunetoon-${recordingId}.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(res);

    // 4. Append files
    archive.append(imageBuffer, {
      name: `tunetoon-${recordingId}.png`
    });

    archive.append(audioBuffer, {
      name: `tunetoon-${recordingId}.mp3`
    });

    await archive.finalize();

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

exports.generateTuneToonQR = onDocumentUpdated("recordings/{recordingId}", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};

  // Only run when purchased flips to true
  if (before.purchased || !after.purchased) {
    return null;
  }

  const recordingId = event.params.recordingId;
  // e.g. the data to encode:
  const qrPayload = `https://tunetoon-d77f5.web.app/play?token=${after.qrToken}`;

  // generate a DataURL
  const dataUrl = await QRCode.toDataURL(qrPayload);

  // Convert base64 -> buffer for uploading to Storage
  const base64 = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');

  // Upload to Storage
  const bucket = admin.storage().bucket();
  const filePath = `qr/${recordingId}.png`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    contentType: 'image/png',
    public: false,
  });

  // Make the file public
  await file.makePublic();
  const url = file.publicUrl();

  // store the QR url back in Firestore
  await admin.firestore().doc(`recordings/${event.params.recordingId}`).set({
    qrUrl: url,
  }, { merge: true });

  return null;
});

exports.generateTemporaryQR = onDocumentUpdated("recordings/{recordingId}", async (event) => {
  const dataAfter = event.data.after.data() || {};
  const dataBefore = event.data.before.data() || {};

  // If `temporaryPlaysLeft` is updated to 2, generate a temp QR:
  if ((dataBefore.temporaryPlaysLeft !== 2) && (dataAfter.temporaryPlaysLeft === 2)) {
    const recordingId = event.params.recordingId;
    const qrPayload = `https://tunetoon-d77f5.web.app/play?token=${dataAfter.qrToken}&temp=1`;

    const dataUrl = await QRCode.toDataURL(qrPayload);
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');

    const bucket = admin.storage().bucket();
    const filePath = `qr/${recordingId}_temp.png`;
    const file = bucket.file(filePath);

    await file.save(buffer, { contentType: 'image/png', public: false });
    await file.makePublic();
    const url = file.publicUrl();

    // Update the document in Firestore using the Admin SDK
    await admin.firestore().doc(`recordings/${recordingId}`).set({
      tempQrUrl: url
    }, { merge: true });
  }
  return null;
});

exports.getRecordingByToken = onRequest(async (req, res) => {
  try {
    // 🌐 CORS
    if (applyCors(req, res)) return;

    // Only allow GET
    if (req.method !== "GET") {
      return res.status(405).send("Method not allowed");
    }

    const token = (req.query.token || "").trim();

    console.log("TOKEN RAW:", req.query.token);
    console.log("TOKEN AFTER TRIM:", token);
    console.log("TOKEN LENGTH:", token.length);

    // 📊 Basic scan logging
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // 🚫 Rate limiting
    if (isRateLimited(ip)) {
      console.warn('Rate limited IP:', ip);
      return res.status(429).send('Too many requests');
    }

    const userAgent = req.headers['user-agent'] || 'unknown';
    const timestamp = new Date().toISOString();

    console.log('[QR SCAN]', {
      token,
      ip,
      userAgent,
      timestamp
    });

    if (!token) {
      return res.status(400).send("Missing token");
    }

    const db = admin.firestore();

    const snapshot = await db
      .collection("recordings")
      .where("qrToken", "==", token)
      .limit(1)
      .get();

    const docRef = snapshot.docs[0].ref;

    let data;
    let newCount;

    try {
      await db.runTransaction(async (tx) => {
        const docSnap = await tx.get(docRef);

        if (!docSnap.exists) {
          throw new Error('NOT_FOUND');
        }

        const currentCount = docSnap.data().scanCount || 0;

        if (currentCount >= MAX_SCANS_PER_TOKEN) {
          throw new Error('LIMIT_REACHED');
        }

        newCount = currentCount + 1;

        tx.update(docRef, {
          scanCount: newCount
        });

        data = docSnap.data();
      });
    } catch (err) {
      if (err.message === 'LIMIT_REACHED') {
        console.warn('Scan cap reached for token:', token);
        return res.status(403).send('Playback limit reached');
      }
      if (err.message === 'NOT_FOUND') {
        return res.status(404).send('Not found');
      }
      throw err;
    }

    // 📊 Persist scan event (non-blocking)
    db.collection('qr_scans').add({
      token,
      recordingId: snapshot.docs[0].id,
      ip,
      userAgent,
      scannedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(console.error);

    // 🔐 Generate short-lived signed URLs instead of returning public URLs
    const bucket = admin.storage().bucket();

    const audioPath = data.audioPath;
    const imagePath = data.imagePath;

    let audioUrl = null;
    let imageUrl = null;

    if (audioPath) {
      const [signedAudioUrl] = await bucket.file(audioPath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000
      });
      audioUrl = signedAudioUrl;
    }

    if (imagePath) {
      const [signedImageUrl] = await bucket.file(imagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000
      });
      imageUrl = signedImageUrl;
    }

    res.json({
      audioUrl,
      imageUrl,
      scanCount: newCount
    });

  } catch (err) {
    console.error("getRecordingByToken error:", err);
    res.status(500).send("Server error");
  }
});