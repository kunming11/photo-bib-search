# 企業活動號碼布搜尋相簿

員工輸入號碼布編號 → 搜尋對應活動照片 → 免費下載。  
OCR 只在本機批次執行；前端為純靜態網頁，零伺服器維護費。

## 功能定案

- 無浮水印、無右鍵鎖定，直接下載原圖
- 一張照片可對應多組號碼（`bibs` 陣列）
- 企業內部福利，無金流

## 自動同步（丟上硬碟就會更新網頁）

1. 把照片上傳到公開資料夾（「知道連結的任何人」可檢視）
2. GitHub Actions **約每 5～15 分鐘**自動：
   - 抓取硬碟檔案清單 → 更新 `data.json`
   - 對新圖做 OCR 補號碼（Tesseract，免費）
   - 推送後 GitHub Pages 自動上線
3. 你只要重新整理網站即可搜尋

> 注意：GitHub 排程在繁忙時會延遲，不一定精準 5 分鐘。OCR 對模糊／浮水印照片可能辨識不全，之後仍可人工修正 `bibs_lock.json`。

手動觸發：GitHub → Actions → **Sync Google Drive photos** → Run workflow

資料夾 ID 設定於 `config.json`。號碼布永久保存於 `bibs_lock.json`（同步時不會被洗掉）。


```bash
cd "/Users/kunming/篩選照片網站"
python3 -m http.server 8080
```

瀏覽器開啟 <http://127.0.0.1:8080>，可用範例號碼 `1024`、`0598`、`2048` 測試搜尋（範例圖路徑若尚無實體檔，預覽會顯示佔位提示，但搜尋邏輯可驗證）。

### 2. 安裝 Python 依賴

```bash
pip3 install -r requirements.txt
```

### 3. 準備 Ollama（本機視覺模型）

```bash
# 安裝並啟動 Ollama 後：
ollama pull llava
# 或：ollama pull qwen2.5vl
```

### 4. 批次辨識照片

```bash
# 把活動照片放入 photos/
python3 process_photos.py --dry-run          # 先確認檔案清單
python3 process_photos.py --model llava      # 正式跑，產出 data.json
python3 process_photos.py --limit 5          # 先試 5 張
python3 process_photos.py --force            # 強制重跑已有紀錄
```

腳本會呼叫 `http://127.0.0.1:11434`，將結果寫入 `data.json`：

```json
[
  { "file": "photos/IMG_0001.jpg", "bibs": ["1024", "0598"] }
]
```

## 部署藍圖（Cost Down）

| 項目 | 建議 | 說明 |
|------|------|------|
| 前端託管 | GitHub Pages / Vercel / Netlify / Cloudflare Pages | 靜態檔永久免費層即可 |
| 照片儲存 | 同 repo 的 `photos/`（小量）或 **Cloudflare R2**（大量、免 egress） | 大量圖建議 R2，再把 `data.json` 的 `file` 改成公開 URL |
| 辨識 | 本機 Ollama | 無 Google Vision 變動費用 |
| 搜尋 | 前端讀 `data.json` | 搜尋零成本、零延遲 API |

部署時至少上傳：`index.html`、`app.js`、`data.json`，以及照片（或可公開存取的圖床 URL）。

### 將照片改為 R2 URL 範例

辨識仍用本地檔名跑完後，可把 `data.json` 內路徑批次替換成：

```text
https://<your-r2-public-domain>/events/2026-run/IMG_0001.jpg
```

前端無需改邏輯。

## 專案檔案

| 檔案 | 說明 |
|------|------|
| `index.html` / `app.js` | 搜尋 UI 與渲染 |
| `data.json` | 照片 ↔ 號碼映射 |
| `process_photos.py` | 本地批次 OCR |
| `CURSOR_PROMPT.md` | 給 Cursor 的完整指南與可複製 Mega-Prompt |

## 工作流程（活動當天後）

1. 照片丟進 `photos/`
2. `python3 process_photos.py`
3. 等本機模型跑完產出 `data.json`
4. 部署靜態檔 + 照片／圖床
5. 把網址發給員工
