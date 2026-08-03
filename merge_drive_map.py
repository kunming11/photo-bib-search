#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
將 Google Drive 檔案 ID 併入 data.json
------------------------------------
輸入：
  - data.json（含 name/file + bibs，本機辨識結果）
  - drive_map.csv（name,driveId 或 name,share_url）

輸出：
  - 覆寫／寫入 data.json，每筆加上 driveId，部署後前端用 Drive 顯示與下載
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path


def extract_drive_id(value: str) -> str | None:
    """從純 ID 或分享連結抽出 Drive 檔案 ID。"""
    raw = (value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", raw):
        return raw
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"[?&]id=([a-zA-Z0-9_-]+)",
        r"/d/([a-zA-Z0-9_-]+)",
    ]
    for pat in patterns:
        m = re.search(pat, raw)
        if m:
            return m.group(1)
    return None


def basename(path_or_name: str) -> str:
    return Path(str(path_or_name)).name


def load_drive_map(csv_path: Path) -> dict[str, str]:
    """讀取 CSV：欄位 name + driveId（或 share_url / url / link）。"""
    mapping: dict[str, str] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV 沒有表頭")

        fields = {h.strip().lower(): h for h in reader.fieldnames if h}
        name_key = fields.get("name") or fields.get("filename") or fields.get("file")
        id_key = (
            fields.get("driveid")
            or fields.get("drive_id")
            or fields.get("id")
            or fields.get("share_url")
            or fields.get("url")
            or fields.get("link")
        )
        if not name_key or not id_key:
            raise ValueError("CSV 需要欄位 name 與 driveId（或 share_url）")

        for row in reader:
            name = basename((row.get(name_key) or "").strip())
            drive_id = extract_drive_id(row.get(id_key) or "")
            if name and drive_id:
                mapping[name] = drive_id
    return mapping


def merge(records: list[dict], mapping: dict[str, str]) -> tuple[list[dict], int, list[str]]:
    """把 driveId 寫入對應紀錄；回傳 (新清單, 成功數, 找不到對應的檔名)。"""
    merged: list[dict] = []
    hit = 0
    missing: list[str] = []

    for item in records:
        out = dict(item)
        name = out.get("name") or basename(out.get("file") or "")
        if name:
            out["name"] = name
        drive_id = mapping.get(name)
        if drive_id:
            out["driveId"] = drive_id
            hit += 1
        else:
            if name:
                missing.append(name)
        merged.append(out)

    return merged, hit, missing


def main() -> int:
    parser = argparse.ArgumentParser(description="合併 drive_map.csv 到 data.json")
    parser.add_argument("--data", type=Path, default=Path("data.json"))
    parser.add_argument("--map", type=Path, default=Path("drive_map.csv"))
    parser.add_argument("--output", type=Path, default=None, help="預設覆寫 --data")
    args = parser.parse_args()
    output = args.output or args.data

    if not args.data.exists():
        print(f"找不到 {args.data}", file=sys.stderr)
        return 1
    if not args.map.exists():
        print(f"找不到 {args.map}，請先依 drive_map.csv.example 建立對照表", file=sys.stderr)
        return 1

    records = json.loads(args.data.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        print("data.json 頂層必須是陣列", file=sys.stderr)
        return 1

    mapping = load_drive_map(args.map)
    merged, hit, missing = merge(records, mapping)
    output.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"已寫入 {output}：成功對上 Drive ID {hit}/{len(records)} 筆")
    if missing:
        print("尚未對上的檔名：")
        for name in missing:
            print(f"  - {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
