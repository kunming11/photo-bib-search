/**
 * Google Apps Script：匯出資料夾內所有檔案的 name + driveId
 *
 * 使用方式：
 * 1. https://script.google.com 新增專案，貼上本檔全部內容
 * 2. 將 FOLDER_ID 改成你的硬碟資料夾 ID
 *    （資料夾連結：https://drive.google.com/drive/folders/【這裡就是FOLDER_ID】）
 * 3. 執行 exportFileIds，首次需授權 Google 帳號
 * 4. 執行後會在你的雲端硬碟根目錄產生「drive_map_export」試算表
 * 5. 檔案 → 下載 → CSV，存成專案裡的 drive_map.csv
 */
const FOLDER_ID = "請改成你的資料夾ID";

function exportFileIds() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFiles();
  const rows = [["name", "driveId"]];

  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    // 只匯出圖片
    if (mime && mime.indexOf("image/") === 0) {
      rows.push([file.getName(), file.getId()]);
    }
  }

  const ss = SpreadsheetApp.create("drive_map_export");
  const sheet = ss.getActiveSheet();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  Logger.log("已建立試算表：" + ss.getUrl());
  Logger.log("列數（含表頭）：" + rows.length);
}
