#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用本機 Ollama 視覺模型，為 data.json 中缺號碼的 Drive 照片補 bibs。"""

from __future__ import annotations

import argparse
import base64
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def download_thumbnail(drive_id: str) -> bytes:
    url = f"https://drive.google.com/thumbnail?id={drive_id}&sz=w1600"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    def _open(ctx: ssl.SSLContext) -> bytes:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
            return resp.read()

    try:
        return _open(ssl.create_default_context())
    except (ssl.SSLError, urllib.error.URLError):
        return _open(ssl._create_unverified_context())  # noqa: S323


PROMPT = """這是路跑／活動照片。請找出圖中所有可見的號碼布數字編號。
規則：
1. 可能有多個人、多組號碼，請全部列出。
2. 只輸出號碼本身（可含前導零），不要其他說明。
3. 找不到就輸出 []。
4. 嚴格以 JSON 陣列回覆，例如：["1024","0598"]
"""


def call_ollama(image_bytes: bytes, model: str, ollama_url: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": model,
        "prompt": PROMPT,
        "images": [b64],
        "stream": False,
        "options": {"temperature": 0.1},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ollama_url.rstrip("/") + "/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return str(body.get("response") or "")


def extract_bibs(text: str) -> list[str]:
    text = text.strip()
    m = re.search(r"\[[\s\S]*?\]", text)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, list):
                bibs = [str(x).strip() for x in parsed if str(x).strip()]
                return _dedupe(bibs)
        except json.JSONDecodeError:
            pass
    return _dedupe(re.findall(r"\b\d{3,6}\b", text))


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for i in items:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out[:10]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data.json"))
    parser.add_argument("--bibs-lock", type=Path, default=Path("bibs_lock.json"))
    parser.add_argument("--model", default="llava")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="連已有號碼也重跑")
    args = parser.parse_args()

    doc = json.loads(args.data.read_text(encoding="utf-8"))
    photos: list[dict[str, Any]] = doc["photos"] if isinstance(doc, dict) else doc
    lock: dict[str, list[str]] = {}
    if args.bibs_lock.exists():
        try:
            lock = json.loads(args.bibs_lock.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            lock = {}

    targets = []
    for p in photos:
        did = str(p.get("driveId") or "")
        if not did:
            continue
        has = bool(p.get("bibs")) or bool(lock.get(did))
        if args.force or not has:
            targets.append(p)
    if args.limit > 0:
        targets = targets[: args.limit]

    print(f"待辨識 {len(targets)} 張｜模型={args.model}")
    for idx, p in enumerate(targets, 1):
        did = str(p["driveId"])
        name = p.get("name") or did
        print(f"[{idx}/{len(targets)}] {name} …", flush=True)
        try:
            img = download_thumbnail(did)
            raw = call_ollama(img, args.model, args.ollama_url)
            bibs = extract_bibs(raw)
            p["bibs"] = bibs
            lock[did] = bibs
            print(f"    → {bibs if bibs else '（無）'}")
        except Exception as exc:  # noqa: BLE001
            print(f"    × {exc}", file=sys.stderr)
            p["bibs"] = p.get("bibs") or []

        # 每張都存，避免中斷全丟
        for q in photos:
            qid = str(q.get("driveId") or "")
            if qid in lock and lock[qid]:
                q["bibs"] = lock[qid]
        if isinstance(doc, dict):
            doc["photos"] = photos
            doc["total"] = len(photos)
            doc["updatedAt"] = utc_now_iso()
            for r in doc.get("recentAdded") or []:
                rid = str(r.get("driveId") or "")
                if rid in lock:
                    r["bibs"] = lock[rid]
            args.data.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            args.data.write_text(json.dumps(photos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        args.bibs_lock.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
