#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同步公開 Google Drive 資料夾 → data.json

- 保留既有 bibs / addedAt
- 新檔案寫入 addedAt（首次發現時間，UTC）
- 輸出格式含 updatedAt、total、recentAdded、photos
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_FOLDER_ID = "1Vajva5anAFBZA03gd1UsO9MjBO3yPEKs"
RECENT_HOURS = 72  # 「最近新增」視窗：72 小時內


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def extract_folder_id(value: str) -> str:
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", value.strip()):
        return value.strip()
    raise ValueError("無法辨識資料夾 ID")


def fetch_folder_html(folder_id: str, *, embedded: bool = False) -> str:
    if embedded:
        url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    else:
        url = f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    def _open(ctx: ssl.SSLContext) -> str:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
            return resp.read().decode("utf-8", "ignore")

    try:
        return _open(ssl.create_default_context())
    except (ssl.SSLError, urllib.error.URLError):
        # 部分本機 Python 憑證不完整；CI（Ubuntu）通常不需要這段
        return _open(ssl._create_unverified_context())  # noqa: S323


def parse_drive_files_from_folder_page(html: str) -> list[dict[str, str]]:
    """從一般資料夾頁解析（常只含前約 50 筆，易漏檔）。"""
    pairs = re.findall(
        r'data-id="([a-zA-Z0-9_-]{20,})"[^>]*data-tooltip="([^"]+?)\s+Image"',
        html,
    )
    if not pairs:
        pairs = [
            (pid, name)
            for name, pid in re.findall(
                r'data-tooltip="([^"]+?)\s+Image"[^>]*data-id="([a-zA-Z0-9_-]{20,})"',
                html,
            )
        ]

    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for drive_id, name in pairs:
        name = name.strip()
        if not name or drive_id in seen:
            continue
        seen.add(drive_id)
        out.append({"name": name, "driveId": drive_id})
    return out


def parse_drive_files_from_embedded(html: str) -> list[dict[str, str]]:
    """
    從 embeddedfolderview 解析完整清單（通常比一般頁面完整）。
    結構：<div class="flip-entry" id="entry-FILEID"> ... flip-entry-title>NAME<
    """
    image_ext = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".JPG", ".JPEG", ".PNG", ".WEBP", ".GIF")
    parts = re.split(r'<div class="flip-entry"', html)[1:]
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for part in parts:
        mid = re.search(r'\bid="entry-([a-zA-Z0-9_-]+)"', part)
        title = re.search(r"flip-entry-title[^>]*>([^<]+)<", part)
        if not mid or not title:
            continue
        drive_id = mid.group(1)
        name = title.group(1).strip()
        if not name or drive_id in seen:
            continue
        if not name.endswith(image_ext):
            # 略過資料夾或其他非圖片
            continue
        seen.add(drive_id)
        out.append({"name": name, "driveId": drive_id})
    return out


def parse_drive_files(html: str) -> list[dict[str, str]]:
    """相容舊呼叫：先當一般頁解析。"""
    return parse_drive_files_from_folder_page(html)


def list_drive_folder_images(folder_id: str) -> list[dict[str, str]]:
    """列出資料夾內圖片：優先 embedded（完整），不足再併一般頁結果。"""
    by_id: dict[str, dict[str, str]] = {}

    try:
        embed_html = fetch_folder_html(folder_id, embedded=True)
        for item in parse_drive_files_from_embedded(embed_html):
            by_id[item["driveId"]] = item
        print(f"embeddedfolderview 解析到 {len(by_id)} 張")
    except Exception as exc:  # noqa: BLE001
        print(f"embeddedfolderview 失敗：{exc}")

    try:
        page_html = fetch_folder_html(folder_id, embedded=False)
        page_items = parse_drive_files_from_folder_page(page_html)
        print(f"一般資料夾頁解析到 {len(page_items)} 張")
        for item in page_items:
            by_id.setdefault(item["driveId"], item)
    except Exception as exc:  # noqa: BLE001
        print(f"一般資料夾頁失敗：{exc}")

    # 依檔名排序，結果穩定
    return sorted(by_id.values(), key=lambda x: x["name"].lower())


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"photos": []}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return {"photos": raw}
    if isinstance(raw, dict) and isinstance(raw.get("photos"), list):
        return raw
    raise ValueError("data.json 格式無法辨識")


