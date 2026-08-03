#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
從「知道連結的任何人」公開的 Google Drive 資料夾頁面，抓取檔名與 driveId。
不需 API Key（依賴公開資料夾網頁）。大量檔案時建議改用 tools/export_drive_ids.gs。
"""

from __future__ import annotations

import argparse
import csv
import re
import ssl
import sys
import urllib.request
from pathlib import Path


def fetch_folder_html(folder_id: str) -> str:
    url = f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            return resp.read().decode("utf-8", "ignore")
    except ssl.SSLError:
        # 部分 macOS Python 憑證不完整時的後備
        ctx = ssl._create_unverified_context()  # noqa: S323
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            return resp.read().decode("utf-8", "ignore")


def parse_files(html: str) -> list[tuple[str, str]]:
    """回傳 [(name, driveId), ...]，依出現順序去重。"""
    # data-id="ID" ... data-tooltip="檔名 Image"
    pairs = re.findall(
        r'data-id="([a-zA-Z0-9_-]{20,})"[^>]*data-tooltip="([^"]+?)\s+Image"',
        html,
    )
    if not pairs:
        # 後備：data-tooltip 在前
        pairs = re.findall(
            r'data-tooltip="([^"]+?)\s+Image"[^>]*data-id="([a-zA-Z0-9_-]{20,})"',
            html,
        )
        pairs = [(pid, name) for name, pid in pairs]

    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for drive_id, name in pairs:
        name = name.strip()
        if drive_id in seen or not name:
            continue
        seen.add(drive_id)
        out.append((name, drive_id))
    return out


def extract_folder_id(value: str) -> str:
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", value.strip()):
        return value.strip()
    raise ValueError("無法辨識資料夾 ID，請貼 folders/ 連結或純 ID")


def main() -> int:
    parser = argparse.ArgumentParser(description="匯出公開 Drive 資料夾檔案清單")
    parser.add_argument("folder", help="資料夾分享連結或 ID")
    parser.add_argument("--output", type=Path, default=Path("drive_map.csv"))
    args = parser.parse_args()

    folder_id = extract_folder_id(args.folder)
    print(f"讀取資料夾 {folder_id} …")
    html = fetch_folder_html(folder_id)
    files = parse_files(html)
    if not files:
        print("沒有解析到檔案。請確認資料夾為「知道連結的任何人」可檢視。", file=sys.stderr)
        return 1

    with args.output.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "driveId"])
        writer.writerows(files)

    print(f"已寫入 {args.output}，共 {len(files)} 筆：")
    for name, drive_id in files:
        print(f"  {name} → {drive_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
