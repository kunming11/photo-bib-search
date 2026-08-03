/**
 * 活動相簿前端
 * - 讀取 data.json（含 total / updatedAt / recentAdded / photos）
 * - 號碼布搜尋；顯示總張數與最近新增時間
 */

/**
 * @typedef {Object} PhotoRecord
 * @property {string=} file
 * @property {string=} driveId
 * @property {string=} name
 * @property {string=} addedAt
 * @property {string[]} bibs
 */

/**
 * @typedef {Object} AlbumData
 * @property {string=} updatedAt
 * @property {number=} total
 * @property {number=} recentAddedCount
 * @property {PhotoRecord[]=} recentAdded
 * @property {PhotoRecord[]} photos
 */

/** @type {PhotoRecord[]} */
let photoIndex = [];

/** @type {AlbumData|null} */
let albumMeta = null;

let dataReady = false;

const els = {
  form: document.getElementById("search-form"),
  input: document.getElementById("bib-input"),
  status: document.getElementById("status-text"),
  grid: document.getElementById("results-grid"),
  empty: document.getElementById("empty-state"),
  meta: document.getElementById("results-meta"),
  count: document.getElementById("results-count"),
  statTotal: document.getElementById("stat-total"),
  statRecent: document.getElementById("stat-recent"),
  statSynced: document.getElementById("stat-synced"),
  recentSection: document.getElementById("recent-section"),
  recentGrid: document.getElementById("recent-grid"),
};

function normalizeBib(value) {
  return String(value ?? "").trim();
}

function stripLeadingZeros(value) {
  const n = normalizeBib(value);
  if (!n) return "";
  const stripped = n.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

function recordMatchesBib(record, query) {
  const q = normalizeBib(query);
  if (!q) return false;
  const qLoose = stripLeadingZeros(q);
  const bibs = Array.isArray(record.bibs) ? record.bibs : [];
  return bibs.some((bib) => {
    const exact = normalizeBib(bib);
    if (exact === q) return true;
    return stripLeadingZeros(exact) === qLoose;
  });
}

function extractDriveId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function getPreviewUrl(record) {
  const driveId = extractDriveId(record.driveId || "") || extractDriveId(record.file || "");
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1600`;
  }
  return encodeAssetUrl(record.file || "");
}

function getDownloadUrl(record) {
  const driveId = extractDriveId(record.driveId || "") || extractDriveId(record.file || "");
  if (driveId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
  }
  return encodeAssetUrl(record.file || "");
}

function displayName(record) {
  if (record.name) return record.name;
  if (record.file) {
    const name = record.file.split("/").pop() || record.file;
    if (!/^https?:\/\//i.test(name)) return name;
  }
  if (record.driveId) return `Drive ${String(record.driveId).slice(0, 8)}…`;
  return "活動照片";
}

function encodeAssetUrl(filePath) {
  const path = String(filePath || "");
  if (/^https?:\/\//i.test(path)) return path;
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * 將 ISO 時間格式化為台灣可讀字串
 * @param {string=} iso
 * @returns {string}
 */
function formatTaiwanTime(iso) {
  if (!iso) return "時間未知";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * @param {string=} iso
 * @returns {string}
 */
function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

function setStatus(message, tone = "info") {
  els.status.textContent = message;
  els.status.classList.remove("text-red-600", "text-ink-700/70", "text-ink-800");
  if (tone === "error") els.status.classList.add("text-red-600");
  else if (tone === "ok") els.status.classList.add("text-ink-800");
  else els.status.classList.add("text-ink-700/70");
}

/**
 * 相容舊版「純陣列」與新版「物件包 photos」
 * @param {unknown} raw
 * @returns {AlbumData}
 */
function normalizeAlbumData(raw) {
  if (Array.isArray(raw)) {
    return {
      total: raw.length,
      recentAddedCount: 0,
      recentAdded: [],
      photos: raw,
      updatedAt: undefined,
    };
  }
  if (raw && typeof raw === "object" && Array.isArray(/** @type {any} */ (raw).photos)) {
    const doc = /** @type {AlbumData} */ (raw);
    return {
      ...doc,
      total: typeof doc.total === "number" ? doc.total : doc.photos.length,
      recentAdded: Array.isArray(doc.recentAdded) ? doc.recentAdded : [],
      recentAddedCount:
        typeof doc.recentAddedCount === "number"
          ? doc.recentAddedCount
          : Array.isArray(doc.recentAdded)
            ? doc.recentAdded.length
            : 0,
    };
  }
  throw new Error("data.json 格式錯誤");
}

function updateStats(album) {
  els.statTotal.textContent = String(album.total ?? album.photos.length);
  els.statRecent.textContent = String(album.recentAddedCount ?? album.recentAdded?.length ?? 0);
  if (album.updatedAt) {
    els.statSynced.textContent = `最後同步：${formatTaiwanTime(album.updatedAt)}（${formatRelative(album.updatedAt)}）· 硬碟變更後約 10 分鐘內自動更新`;
  } else {
    els.statSynced.textContent = "尚未有自動同步時間戳，請稍候再重新整理頁面";
  }
}

/**
 * @param {PhotoRecord} record
 * @param {number} index
 * @param {{ showAddedAt?: boolean }} [opts]
 */
function createPhotoCard(record, index, opts = {}) {
  const card = document.createElement("article");
  card.className =
    "photo-card fade-in overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200/70";
  card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

  const imgWrap = document.createElement("div");
  imgWrap.className = "relative aspect-[4/3] overflow-hidden bg-ink-100";

  const img = document.createElement("img");
  img.src = getPreviewUrl(record);
  img.alt = `活動照片 ${displayName(record)}`;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.className = "h-full w-full object-cover";
  img.onerror = () => img.replaceWith(createImageFallback());
  imgWrap.appendChild(img);

  if (opts.showAddedAt && record.addedAt) {
    const badge = document.createElement("span");
    badge.className =
      "absolute left-3 top-3 rounded-lg bg-ink-900/80 px-2.5 py-1 font-display text-[11px] font-semibold text-white backdrop-blur";
    badge.textContent = `新增 ${formatTaiwanTime(record.addedAt)}`;
    imgWrap.appendChild(badge);
  }

  const body = document.createElement("div");
  body.className = "space-y-3 p-4";

  const title = document.createElement("h2");
  title.className = "truncate font-display text-sm font-semibold text-ink-800";
  title.textContent = displayName(record);
  title.title = displayName(record);

  const bibRow = document.createElement("p");
  bibRow.className = "flex flex-wrap gap-1.5";
  const bibs = record.bibs || [];
  if (bibs.length) {
    bibs.forEach((bib) => {
      const chip = document.createElement("span");
      chip.className =
        "rounded-md bg-ink-50 px-2 py-0.5 font-display text-xs font-medium tracking-wide text-ink-700 ring-1 ring-ink-200";
      chip.textContent = `#${normalizeBib(bib)}`;
      bibRow.appendChild(chip);
    });
  } else {
    const chip = document.createElement("span");
    chip.className =
      "rounded-md bg-amber-50 px-2 py-0.5 font-display text-xs font-medium text-amber-800 ring-1 ring-amber-200";
    chip.textContent = "號碼待辨識";
    bibRow.appendChild(chip);
  }

  if (opts.showAddedAt && record.addedAt) {
    const timeLine = document.createElement("p");
    timeLine.className = "text-xs text-ink-700/65";
    timeLine.textContent = `${formatRelative(record.addedAt)} · ${formatTaiwanTime(record.addedAt)}`;
    body.append(title, timeLine, bibRow);
  } else {
    body.append(title, bibRow);
  }

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className =
    "inline-flex w-full items-center justify-center rounded-xl bg-ember-500 px-4 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-ember-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800";
  downloadBtn.textContent = record.driveId ? "開啟／下載原圖" : "下載照片";
  downloadBtn.addEventListener("click", () => downloadPhoto(record));
  body.appendChild(downloadBtn);

  card.append(imgWrap, body);
  return card;
}

