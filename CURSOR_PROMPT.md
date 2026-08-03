# 企業活動號碼布搜尋系統 — Cursor 開發指南與提示詞

## 系統架構定案

| 項目 | 決策 |
|------|------|
| 版權防護 | 不需要浮水印、不鎖右鍵；直接提供原圖下載 |
| 資料結構 | **一張照片 ↔ 多組號碼布**（一對多） |
| 商業模式 | 企業內部員工福利，完全免費 |
| OCR 時機 | **僅後台批次**，前端禁止即時呼叫 OCR |
| 成本策略 | 本地 Ollama 視覺模型批次辨識 + 純靜態前端託管 |

---

## 目錄結構（目標產出）

```text
/
├── index.html          # 單頁前端
├── app.js              # 搜尋與渲染邏輯
├── data.json           # 照片 ↔ 號碼布映射（批次腳本產出）
├── process_photos.py   # 本地批次 OCR 腳本
├── requirements.txt    # Python 依賴
├── photos/             # 本地照片目錄（批次輸入；部署時可改為圖床 URL）
└── README.md           # 使用與部署說明
```

---

## data.json 資料結構（一對多）

```json
[
  {
    "file": "photos/IMG_0001.jpg",
    "bibs": ["1024", "0598"]
  },
  {
    "file": "photos/IMG_0002.jpg",
    "bibs": ["2048"]
  }
]
```

- `file`：相對路徑或完整 CDN URL（例如 Cloudflare R2）
- `bibs`：該張照片中辨識到的所有號碼布（字串陣列，保留前導零）

---

## Cursor 專用超級提示詞（Mega-Prompt）

將下方整段複製到 Cursor Agent / Composer 對話框即可開工：

```text
[角色任務]
你是一名資深全端工程師與雲端架構師，請在目前工作區實作一個企業內部「路跑／活動照片號碼布搜尋」單頁應用（SPA），並提供本地批次辨識腳本。

[背景]
- 對象：員工福利相簿，完全免費下載，無版權防護需求（不要浮水印、不要鎖右鍵）。
- 成本：極致 Cost Down。前端純靜態；OCR 只在本機 Mac 用 Ollama 視覺模型批次跑，嚴禁前端即時呼叫 OCR API。
- 照片：開發階段放 photos/；上線可改為 Cloudflare R2（免 egress）等靜態圖床 URL。

[資料結構 — 必須一對多]
data.json 格式為陣列，每筆：
{ "file": "photos/xxx.jpg", "bibs": ["1024", "0598"] }
一張照片可對應多組號碼。

[具體產出]
1. index.html
   - HTML + Tailwind CSS（CDN）
   - 畫面中央醒目搜尋區：「輸入號碼布編號」+「搜尋」按鈕
   - 企業活動現代感 UI（留白、圓角、平滑 hover），避免陽春
   - 結果以 RWD Grid 呈現；每張卡片有「下載照片」按鈕

2. app.js
   - 非同步載入同目錄 data.json
   - 比對 bibs（忽略大小寫、修剪空白；支援前導零精確比對，並可選擇忽略前導零的寬鬆比對）
   - 顯示符合條件的所有照片；無結果時友善提示
   - 下載按鈕觸發圖片下載（同源相對路徑或跨網域時用 a[download] / fetch blob 盡力下載）

3. process_photos.py
   - 遍歷本地 photos/ 目錄（jpg/jpeg/png/webp）
   - 透過 requests 呼叫本機 Ollama（預設 http://127.0.0.1:11434），使用視覺模型（可設定，預設 llava 或 qwen2.5vl）
   - 解析模型回傳中的號碼布清單，寫入 data.json（一對多）
   - 模組化：讀圖、呼叫模型、解析號碼、寫檔分開；完整中文註解
   - 支援 --dry-run、--limit、續跑（已存在的 file 可跳過）

4. 範例 data.json（至少 2～3 筆假資料）
5. requirements.txt、README.md（本機預覽、Ollama 流程、部署到 GitHub Pages / Vercel / 靜態主機的清單）

[約束]
- 程式高度模組化、變數命名清晰、完整中文註解
- 前端零 OCR、零後端 API
- 不要加入金流、購物車、浮水印
- 直接在工作區建立檔案並實作，不要只給說明文字
```

---

## 你確認過的產品決策（給 Cursor 的上下文）

1. **無版權問題** → 直接原圖下載  
2. **一張照片多號碼** → `bibs` 陣列  
3. **企業內部免費福利** → 無金流、無解鎖高畫質

---

## 建議工作流程（實作完成後）

1. 將活動照片放入 `photos/`
2. 啟動 Ollama，拉取視覺模型（例如 `ollama pull llava`）
3. 執行 `python3 process_photos.py` 產出 `data.json`
4. 本機用靜態伺服器預覽（例如 `python3 -m http.server 8080`）
5. 部署 `index.html`、`app.js`、`data.json` 與照片（或改寫 `file` 為 R2 URL）到免費靜態託管
6. 把連結發給員工
