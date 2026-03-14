import './style.css';
const STORAGE_KEY = "pronunciation-log-v1";

const textInput = document.getElementById("textInput");
const playBtn = document.getElementById("playBtn");
const saveBtn = document.getElementById("saveBtn");
const clearInputBtn = document.getElementById("clearInputBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const searchInput = document.getElementById("searchInput");
const showFavoritesBtn = document.getElementById("showFavoritesBtn");
const historyList = document.getElementById("historyList");
const statusEl = document.getElementById("status");

let history = loadHistory();
let voices = [];
let favoritesOnly = false;

function setStatus(message) {
  statusEl.textContent = message;
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to load history:", error);
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function getFrenchVoice() {
  if (!voices.length) return null;

  const exactFrench = voices.find((voice) =>
    voice.lang.toLowerCase().startsWith("fr")
  );

  return exactFrench || null;
}

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis is not supported in this browser.");
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("Please type something first.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(trimmed);
  const frenchVoice = getFrenchVoice();

  if (frenchVoice) {
    utterance.voice = frenchVoice;
    utterance.lang = frenchVoice.lang;
  } else {
    utterance.lang = "fr-FR";
  }

  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onstart = () => {
    setStatus(
      `Playing pronunciation${frenchVoice ? ` with ${frenchVoice.name}` : ""}...`
    );
  };

  utterance.onend = () => {
    setStatus("Done.");
  };

  utterance.onerror = () => {
    setStatus("Could not play pronunciation.");
  };

  window.speechSynthesis.speak(utterance);
}

function addHistoryItem(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("Nothing to save.");
    return;
  }

  const item = {
    id: crypto.randomUUID(),
    text: trimmed,
    createdAt: Date.now(),
    favorite: false,
  };

  history.unshift(item);
  saveHistory();
  renderHistory();
  setStatus("Saved to history.");
}

function toggleFavorite(id) {
  history = history.map((item) =>
    item.id === id ? { ...item, favorite: !item.favorite } : item
  );
  saveHistory();
  renderHistory();
}

function deleteHistoryItem(id) {
  history = history.filter((item) => item.id !== id);
  saveHistory();
  renderHistory();
}

function getFilteredHistory() {
  const query = searchInput.value.trim().toLowerCase();

  return history.filter((item) => {
    const matchesSearch = item.text.toLowerCase().includes(query);
    const matchesFavorite = favoritesOnly ? item.favorite : true;
    return matchesSearch && matchesFavorite;
  });
}

function renderHistory() {
  const filtered = getFilteredHistory();

  if (!filtered.length) {
    historyList.innerHTML = `<li class="empty">No saved items yet.</li>`;
    return;
  }

  historyList.innerHTML = filtered
    .map(
      (item) => `
        <li class="history-item">
          <p class="history-text">${escapeHtml(item.text)}</p>
          <div class="history-meta">
            Saved: ${formatDate(item.createdAt)} ${item.favorite ? "★ Favorite" : ""}
          </div>
          <div class="history-buttons">
            <button data-action="play" data-id="${item.id}">Play</button>
            <button data-action="favorite" data-id="${item.id}" class="secondary">
              ${item.favorite ? "Unfavorite" : "Favorite"}
            </button>
            <button data-action="reuse" data-id="${item.id}" class="secondary">Reuse</button>
            <button data-action="delete" data-id="${item.id}" class="danger">Delete</button>
          </div>
        </li>
      `
    )
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

playBtn.addEventListener("click", () => {
  speakText(textInput.value);
});

saveBtn.addEventListener("click", () => {
  addHistoryItem(textInput.value);
});

clearInputBtn.addEventListener("click", () => {
  textInput.value = "";
  setStatus("Input cleared.");
});

clearHistoryBtn.addEventListener("click", () => {
  const confirmed = window.confirm("Delete all saved history?");
  if (!confirmed) return;

  history = [];
  saveHistory();
  renderHistory();
  setStatus("History cleared.");
});

searchInput.addEventListener("input", () => {
  renderHistory();
});

showFavoritesBtn.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  showFavoritesBtn.textContent = favoritesOnly
    ? "Show all"
    : "Show favorites only";
  renderHistory();
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const { action, id } = button.dataset;
  const item = history.find((entry) => entry.id === id);
  if (!item) return;

  if (action === "play") {
    speakText(item.text);
  }

  if (action === "favorite") {
    toggleFavorite(id);
  }

  if (action === "reuse") {
    textInput.value = item.text;
    setStatus("Loaded item back into input.");
  }

  if (action === "delete") {
    deleteHistoryItem(id);
    setStatus("Deleted item.");
  }
});

loadVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

renderHistory();
setStatus("Ready.");