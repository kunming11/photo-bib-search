# 部署指南：Google 硬碟存照片 + 靜態網站上線

## 整體架構

```text
員工瀏覽器
  → GitHub Pages（index.html / app.js / data.json）← 免費託管網頁
  → Google Drive 縮圖／下載（driveId）← 照片本體放這裡
```

本機只負責：放照片 → OCR 產 bibs → 對上 Drive ID → 推送網站檔案。

---

## 步驟 1｜Google 硬碟建立公開資料夾（請你現在做）

1. 開啟 [Google Drive](https://drive.google.com)
2. 新增資料夾，例如：`企業活動相簿-2026`
3. 把活動照片全部上傳進去（可先上傳目前 `photos/` 裡的 4 張測試）
4. 對資料夾按右鍵 → **共用** → 一般存取權選 **知道連結的任何人** → **檢視者** → 完成
5. 再點 **複製連結**，貼回 Cursor 對話給我（或自己留著）

> 重要：若只開「限制」權限，網站上的預覽圖會無法顯示。

---

## 步驟 2｜匯出每個檔案的 Drive ID（擇一）

### 方法 A：少量檔案（手動，適合測試）

對每個檔案：右鍵 → 共用 → 複製連結。  
連結類似：

```text
https://drive.google.com/file/d/1AbCDefGhIjKLmnopQRstuVwxyz/view?usp=sharing
                      └────────── 這一段就是 driveId ──────────┘
```

編輯專案根目錄的 `drive_map.csv`（可複製 `drive_map.csv.example`）：

```csv
name,driveId
截圖 2026-08-03 晚上11.08.06.png,1AbCDefGhIjKLmnopQRstuVwxyz
```

`name` 必須與 `data.json` 裡的檔名一致。

### 方法 B：大量檔案（Google Apps Script，建議）

1. 開啟 [script.google.com](https://script.google.com) → 新增專案  
2. 貼上專案內 `tools/export_drive_ids.gs` 內容  
3. 把 `FOLDER_ID` 改成你資料夾連結裡的 ID  
4. 執行 `exportFileIds`，授權後看「執行記錄」或產生的試算表  
5. 匯出成 `drive_map.csv`

---

## 步驟 3｜合併進 data.json

```bash
cd "/Users/kunming/篩選照片網站"
# 若還沒有 drive_map.csv：
cp drive_map.csv.example drive_map.csv
# 編輯填好 driveId 後：
python3 merge_drive_map.py
```

成功後 `data.json` 會變成：

```json
[
  {
    "name": "xxx.jpg",
    "file": "photos/xxx.jpg",
    "driveId": "1AbC...",
    "bibs": ["15176"]
  }
]
```

---

## 步驟 4｜部署網站到 GitHub Pages（免費）

網站只上傳：`index.html`、`app.js`、`data.json`（**不要**上傳 photos 原圖）。

```bash
cd "/Users/kunming/篩選照片網站"
git add index.html app.js data.json .gitignore README.md merge_drive_map.py
git commit -m "Deploy bib search site with Google Drive photos"
# 建立 GitHub repo 後：
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

在 GitHub：Settings → Pages → Branch 選 `main` → `/ (root)` → Save。  
幾分鐘後網址類似：`https://<帳號>.github.io/<repo>/`

---

## 步驟 5｜驗證

1. 開網站，搜尋 `15176`  
2. 應看到 Drive 預覽圖  
3. 點「開啟／下載原圖」會開 Google Drive 下載  

若預覽裂圖：多半是該檔尚未設「知道連結的任何人」，或 `driveId` 填錯。
