// ─────────────────────────────────────────────────────────────────
// STEP 1: Paste your Firebase config object here (replace the
//         placeholder values below with your real ones.
//         Get it from: Firebase Console → Project Settings → Your apps
// ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBsOSt2y-7n2bP8hpxb-S94IaiDPdjtJss",
  authDomain: "voice-up-f9d02.firebaseapp.com",
  projectId: "voice-up-f9d02",
  storageBucket: "voice-up-f9d02.firebasestorage.app",
  messagingSenderId: "354686205134",
  appId: "1:354686205134:web:4aa22f462163ceb69b649f",
  measurementId: "G-W3G11F15QR",
};
// ─────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ── init ──
const firebaseConfigured =
  firebaseConfig.apiKey !== "PASTE_YOUR_apiKey_HERE";
let app,
  auth,
  db,
  currentUser = null,
  unsubscribeSnapshot = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// ── DOM refs ──
const textInput = document.getElementById("textInput");
const playBtn = document.getElementById("playBtn");
const slowBtn = document.getElementById("slowBtn");
const saveBtn = document.getElementById("saveBtn");
const clearInputBtn = document.getElementById("clearInputBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const searchInput = document.getElementById("searchInput");
const showFavoritesBtn = document.getElementById("showFavoritesBtn");
const showVerbsBtn = document.getElementById("showVerbsBtn");
const historyList = document.getElementById("historyList");
const statusEl = document.getElementById("status");
const authUserEl = document.getElementById("authUser");
const syncBadge = document.getElementById("syncBadge");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");

// ── auth button listeners ──
signInBtn.addEventListener("click", async () => {
  if (!firebaseConfigured) {
    alert(
      "Please add your Firebase config first — see the comment in main.js",
    );
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    setStatus("Sign-in failed.");
  }
});

signOutBtn.addEventListener("click", async () => {
  if (auth) await fbSignOut(auth);
});

// ── app state ──
const STORAGE_KEY = "pronunciation-log-v1";
let history = loadLocal();
let voices = [];
let favoritesOnly = false;
let verbsOnly = false;
let ipaCache = {};
let ipaTimer;
let notesSaveTimers = {};

// ── local storage ──
function loadLocal() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : [];
  } catch (e) {
    return [];
  }
}
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

// ── firestore helpers ──
function userCol() {
  return collection(db, "users", currentUser.uid, "entries");
}

async function persistEntry(item) {
  if (currentUser && db) {
    try {
      await setDoc(doc(userCol(), item.id), item);
    } catch (e) {
      console.error(e);
    }
  } else {
    saveLocal();
  }
}

async function removeEntry(id) {
  if (currentUser && db) {
    try {
      await deleteDoc(doc(userCol(), id));
    } catch (e) {
      console.error(e);
    }
  } else {
    saveLocal();
  }
}

async function clearAllEntries() {
  if (currentUser && db) {
    try {
      const batch = writeBatch(db);
      history.forEach((item) => batch.delete(doc(userCol(), item.id)));
      await batch.commit();
    } catch (e) {
      console.error(e);
    }
  } else {
    saveLocal();
  }
}

// ── auth state ──
if (firebaseConfigured) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      authUserEl.innerHTML = `
          ${user.photoURL ? `<img src="${user.photoURL}" alt="">` : ""}
          <span>${user.displayName || user.email}</span>
        `;
      syncBadge.textContent = "☁ Synced";
      syncBadge.classList.remove("off");
      signInBtn.style.display = "none";
      signOutBtn.style.display = "";

      const local = loadLocal();
      if (local.length) {
        for (const item of local) {
          await setDoc(doc(userCol(), item.id), item);
        }
        localStorage.removeItem(STORAGE_KEY);
      }

      if (unsubscribeSnapshot) unsubscribeSnapshot();
      const q = query(userCol(), orderBy("createdAt", "desc"));
      unsubscribeSnapshot = onSnapshot(q, (snap) => {
        history = snap.docs.map((d) => d.data());
        renderHistory();
      });
    } else {
      currentUser = null;
      authUserEl.innerHTML = `<span class="auth-status">Not signed in — history saved locally only</span>`;
      syncBadge.textContent = "⚡ Local only";
      syncBadge.classList.add("off");
      signInBtn.style.display = "";
      signOutBtn.style.display = "none";
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      history = loadLocal();
      renderHistory();
    }
  });
}

// IPA logic removed (user requested no IPA). Text input no longer triggers lookup.
textInput.addEventListener("input", () => {
  clearTimeout(ipaTimer);
});

// ── speech ──
function loadVoices() {
  voices = window.speechSynthesis.getVoices();
}
function getFrenchVoice() {
  return voices.find((v) => v.lang.toLowerCase().startsWith("fr")) || null;
}

function speakText(text, rate = 0.95) {
  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis not supported.");
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("Please type something first.");
    return;
  }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(trimmed);
  const frVoice = getFrenchVoice();
  if (frVoice) {
    utt.voice = frVoice;
    utt.lang = frVoice.lang;
  } else {
    utt.lang = "fr-FR";
  }
  utt.rate = rate;
  utt.pitch = 1;
  utt.onstart = () =>
    setStatus(
      rate < 0.8
        ? "🐢 Playing slowly…"
        : `Playing${frVoice ? ` (${frVoice.name})` : ""}...`,
    );
  utt.onend = () => setStatus("Done.");
  utt.onerror = () => setStatus("Could not play pronunciation.");
  window.speechSynthesis.speak(utt);
}