function createImageFallback() {
  const fallback = document.createElement("div");
  fallback.className =
    "flex h-full w-full items-center justify-center bg-ink-100 px-4 text-center text-sm text-ink-700/70";
  fallback.textContent = "預覽無法載入（請確認 Drive 已設「知道連結的任何人」可檢視）";
  return fallback;
}

async function downloadPhoto(record) {
  const url = getDownloadUrl(record);
  const filename = displayName(record);
  if (record.driveId || /drive\.google\.com|googleusercontent\.com/i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(objectUrl, filename);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.warn("Blob 下載失敗，改以直接連結：", err);
    triggerAnchorDownload(url, filename);
  }
}

function triggerAnchorDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderRecent(album) {
  const recent = album.recentAdded || [];
  els.recentGrid.innerHTML = "";
  if (!recent.length) {
    els.recentSection.classList.add("hidden");
    return;
  }
  els.recentSection.classList.remove("hidden");
  const frag = document.createDocumentFragment();
  recent.forEach((record, i) => {
    frag.appendChild(createPhotoCard(record, i, { showAddedAt: true }));
  });
  els.recentGrid.appendChild(frag);
}

function renderResults(matches, query) {
  els.grid.innerHTML = "";
  if (!matches.length) {
    els.meta.classList.add("hidden");
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = `
      <p class="font-display text-lg font-semibold text-ink-800">找不到號碼「${escapeHtml(query)}」</p>
      <p class="mt-2 text-sm leading-relaxed text-ink-700/75">
        若照片剛上傳，請稍候同步；新圖若顯示「號碼待辨識」，需再跑本機辨識才進得了搜尋。
      </p>
    `;
    setStatus(`沒有符合號碼 ${query} 的照片。`, "info");
    return;
  }

  els.empty.classList.add("hidden");
  els.meta.classList.remove("hidden");
  els.meta.classList.add("flex");
  els.count.textContent = `號碼 ${query} · 共 ${matches.length} 張照片`;

  const frag = document.createDocumentFragment();
  matches.forEach((record, i) => frag.appendChild(createPhotoCard(record, i)));
  els.grid.appendChild(frag);
  setStatus(`找到 ${matches.length} 張照片。`, "ok");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function searchByBib(rawQuery) {
  const query = normalizeBib(rawQuery);
  if (!query) {
    setStatus("請輸入號碼布編號。", "error");
    return;
  }
  if (!dataReady) {
    setStatus("相簿索引尚未就緒，請稍候再試。", "error");
    return;
  }
  const matches = photoIndex.filter((record) => recordMatchesBib(record, query));
  renderResults(matches, query);
}

async function loadPhotoIndex() {
  setStatus("正在載入相簿索引…");
  if (window.location.protocol === "file:") {
    dataReady = false;
    setStatus(
      "請勿直接雙擊開啟網頁。請使用已部署網址，或本機 python3 -m http.server 8080",
      "error",
    );
    return;
  }

  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const album = normalizeAlbumData(await res.json());
    albumMeta = album;
    photoIndex = album.photos;
    dataReady = true;
    updateStats(album);
    renderRecent(album);
    setStatus(`已載入 ${album.total} 張照片，請輸入號碼布搜尋。`, "ok");
  } catch (err) {
    console.error(err);
    dataReady = false;
    setStatus("無法載入 data.json，請稍後重新整理。", "error");
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchByBib(els.input.value);
});

loadPhotoIndex();
