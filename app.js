/**
 * 活動相簿前端邏輯
 * - 僅讀取靜態 data.json 做搜尋，絕不呼叫 OCR / 後端 API
 * - 支援本機路徑或 Google Drive（driveId）一對多號碼布
 */

/**
 * @typedef {Object} PhotoRecord
 * @property {string=} file      本機相對路徑或完整 URL（可選）
 * @property {string=} driveId  Google Drive 檔案 ID（部署後建議用這個）
 * @property {string=} name     顯示用檔名（可選）
 * @property {string[]} bibs    該張照片的號碼布清單
 */

/** @type {PhotoRecord[]} */
let photoIndex = [];

/** 資料是否已成功載入 */
let dataReady = false;

const els = {
  form: document.getElementById("search-form"),
  input: document.getElementById("bib-input"),
  status: document.getElementById("status-text"),
  grid: document.getElementById("results-grid"),
  empty: document.getElementById("empty-state"),
  meta: document.getElementById("results-meta"),
  count: document.getElementById("results-count"),
};

/**
 * 正規化號碼布字串：去空白、統一為字串
 * @param {string} value
 * @returns {string}
 */
function normalizeBib(value) {
  return String(value ?? "").trim();
}

/**
 * 寬鬆比對用：去掉前導零後再比（保留純 "0"）
 * @param {string} value
 * @returns {string}
 */
function stripLeadingZeros(value) {
  const n = normalizeBib(value);
  if (!n) return "";
  const stripped = n.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

/**
 * 判斷一筆記錄是否包含目標號碼
 * @param {PhotoRecord} record
 * @param {string} query
 * @returns {boolean}
 */
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

/**
 * 從分享連結或純 ID 抽出 Google Drive 檔案 ID
 * @param {string} value
 * @returns {string|null}
 */
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

/**
 * 預覽用 URL（網頁上顯示縮圖／大圖）
 * Drive 公開「知道連結的任何人」後，thumbnail 較穩定可嵌在 <img>
 * @param {PhotoRecord} record
 * @returns {string}
 */
function getPreviewUrl(record) {
  const driveId = extractDriveId(record.driveId || "") || extractDriveId(record.file || "");
  if (driveId) {
    // sz=w1600：預覽夠清晰；比 uc?export=view 較不易被擋
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1600`;
  }
  return encodeAssetUrl(record.file || "");
}

/**
 * 下載／開啟原圖用 URL
 * @param {PhotoRecord} record
 * @returns {string}
 */
function getDownloadUrl(record) {
  const driveId = extractDriveId(record.driveId || "") || extractDriveId(record.file || "");
  if (driveId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
  }
  return encodeAssetUrl(record.file || "");
}

/**
 * 顯示用標題
 * @param {PhotoRecord} record
 * @returns {string}
 */
function displayName(record) {
  if (record.name) return record.name;
  if (record.file) {
    const name = record.file.split("/").pop() || record.file;
    if (!/^https?:\/\//i.test(name)) return name;
  }
  if (record.driveId) return `Drive ${String(record.driveId).slice(0, 8)}…`;
  return "活動照片";
}

/**
 * 將相對路徑編碼；完整 URL 原樣回傳
 * @param {string} filePath
 * @returns {string}
 */
function encodeAssetUrl(filePath) {
  const path = String(filePath || "");
  if (/^https?:\/\//i.test(path)) return path;
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * 設定狀態列文字
 * @param {string} message
 * @param {"info"|"error"|"ok"} [tone]
 */
function setStatus(message, tone = "info") {
  els.status.textContent = message;
  els.status.classList.remove("text-red-600", "text-ink-700/70", "text-ink-800");
  if (tone === "error") {
    els.status.classList.add("text-red-600");
  } else if (tone === "ok") {
    els.status.classList.add("text-ink-800");
  } else {
    els.status.classList.add("text-ink-700/70");
  }
}

/**
 * 非同步載入 data.json
 */
async function loadPhotoIndex() {
  setStatus("正在載入相簿索引…");

  if (window.location.protocol === "file:") {
    dataReady = false;
    setStatus(
      "請勿直接雙擊開啟網頁。請在終端機執行 python3 -m http.server 8080，再打開 http://127.0.0.1:8080/",
      "error",
    );
    return;
  }

  try {
    const res = await fetch("./data.json", { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("data.json 格式錯誤：頂層應為陣列");
    }
    photoIndex = data;
    dataReady = true;
    setStatus(`已載入 ${photoIndex.length} 張照片索引，請輸入號碼布搜尋。`, "ok");
  } catch (err) {
    console.error(err);
    dataReady = false;
    setStatus(
      "無法載入 data.json。請確認伺服器是在專案資料夾啟動，網址為 http://127.0.0.1:8080/",
      "error",
    );
  }
}

/**
 * 建立單張照片卡片 DOM
 * @param {PhotoRecord} record
 * @param {number} index
 * @returns {HTMLElement}
 */
function createPhotoCard(record, index) {
  const card = document.createElement("article");
  card.className =
    "photo-card fade-in overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200/70";
  card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

  const imgWrap = document.createElement("div");
  imgWrap.className = "aspect-[4/3] overflow-hidden bg-ink-100";

  const img = document.createElement("img");
  img.src = getPreviewUrl(record);
  img.alt = `活動照片 ${displayName(record)}`;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.className = "h-full w-full object-cover";
  img.onerror = () => {
    img.replaceWith(createImageFallback());
  };
  imgWrap.appendChild(img);

  const body = document.createElement("div");
  body.className = "space-y-3 p-4";

  const title = document.createElement("h2");
  title.className = "truncate font-display text-sm font-semibold text-ink-800";
  title.textContent = displayName(record);
  title.title = displayName(record);

  const bibRow = document.createElement("p");
  bibRow.className = "flex flex-wrap gap-1.5";
  (record.bibs || []).forEach((bib) => {
    const chip = document.createElement("span");
    chip.className =
      "rounded-md bg-ink-50 px-2 py-0.5 font-display text-xs font-medium tracking-wide text-ink-700 ring-1 ring-ink-200";
    chip.textContent = `#${normalizeBib(bib)}`;
    bibRow.appendChild(chip);
  });

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className =
    "inline-flex w-full items-center justify-center rounded-xl bg-ember-500 px-4 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-ember-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800";
  downloadBtn.textContent = record.driveId ? "開啟／下載原圖" : "下載照片";
  downloadBtn.addEventListener("click", () => downloadPhoto(record));

  body.append(title, bibRow, downloadBtn);
  card.append(imgWrap, body);
  return card;
}

