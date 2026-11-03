// ============================================================
// FIREBASE PROJECT — paste your own web app config here.
//
// Firebase console → Project settings → Your apps → Web app → SDK setup
// and configuration → "Config". Copy the values between the quotes.
//
// You also need Realtime Database (created in Test mode is fine to start,
// then deploy database.rules.json) and its databaseURL.
//
// Enable Anonymous Authentication in the Firebase console
// (Authentication → Sign-in method → Anonymous). Online play signs every
// device in anonymously so the security rules can pin host writes and each
// manager's own club to a real uid.
//
// Leaving this empty is safe: local play never touches the network, and the
// Online screen shows a "No Firebase project configured" message instead.
// A config saved in localStorage under 'dbf.firebase' (DevTools console)
// takes priority over this file, so you can test without editing anything.
// ============================================================

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBuKMShkWH2JoZjX_Ywma4rvgxitYmB2OI",
  authDomain: "draft-bid-football-d30a9.firebaseapp.com",
  projectId: "draft-bid-football-d30a9",
  // Only shown in the console once a Realtime Database exists.
  databaseURL: "https://draft-bid-football-d30a9-default-rtdb.firebaseio.com",
  storageBucket: "draft-bid-football-d30a9.firebasestorage.app",
  messagingSenderId: "291651528240",
  appId: "1:291651528240:web:01b7daa83c103d1683aff5",
  measurementId: "G-K74SGXFLLM"
};
