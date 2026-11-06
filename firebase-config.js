// ============================================================
// FIREBASE PROJECT — paste your own web app config here.
//
// Firebase console → Project settings → Your apps → Web app → SDK setup
// and configuration → "Config". Copy the values between the quotes.
//
// You also need Realtime Database (created in Test mode is fine to start,
// then deploy database.rules.json) and its databaseURL.
//
// Enable Email/Password Authentication in the Firebase console
// (Authentication → Sign-in method → Email/Password). Every visitor signs in
// before the menu: the account keeps the Token wallet and every My Player
// career, and gives online play a stable uid.
//
// Online rooms read the signed-in account's uid; if no account exists the
// online code falls back to anonymous auth, so enabling Anonymous as well is
// only needed for that fallback. Each career lives at
// users/{uid}/myPlayers and the wallet at users/{uid}/profile, so
// database.rules.json must be deployed too.
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
