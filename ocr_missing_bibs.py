#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
為「尚無號碼」的照片自動 OCR（Tesseract），並寫回 data.json + bibs_lock.json。

設計給 GitHub Actions：下載 Drive 縮圖 → 辨識數字 → 更新索引。
辨識率不如人工／視覺模型，但可讓上傳後自動可搜尋。
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def download_thumbnail(drive_id: str, dest: Path) -> None:
    url = f"https://drive.google.com/thumbnail?id={drive_id}&sz=w2000"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    def _open(ctx: ssl.SSLContext) -> bytes:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
            return resp.read()

    try:
        data = _open(ssl.create_default_context())
    except (ssl.SSLError, urllib.error.URLError):
        data = _open(ssl._create_unverified_context())  # noqa: S323
    dest.write_bytes(data)


def tesseract_digits(image_path: Path) -> str:
    """呼叫 tesseract，只允許數字。"""
    cmd = [
        "tesseract",
        str(image_path),
        "stdout",
        "--psm",
        "11",
        "-c",
        "tessedit_char_whitelist=0123456789",
    ]
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        print("找不到 tesseract，請先安裝 tesseract-ocr", file=sys.stderr)
        return ""
    except subprocess.TimeoutExpired:
        return ""
    return (result.stdout or "") + "\n" + (result.stderr or "")


def extract_bibs(text: str) -> list[str]:
    """從 OCR 文字抓 3～6 位號碼，去重保序。"""
    found = re.findall(r"\b\d{3,6}\b", text)
    seen: set[str] = set()
    out: list[str] = []
    for n in found:
        if n not in seen:
            seen.add(n)
            out.append(n)
    # 太多雜訊時只留前幾個較可能是號碼布
    return out[:8]


def load_lock(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_lock(path: Path, lock: dict[str, list[str]]) -> None:
    path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR 補齊缺少的號碼布")
    parser.add_argument("--data", type=Path, default=Path("data.json"))
    parser.add_argument("--bibs-lock", type=Path, default=Path("bibs_lock.json"))
    parser.add_argument("--limit", type=int, default=20, help="本次最多處理幾張缺號碼的圖")
    args = parser.parse_args()

    if not args.data.exists():
        print(f"找不到 {args.data}", file=sys.stderr)
        return 1

    doc = json.loads(args.data.read_text(encoding="utf-8"))
    if isinstance(doc, list):
        photos = doc
        wrapper = False
    else:
        photos = doc.get("photos") or []
        wrapper = True

    lock = load_lock(args.bibs_lock)
    missing = [
        p
        for p in photos
        if p.get("driveId") and not (p.get("bibs") or lock.get(str(p.get("driveId"))))
    ]
    if args.limit > 0:
        missing = missing[: args.limit]

    if not missing:
        print("沒有需要 OCR 的照片")
        print("CHANGED=false")
        return 0

    print(f"待 OCR：{len(missing)} 張")
    changed = False

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for idx, photo in enumerate(missing, start=1):
            drive_id = str(photo["driveId"])
            name = photo.get("name") or drive_id
            img_path = tmp_dir / f"{idx}.jpg"
            print(f"[{idx}/{len(missing)}] {name} …", flush=True)
            try:
                download_thumbnail(drive_id, img_path)
                text = tesseract_digits(img_path)
                bibs = extract_bibs(text)
                if bibs:
                    photo["bibs"] = bibs
                    lock[drive_id] = bibs
                    changed = True
                    print(f"    → {bibs}")
                else:
                    print("    → （未辨識到號碼）")
            except Exception as exc:  # noqa: BLE001
                print(f"    × 失敗：{exc}", file=sys.stderr)

    # 把 lock 套回全部 photos
    for p in photos:
        did = str(p.get("driveId") or "")
        if did in lock and lock[did]:
            p["bibs"] = [str(b) for b in lock[did]]

    if wrapper:
        assert isinstance(doc, dict)
        doc["photos"] = photos
        doc["total"] = len(photos)
        if changed:
            doc["updatedAt"] = utc_now_iso()
            # 同步 recentAdded 內的 bibs
            for r in doc.get("recentAdded") or []:
                did = str(r.get("driveId") or "")
                if did in lock:
                    r["bibs"] = lock[did]
        args.data.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        args.data.write_text(json.dumps(photos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    save_lock(args.bibs_lock, lock)
    print(f"CHANGED={'true' if changed else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