def index_existing(photos: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """以 driveId 為主鍵；沒有 driveId 時用 name。"""
    by_key: dict[str, dict[str, Any]] = {}
    for item in photos:
        drive_id = str(item.get("driveId") or "").strip()
        name = str(item.get("name") or Path(str(item.get("file") or "")).name).strip()
        if drive_id:
            by_key[f"id:{drive_id}"] = item
        if name:
            by_key[f"name:{name}"] = item
    return by_key


def apply_bibs_lock(photos: list[dict[str, Any]], lock_path: Path) -> list[dict[str, Any]]:
    """用 bibs_lock.json 覆蓋／補上號碼，避免自動同步洗掉已辨識結果。"""
    if not lock_path.exists():
        return photos
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return photos
    if not isinstance(lock, dict):
        return photos

    out: list[dict[str, Any]] = []
    for p in photos:
        item = dict(p)
        drive_id = str(item.get("driveId") or "")
        locked = lock.get(drive_id)
        if isinstance(locked, list) and locked:
            item["bibs"] = [str(b) for b in locked if str(b).strip()]
        out.append(item)
    return out


def merge_photos(
    drive_files: list[dict[str, str]],
    existing_photos: list[dict[str, Any]],
    now_iso: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """回傳 (合併後 photos, 本次新發現的 photos)。"""
    existing = index_existing(existing_photos)
    merged: list[dict[str, Any]] = []
    newly: list[dict[str, Any]] = []

    for f in drive_files:
        name = f["name"]
        drive_id = f["driveId"]
        prev = existing.get(f"id:{drive_id}") or existing.get(f"name:{name}") or {}

        bibs = prev.get("bibs") if isinstance(prev.get("bibs"), list) else []
        is_new = not prev
        if is_new:
            added_at = now_iso
        else:
            # 舊圖若沒有 addedAt，視為歷史資料（不擠進「最近新增」）
            added_at = prev.get("addedAt") or "1970-01-01T00:00:00Z"

        record: dict[str, Any] = {
            "name": name,
            "driveId": drive_id,
            "bibs": [str(b) for b in bibs],
            "addedAt": added_at,
        }
        # 保留本機 file 欄位（方便本機預覽）
        if prev.get("file"):
            record["file"] = prev["file"]

        merged.append(record)
        if is_new:
            newly.append(record)

    return merged, newly


def build_payload(
    *,
    folder_id: str,
    photos: list[dict[str, Any]],
    newly: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, Any]:
    # 最近新增：72 小時內，或本次同步新發現
    recent_ids = {p["driveId"] for p in newly}
    cutoff = datetime.now(timezone.utc).timestamp() - RECENT_HOURS * 3600
    recent: list[dict[str, Any]] = []
    for p in photos:
        if p["driveId"] in recent_ids:
            recent.append(p)
            continue
        try:
            ts = datetime.fromisoformat(str(p.get("addedAt", "")).replace("Z", "+00:00")).timestamp()
            if ts >= cutoff:
                recent.append(p)
        except ValueError:
            continue

    # 新→舊
    recent.sort(key=lambda x: str(x.get("addedAt") or ""), reverse=True)

    return {
        "updatedAt": now_iso,
        "folderId": folder_id,
        "total": len(photos),
        "recentAddedCount": len(recent),
        "recentAdded": [
            {
                "name": p["name"],
                "driveId": p["driveId"],
                "addedAt": p.get("addedAt"),
                "bibs": p.get("bibs") or [],
            }
            for p in recent[:30]
        ],
        "photos": photos,
    }


def payloads_equal_for_commit(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """忽略 updatedAt，比對實質內容是否變更。"""
    def strip(p: dict[str, Any]) -> dict[str, Any]:
        out = dict(p)
        out.pop("updatedAt", None)
        return out

    return json.dumps(strip(a), sort_keys=True, ensure_ascii=False) == json.dumps(
        strip(b), sort_keys=True, ensure_ascii=False
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="同步 Google Drive 資料夾到 data.json")
    parser.add_argument("--folder", default="", help="資料夾連結或 ID（預設讀 config.json）")
    parser.add_argument("--config", type=Path, default=Path("config.json"))
    parser.add_argument("--data", type=Path, default=Path("data.json"))
    parser.add_argument("--bibs-lock", type=Path, default=Path("bibs_lock.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    folder_id = args.folder.strip()
    if not folder_id and args.config.exists():
        cfg = json.loads(args.config.read_text(encoding="utf-8"))
        folder_id = cfg.get("driveFolderId") or cfg.get("driveFolderUrl") or ""
    if not folder_id:
        folder_id = DEFAULT_FOLDER_ID
    folder_id = extract_folder_id(folder_id)

    existing_doc = load_existing(args.data)
    existing_photos = existing_doc.get("photos") or []

    print(f"讀取 Drive 資料夾 {folder_id} …")
    drive_files = list_drive_folder_images(folder_id)
    if not drive_files:
        print("錯誤：沒有解析到任何圖片。請確認資料夾為公開「知道連結的任何人」。", file=sys.stderr)
        return 1

    now_iso = utc_now_iso()
    photos, newly = merge_photos(drive_files, existing_photos, now_iso)
    photos = apply_bibs_lock(photos, args.bibs_lock)
    payload = build_payload(folder_id=folder_id, photos=photos, newly=newly, now_iso=now_iso)

    print(f"硬碟圖片 {len(drive_files)} 張｜索引總數 {payload['total']}｜本次新增 {len(newly)}")
    for p in newly:
        print(f"  + {p['name']} ({p['driveId']})")

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:1200])
        return 0

    changed = True
    if args.data.exists():
        try:
            old_raw = json.loads(args.data.read_text(encoding="utf-8"))
            if isinstance(old_raw, list):
                old_cmp = {
                    "folderId": folder_id,
                    "total": len(old_raw),
                    "photos": old_raw,
                    "recentAdded": [],
                    "recentAddedCount": 0,
                }
            else:
                old_cmp = old_raw
            changed = (not payloads_equal_for_commit(old_cmp, payload)) or bool(newly)
        except (json.JSONDecodeError, OSError):
            changed = True

    args.data.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已寫入 {args.data.resolve()}")
    # 給 GitHub Action 判斷是否 commit
    print(f"CHANGED={'true' if changed else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
