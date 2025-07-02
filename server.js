const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { getFirestore } = require("firebase-admin/firestore");
require('dotenv').config();

const app = express();
const PORT = 5000;

app.use(cors({
  origin: 'https://adrain-driver.web.app',
  origin: 'https://shopping-cart-4.web.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.split('\\n').join('\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore();

app.post("/api/report", async (req, res) => {
  const { name, issue } = req.body;

  const message = {
    text: `🚨 New Driver Report\n*Name:* ${name}\n*Issue:* ${issue}\n*Time:* ${new Date().toLocaleString()}`,
  };

  try {
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      body: JSON.stringify(message),
      headers: { "Content-Type": "application/json" },
    });

    if (!slackRes.ok) {
      throw new Error("Slack webhook failed");
    }

    res.status(200).json({ message: "Report sent to Slack successfully." });
  } catch (err) {
    console.error("Slack Error:", err);
    res.status(500).json({ error: "Failed to send report to Slack" });
  }
});


app.post("/api/notify", async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }

  try {
    const snapshot = await db.collection("drivers").get();
    const tokens = snapshot.docs
      .map(doc => doc.data().fcmToken)
      .filter(Boolean);

    if (tokens.length === 0) {
      return res.status(404).json({ error: "No driver tokens found" });
    }

    const messagePayload = {
      data: { title, body }
    };

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      ...messagePayload
    });

    await db.collection("notifications").add({
      title,
      body,
      createdAt: new Date(),
      status: "sent"
    });

    console.log(`Sent to ${tokens.length} drivers, success: ${response.successCount}, failure: ${response.failureCount}`);

    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error("Notification Error:", error);
    res.status(500).json({ error: "Failed to send notifications" });
  }
});

app.delete("/api/cleanup-notifications", async (req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const snapshot = await db.collection("notifications").where("createdAt", "<", cutoff).get();

    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    res.json({ message: "Old notifications cleaned up" });
  } catch (err) {
    console.error("Cleanup error", err);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
