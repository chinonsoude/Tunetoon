const admin = require('firebase-admin');

// IMPORTANT: this uses your Firebase project automatically if you’re logged in
admin.initializeApp({
  projectId: 'tunetoon-d77f5'
});

const db = admin.firestore();

async function migrate() {
  const snapshot = await db.collection('recordings').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Skip already migrated
    if (data.audioPath && data.imagePath) continue;

    if (!data.audioUrl || !data.imageUrl) continue;

    const extractPath = (url) => {
      const match = url.match(/\/o\/(.*?)\?/);
      if (!match) return null;
      return decodeURIComponent(match[1]);
    };

    const audioPath = extractPath(data.audioUrl);
    const imagePath = extractPath(data.imageUrl);

    if (!audioPath || !imagePath) {
      console.log(`⚠️ Skipped ${doc.id}`);
      continue;
    }

    await doc.ref.update({
      audioPath,
      imagePath
    });

    console.log(`✅ Migrated ${doc.id}`);
  }

  console.log("🎉 Done");
}

migrate().catch(console.error);