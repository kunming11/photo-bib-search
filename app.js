/**
 * 活動相簿前端
 * - 上方：號碼布搜尋（主焦點）
 * - 下方：瀏覽全部小縮圖（每頁 15 張）
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
 * @property {PhotoRecord[]} photos
 */

/** @type {PhotoRecord[]} */
let photoIndex = [];

/** @type {AlbumData|null} */
let albumMeta = null;

let dataReady = false;

/** 瀏覽區每頁張數 */
const BROWSE_PAGE_SIZE = 15;

/** 瀏覽區目前頁碼（從 1 起） */
let browsePage = 1;

/** 目前瀏覽區選中的 driveId／檔名 */
let browseSelectedKey = "";

const els = {
  form: document.getElementById("search-form"),
  input: document.getElementById("bib-input"),
  status: document.getElementById("status-text"),
  grid: document.getElementById("results-grid"),
  empty: document.getElementById("empty-state"),
  meta: document.getElementById("results-meta"),
  count: document.getElementById("results-count"),
  statLine: document.getElementById("stat-line"),
  resultsSection: document.getElementById("results-section"),
  browseSection: document.getElementById("browse-section"),
  browseGrid: document.getElementById("browse-grid"),
  browseSummary: document.getElementById("browse-summary"),
  browsePageLabel: document.getElementById("browse-page-label"),
  browsePrev: document.getElementById("browse-prev"),
  browseNext: document.getElementById("browse-next"),
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
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w2000`;
  }
  return encodeAssetUrl(record.file || "");
}

/** 瀏覽區用較小縮圖，加快翻頁 */
function getBrowseThumbUrl(record) {
  const driveId = extractDriveId(record.driveId || "") || extractDriveId(record.file || "");
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w400`;
  }
  return encodeAssetUrl(record.file || "");
}

function recordKey(record) {
  return String(record.driveId || record.file || record.name || "");
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
  if (!els.statLine) return;
  const total = album.total ?? album.photos.length;
  if (album.updatedAt) {
    els.statLine.textContent = `目前共 ${total} 張照片 · 最後同步 ${formatTaiwanTime(album.updatedAt)}`;
  } else {
    els.statLine.textContent = `目前共 ${total} 張照片`;
  }
}

/**
 * 搜尋結果卡片：上方完整預覽（不裁切），下方資訊＋下載
 * 底部品牌區先保持簡潔，之後可再換成正式活動視覺
 * @param {PhotoRecord} record
 * @param {number} index
 */
function createPhotoCard(record, index) {
  const card = document.createElement("article");
  card.className =
    "photo-card fade-in overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200/70";
  card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

  const imgWrap = document.createElement("div");
  imgWrap.className = "photo-stage";

  const img = document.createElement("img");
  img.src = getPreviewUrl(record);
  img.alt = `活動照片 ${displayName(record)}`;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(createImageFallback());
  imgWrap.appendChild(img);

  const body = document.createElement("div");
  body.className = "space-y-4 px-5 pb-5 pt-4";

  // 底部品牌／活動資訊（之後可再換成你的正式設計）
  const brand = document.createElement("div");
  brand.className = "text-center";
  brand.innerHTML = `
    <p class="font-display text-xs font-semibold tracking-[0.18em] text-ember-600 uppercase">Corporate Event</p>
    <p class="mt-1 font-display text-base font-semibold text-ink-900">活動相簿</p>
  `;

  const meta = document.createElement("div");
  meta.className = "space-y-1 text-center text-sm text-ink-700/80";
  const idLine = document.createElement("p");
  idLine.textContent = `照片：${displayName(record)}`;
  meta.appendChild(idLine);
  if (record.addedAt) {
    const timeLine = document.createElement("p");
    timeLine.textContent = `同步時間：${formatTaiwanTime(record.addedAt)}`;
    meta.appendChild(timeLine);
  }
  if (record.bibs?.length) {
    const bibLine = document.createElement("p");
    bibLine.className = "font-display text-xs tracking-wide text-ink-700";
    bibLine.textContent = `號碼布：${record.bibs.map((b) => `#${normalizeBib(b)}`).join("  ")}`;
    meta.appendChild(bibLine);
  }

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className =
    "inline-flex w-full items-center justify-center rounded-xl bg-[#1d7fe0] px-4 py-3.5 font-display text-base font-semibold text-white transition hover:bg-[#1666b8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", () => downloadPhoto(record));

  body.append(brand, meta, downloadBtn);
  card.append(imgWrap, body);
  return card;
}