/**
 * 圖片載入失敗時的佔位
 * @returns {HTMLElement}
 */
function createImageFallback() {
  const fallback = document.createElement("div");
  fallback.className =
    "flex h-full w-full items-center justify-center bg-ink-100 px-4 text-center text-sm text-ink-700/70";
  fallback.textContent = "預覽無法載入（請確認 Drive 已設「知道連結的任何人」可檢視）";
  return fallback;
}

/**
 * 下載：Drive 改開新分頁（避免 CORS）；本機路徑仍嘗試 blob 下載
 * @param {PhotoRecord} record
 */
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

/**
 * 建立隱藏 <a> 觸發下載
 * @param {string} href
 * @param {string} filename
 */
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

/**
 * 渲染搜尋結果
 * @param {PhotoRecord[]} matches
 * @param {string} query
 */
function renderResults(matches, query) {
  els.grid.innerHTML = "";

  if (!matches.length) {
    els.meta.classList.add("hidden");
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = `
      <p class="font-display text-lg font-semibold text-ink-800">找不到號碼「${escapeHtml(query)}」</p>
      <p class="mt-2 text-sm leading-relaxed text-ink-700/75">
        請確認編號是否正確，或稍後再試（索引可能尚未更新）。
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
  matches.forEach((record, i) => {
    frag.appendChild(createPhotoCard(record, i));
  });
  els.grid.appendChild(frag);
  setStatus(`找到 ${matches.length} 張照片。`, "ok");
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {string} rawQuery
 */
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

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchByBib(els.input.value);
});

loadPhotoIndex();
