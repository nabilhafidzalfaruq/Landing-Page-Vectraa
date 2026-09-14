// ---------------------------------------------------------------------------
// Firebase project config — paste this from:
// Firebase Console → Project settings → General → "Your apps" → SDK setup snippet (Config)
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCUyWtkt7JtcUQtupCh-K-etuO4RhqTZXk",
  authDomain: "landing-page-vectra.firebaseapp.com",
  projectId: "landing-page-vectra",
  storageBucket: "landing-page-vectra.firebasestorage.app",
  messagingSenderId: "254835415198",
  appId: "1:254835415198:web:5383ce4dd757f688d6438f",
  measurementId: "G-RHQJTKNJMZ",
};

firebase.initializeApp(firebaseConfig);
const firebaseAuth = firebase.auth();

// ---------------------------------------------------------------------------
// Google Apps Script Web App URL — the /exec URL you get after
// Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone)
// Paste the matching adapter code from code-gs-adapter.gs into your Code.gs first.
// ---------------------------------------------------------------------------
const GAS_API_URL =
  "https://script.google.com/macros/s/AKfycbz6FI-obBlruiSCGj1D19HZsfzA-McG_ycPtTFFzssvtv8HIsvo4CJLzdS43DDN417A/exec";