// ── history ops ──
async function addHistoryItem(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("Nothing to save.");
    return;
  }
  const item = {
    id: crypto.randomUUID(),
    text: trimmed,
    ipa: "",
    createdAt: Date.now(),
    favorite: false,
    verb: false,
    notes: "",
  };
  history.unshift(item);
  await persistEntry(item);
  if (!currentUser) renderHistory();
  setStatus("Saved to history.");
}

async function toggleFavorite(id) {
  const item = history.find((i) => i.id === id);
  if (!item) return;
  item.favorite = !item.favorite;
  await persistEntry(item);
  if (!currentUser) renderHistory();
}

async function toggleVerb(id) {
  const item = history.find((i) => i.id === id);
  if (!item) return;
  item.verb = !item.verb;
  await persistEntry(item);
  if (!currentUser) renderHistory();
}

function updateNotes(id, notes) {
  const item = history.find((i) => i.id === id);
  if (!item) return;

  item.notes = notes;

  if (!currentUser) {
    saveLocal();
    setStatus("Notes saved.");
    return;
  }

  clearTimeout(notesSaveTimers[id]);

  notesSaveTimers[id] = setTimeout(async () => {
    await persistEntry(item);
    setStatus("Notes saved.");
    delete notesSaveTimers[id];
  }, 1500);
}

async function deleteHistoryItem(id) {
  history = history.filter((i) => i.id !== id);
  await removeEntry(id);
  if (!currentUser) renderHistory();
  setStatus("Deleted.");
}

// ── render ──
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function getFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  return history.filter((item) => {
    const matchSearch = item.text.toLowerCase().includes(q);
    const matchFav = favoritesOnly ? item.favorite : true;
    const matchVerb = verbsOnly ? item.verb : true;
    return matchSearch && matchFav && matchVerb;
  });
}

function renderHistory() {
  const filtered = getFiltered();
  if (!filtered.length) {
    historyList.innerHTML = `<li class="empty">No saved items yet.</li>`;
    return;
  }
  historyList.innerHTML = filtered
    .map(
      (item) => `
      <li class="history-item">
        <p class="history-text">${escapeHtml(item.text)}</p>
        ${item.ipa ? `<div class="history-ipa">${escapeHtml(item.ipa)}</div>` : ""}
        <div class="history-meta">
          Saved: ${formatDate(item.createdAt)} ${item.favorite ? "★ Favorite" : ""} ${item.verb ? "🔹 Verb" : ""}
        </div>
        <label class="notes-label" for="notes-${item.id}">Notes</label>
        <textarea
          id="notes-${item.id}"
          class="history-notes"
          data-action="notes"
          data-id="${item.id}"
          rows="3"
          placeholder="Add meaning, conjugation, pronunciation notes..."
        >${escapeHtml(item.notes || "")}</textarea>
        <div class="history-buttons">
          <button data-action="play"     data-id="${item.id}">▶ Play</button>
          <button data-action="slow"     data-id="${item.id}" class="slow"><span class="turtle">🐢</span></button>
          <button data-action="favorite" data-id="${item.id}" class="secondary">${item.favorite ? "Unfavorite" : "Favorite"}</button>
          <button data-action="verb"     data-id="${item.id}" class="secondary">${item.verb ? "Unmark Verb" : "Mark Verb"}</button>
          <button data-action="reuse"    data-id="${item.id}" class="secondary">Reuse</button>
          <button data-action="delete"   data-id="${item.id}" class="danger">Delete</button>
        </div>
      </li>
    `,
    )
    .join("");
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── event listeners ──
playBtn.addEventListener("click", () => speakText(textInput.value));
slowBtn.addEventListener("click", () => speakText(textInput.value, 0.55));
saveBtn.addEventListener("click", () => addHistoryItem(textInput.value));

clearInputBtn.addEventListener("click", () => {
  textInput.value = "";
  setStatus("Input cleared.");
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!confirm("Delete all saved history?")) return;
  history = [];
  await clearAllEntries();
  renderHistory();
  setStatus("History cleared.");
});

searchInput.addEventListener("input", renderHistory);

showFavoritesBtn.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  showFavoritesBtn.textContent = favoritesOnly
    ? "Show all"
    : "Show favorites only";
  renderHistory();
});

showVerbsBtn.addEventListener("click", () => {
  verbsOnly = !verbsOnly;
  showVerbsBtn.textContent = verbsOnly ? "Show all" : "Show verbs only";
  renderHistory();
});

historyList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { action, id } = btn.dataset;
  const item = history.find((i) => i.id === id);
  if (!item) return;
  if (action === "play") speakText(item.text);
  if (action === "slow") speakText(item.text, 0.55);
  if (action === "favorite") toggleFavorite(id);
  if (action === "verb") toggleVerb(id);
  if (action === "reuse") {
    textInput.value = item.text;
    textInput.dispatchEvent(new Event("input"));
    setStatus("Loaded into input.");
  }
  if (action === "delete") deleteHistoryItem(id);
});

historyList.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.action === "notes") updateNotes(t.dataset.id, t.value);
});

// ── init ──
loadVoices();
if ("speechSynthesis" in window)
  window.speechSynthesis.onvoiceschanged = loadVoices;
if (!firebaseConfigured) renderHistory();
setStatus("Ready.");
