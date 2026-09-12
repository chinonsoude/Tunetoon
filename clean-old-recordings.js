const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'tunetoon-d77f5' });

const db = admin.firestore();

async function cleanup() {
  const snapshot = await db.collection('recordings').get();

  for (const doc of snapshot.docs) {
    await doc.ref.update({
      audioUrl: admin.firestore.FieldValue.delete(),
      imageUrl: admin.firestore.FieldValue.delete()
    });

    console.log(`🧹 Cleaned ${doc.id}`);
  }

  console.log("🔥 Cleanup done");
}

cleanup().catch(console.error);