const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const WEBHOOK_SECRET = defineSecret("REVENUECAT_WEBHOOK_SECRET");

const PREMIUM_PRODUCTS = {
  echoguess_pro_weekly: { tier: "weekly", diamonds: 100 },
  echoguess_pro_monthly: { tier: "monthly", diamonds: 500 },
  echoguess_pro_yearly: { tier: "yearly", diamonds: 5000 },
};

const DIAMOND_PRODUCTS = {
  echoguess_diamonds_50: 50,
  echoguess_diamonds_120: 120,
  echoguess_diamonds_300: 300,
};

const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);

const REVOKE_EVENTS = new Set([
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
]);

exports.revenueCatWebhook = onRequest(
  { secrets: [WEBHOOK_SECRET], cors: false, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${WEBHOOK_SECRET.value()}`) {
      return res.status(401).send("Unauthorized");
    }

    const event = req.body?.event;
    if (!event) return res.status(200).send("OK (no event)");

    const eventId = event.id;
    const userId = event.app_user_id;
    const eventType = event.type;
    const productId = event.product_id;

    if (!userId || !eventType) return res.status(200).send("OK (missing fields)");

    try {
      if (eventId) {
        const dedupRef = db.collection("processed_events").doc(eventId);
        const existing = await dedupRef.get();
        if (existing.exists) return res.status(200).send("OK (duplicate)");
        await dedupRef.set({ processedAt: FieldValue.serverTimestamp(), type: eventType });
      }

      const userRef = db.collection("users").doc(userId);

      if (GRANT_EVENTS.has(eventType)) {
        const update = {
          isPremium: true,
          premiumProductId: productId ?? null,
          premiumUpdatedAt: FieldValue.serverTimestamp(),
        };

        const premiumInfo = PREMIUM_PRODUCTS[productId];
        if (premiumInfo && premiumInfo.diamonds > 0) {
          update.diamonds = FieldValue.increment(premiumInfo.diamonds);
        }

        const diamondCount = DIAMOND_PRODUCTS[productId];
        if (diamondCount) {
          update.diamonds = FieldValue.increment(diamondCount);
        }

        await userRef.set(update, { merge: true });
      } else if (REVOKE_EVENTS.has(eventType)) {
        await userRef.set(
          {
            isPremium: false,
            premiumUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return res.status(200).send("OK");
    } catch (err) {
      console.error("[webhook] Error processing event:", eventId, err);
      return res.status(500).send("Internal Server Error");
    }
  }
);

// ─── Energy packages (diamonds → energy) ─────────────────────────────────────
const ENERGY_PACKAGES = {
  energy_10: { energyGain: 10, diamondCost: 5 },
  energy_30: { energyGain: 30, diamondCost: 10 },
};

// ─── Gold → Diamond packages ─────────────────────────────────────────────────
const GOLD_EXCHANGE = {
  gold_60:  { goldCost: 60,  diamondGain: 5 },
  gold_200: { goldCost: 200, diamondGain: 20 },
  gold_360: { goldCost: 360, diamondGain: 40 },
};

/**
 * spendDiamonds — Callable function for diamond → energy conversion.
 * Runs an atomic transaction: check diamonds >= cost, decrement diamonds, increment energy.
 */
exports.spendDiamonds = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Login required");

  const { packageId } = request.data ?? {};
  const pkg = ENERGY_PACKAGES[packageId];
  if (!pkg) throw new HttpsError("invalid-argument", "Invalid package");

  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};

    const currentDiamonds = data.diamonds ?? 0;
    const currentEnergy = data.energy ?? 10;

    if (currentDiamonds < pkg.diamondCost) {
      throw new HttpsError("failed-precondition", "insufficient_diamonds");
    }

    const newDiamonds = currentDiamonds - pkg.diamondCost;
    const newEnergy = currentEnergy + pkg.energyGain;

    tx.set(userRef, {
      diamonds: newDiamonds,
      energy: newEnergy,
      energyDepletedAt: null,
      lastEnergyUpdate: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { energy: newEnergy, diamonds: newDiamonds };
  });
});

/**
 * exchangeGoldForDiamonds — Callable function for gold → diamond conversion.
 * Runs an atomic transaction: check gold >= cost, decrement gold, increment diamonds.
 */
exports.exchangeGoldForDiamonds = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Login required");

  const { packageId } = request.data ?? {};
  const pkg = GOLD_EXCHANGE[packageId];
  if (!pkg) throw new HttpsError("invalid-argument", "Invalid package");

  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};

    const currentGold = data.gold ?? 0;
    const currentDiamonds = data.diamonds ?? 0;

    if (currentGold < pkg.goldCost) {
      throw new HttpsError("failed-precondition", "insufficient_gold");
    }

    const newGold = currentGold - pkg.goldCost;
    const newDiamonds = currentDiamonds + pkg.diamondGain;

    tx.set(userRef, {
      gold: newGold,
      diamonds: newDiamonds,
    }, { merge: true });

    return { gold: newGold, diamonds: newDiamonds };
  });
});
