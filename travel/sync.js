// Keeps the marks the same on every device you sign in on, through Firebase
// (Authentication for the account, Firestore for the data). Each account has
// one document, users/{uid}, holding the data as JSON. Both sides are merged
// with mergeData, so changes made offline or on two devices at once are kept.
//
// Firebase is only loaded when firebase-config.js has a config, so the app
// works the same without it, just with no sync.
import { FIREBASE_CONFIG } from './firebase-config.js';
import { emptyData, mergeData, normalizeData, sameData } from './logic.js';

const MESSAGES = {
  'auth/invalid-credential': 'Hibás e-mail-cím vagy jelszó.',
  'auth/wrong-password': 'Hibás e-mail-cím vagy jelszó.',
  'auth/user-not-found': 'Ezzel az e-mail-címmel még nincs fiók. Hozz létre egyet.',
  'auth/email-already-in-use': 'Ezzel az e-mail-címmel már van fiók, lépj be vele.',
  'auth/weak-password': 'A jelszó legyen legalább 6 karakter.',
  'auth/invalid-email': 'Ez nem tűnik e-mail-címnek.',
  'auth/missing-password': 'Add meg a jelszót is.',
  'auth/too-many-requests': 'Túl sok próbálkozás. Várj egy kicsit, és próbáld újra.',
  'auth/network-request-failed': 'Nincs internetkapcsolat.',
  'auth/operation-not-allowed': 'Ez a belépési mód nincs bekapcsolva a Firebase-ben.',
  'auth/unauthorized-domain': 'Ez a webcím nincs engedélyezve a Firebase-ben.',
  'auth/popup-blocked': 'A böngésző letiltotta a felugró ablakot.',
  'permission-denied': 'A Firestore szabályai nem engedik a mentést.',
  unavailable: 'Nincs internetkapcsolat.',
};

/** A Hungarian sentence for a Firebase error. */
export function syncMessage(err) {
  return MESSAGES[err?.code] ?? 'Valami hiba történt. Próbáld újra.';
}

export const syncConfigured = Boolean(FIREBASE_CONFIG?.apiKey);

/**
 * Starts syncing. `getData` returns this device's data, `setData` replaces it
 * after a merge, and `onStatus` hears { state, email, error } where state is
 * 'off', 'loading', 'signed-out', 'syncing', 'synced' or 'error'.
 */
export function createSync({ getData, setData, onStatus }) {
  let fb = null;
  let auth = null;
  let db = null;
  let user = null;
  let remote = null; // the last copy seen online, null until it arrives
  let unsubscribe = null;
  let timer = 0;

  const report = (state, error = null) => onStatus({ state, email: user?.email ?? null, error });
  const ref = () => fb.doc(db, 'users', user.uid);

  async function start() {
    if (!syncConfigured) return report('off');
    report('loading');
    try {
      fb = await import('./vendor/firebase.js');
    } catch {
      return report('error', 'A szinkron nem töltődött be. Nincs internet?');
    }
    const app = fb.initializeApp(FIREBASE_CONFIG);
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);
    fb.onAuthStateChanged(auth, (next) => {
      unsubscribe?.();
      unsubscribe = null;
      remote = null;
      user = next;
      if (!user) return report('signed-out');
      report('syncing');
      unsubscribe = fb.onSnapshot(ref(), (snap) => {
        let theirs = emptyData();
        try {
          if (snap.exists()) theirs = normalizeData(JSON.parse(snap.data().data));
        } catch {
          // A broken copy online is replaced by this device's data below.
        }
        remote = theirs;
        const mine = getData();
        const merged = mergeData(mine, theirs);
        if (!sameData(merged, mine)) setData(merged);
        if (!sameData(merged, theirs) || !snap.exists()) push();
        else if (!snap.metadata.hasPendingWrites) report('synced');
      }, (err) => report('error', syncMessage(err)));
    });
  }

  /** Saves this device's data online shortly (changes in a burst go together). */
  function push() {
    if (!user || !remote) return; // nothing online read yet: wait, never overwrite blindly
    report('syncing');
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const merged = mergeData(getData(), remote);
      try {
        await fb.setDoc(ref(), { data: JSON.stringify(merged), updatedAt: fb.serverTimestamp() });
        report('synced');
      } catch (err) {
        report('error', syncMessage(err));
      }
    }, 700);
  }

  return {
    start,
    changed: push,
    signIn: (email, password) => fb.signInWithEmailAndPassword(auth, email, password),
    signUp: (email, password) => fb.createUserWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => fb.sendPasswordResetEmail(auth, email),
    signInWithGoogle: () => fb.signInWithPopup(auth, new fb.GoogleAuthProvider()),
    signOut: () => fb.signOut(auth),
  };
}