function createImageFallback() {
  const fallback = document.createElement("div");
  fallback.className =
    "flex min-h-[240px] w-full items-center justify-center px-4 text-center text-sm text-white/80";
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

function renderResults(matches, query) {
  els.grid.innerHTML = "";
  if (!matches.length) {
    els.meta.classList.add("hidden");
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = `
      <p class="font-display text-lg font-semibold text-ink-800">找不到號碼「${escapeHtml(query)}」</p>
      <p class="mt-2 text-sm leading-relaxed text-ink-700/75">
        請確認編號是否正確；若照片剛上傳，請稍候再試。
      </p>
    `;
    setStatus(`沒有符合號碼 ${query} 的照片。`, "info");
    els.resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  // 結果就在搜尋框下方，捲動確保手機上也看得到
  els.resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  browseSelectedKey = "";
  renderBrowsePage();
  const matches = photoIndex.filter((record) => recordMatchesBib(record, query));
  renderResults(matches, query);
}

/**
 * 在上方結果區顯示單張（從瀏覽縮圖點入）
 * @param {PhotoRecord} record
 */
function showBrowseDetail(record) {
  browseSelectedKey = recordKey(record);
  renderBrowsePage();
  els.empty.classList.add("hidden");
  els.meta.classList.remove("hidden");
  els.meta.classList.add("flex");
  els.count.textContent = `瀏覽預覽 · ${displayName(record)}`;
  els.grid.innerHTML = "";
  els.grid.appendChild(createPhotoCard(record, 0));
  setStatus("可下載此照片，或繼續翻頁瀏覽。", "ok");
  els.resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function browseTotalPages() {
  return Math.max(1, Math.ceil(photoIndex.length / BROWSE_PAGE_SIZE));
}

function renderBrowsePage() {
  if (!els.browseGrid) return;
  const total = photoIndex.length;
  const pages = browseTotalPages();
  if (browsePage > pages) browsePage = pages;
  if (browsePage < 1) browsePage = 1;

  const start = (browsePage - 1) * BROWSE_PAGE_SIZE;
  const slice = photoIndex.slice(start, start + BROWSE_PAGE_SIZE);

  if (els.browseSummary) {
    els.browseSummary.textContent =
      total === 0
        ? "尚無照片"
        : `共 ${total} 張 · 每頁最多 ${BROWSE_PAGE_SIZE} 張`;
  }
  if (els.browsePageLabel) {
    els.browsePageLabel.textContent = total === 0 ? "" : `第 ${browsePage} / ${pages} 頁`;
  }
  if (els.browsePrev) els.browsePrev.disabled = browsePage <= 1 || total === 0;
  if (els.browseNext) els.browseNext.disabled = browsePage >= pages || total === 0;

  els.browseGrid.innerHTML = "";
  const frag = document.createDocumentFragment();
  slice.forEach((record) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "browse-thumb aspect-square overflow-hidden rounded-lg bg-ink-100 ring-1 ring-ink-200/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-500";
    if (recordKey(record) === browseSelectedKey) {
      btn.classList.add("is-active");
    }
    btn.title = displayName(record);
    btn.setAttribute("aria-label", `預覽 ${displayName(record)}`);

    const img = document.createElement("img");
    img.src = getBrowseThumbUrl(record);
    img.alt = displayName(record);
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.className = "h-full w-full object-cover";
    img.onerror = () => {
      img.remove();
      btn.classList.add("flex", "items-center", "justify-center", "p-2", "text-center", "text-[10px]", "text-ink-700/60");
      btn.textContent = "無法預覽";
    };

    btn.appendChild(img);
    btn.addEventListener("click", () => showBrowseDetail(record));
    frag.appendChild(btn);
  });
  els.browseGrid.appendChild(frag);
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
    browsePage = 1;
    updateStats(album);
    renderBrowsePage();
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

els.browsePrev?.addEventListener("click", () => {
  if (browsePage > 1) {
    browsePage -= 1;
    renderBrowsePage();
    els.browseSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

els.browseNext?.addEventListener("click", () => {
  if (browsePage < browseTotalPages()) {
    browsePage += 1;
    renderBrowsePage();
    els.browseSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

loadPhotoIndex();
