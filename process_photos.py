#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地批次號碼布辨識腳本
----------------------
流程：遍歷 photos/ → 呼叫本機 Ollama 視覺模型 → 解析多組號碼 → 寫入 data.json

設計原則：
- OCR / 視覺辨識只在本機批次執行，前端永不即時呼叫
- 一張照片可對應多組號碼布（一對多）
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("請先安裝依賴：pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


# ——— 預設設定 ———
DEFAULT_PHOTOS_DIR = Path("photos")
DEFAULT_OUTPUT = Path("data.json")
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llava"  # 可改為 qwen2.5vl、llama3.2-vision 等
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG", ".WEBP"}

# 提示詞：要求模型只回傳號碼清單，方便解析
OCR_PROMPT = """你是路跑／企業活動照片的號碼布辨識助手。
請找出圖中所有可見的選手／員工號碼布上的數字編號。
規則：
1. 一張照片可能有多個人、多組號碼，請全部列出。
2. 只輸出號碼本身（可含前導零），不要輸出其他說明文字。
3. 若完全找不到號碼，輸出空陣列。
4. 嚴格以 JSON 陣列格式回覆，例如：["1024","0598"] 或 []
"""


def list_image_files(photos_dir: Path) -> list[Path]:
    """列出 photos 目錄下所有支援的圖片檔（不遞迴子資料夾也可改為 rglob）。"""
    if not photos_dir.is_dir():
        raise FileNotFoundError(f"找不到照片目錄：{photos_dir.resolve()}")

    files = [
        p
        for p in sorted(photos_dir.iterdir())
        if p.is_file() and p.suffix in IMAGE_EXTENSIONS
    ]
    return files


def encode_image_base64(path: Path) -> tuple[str, str]:
    """讀取圖片並轉成 base64；回傳 (base64字串, mime類型)。"""
    mime, _ = mimetypes.guess_type(str(path))
    if not mime:
        mime = "image/jpeg"
    data = path.read_bytes()
    return base64.b64encode(data).decode("ascii"), mime


def call_ollama_vision(
    *,
    image_path: Path,
    ollama_url: str,
    model: str,
    timeout: int = 180,
) -> str:
    """
    呼叫本機 Ollama /api/generate（視覺模型）。
    預留接口：之後可改成 OpenAI 相容 /v1/chat/completions 或其他本地服務。
    """
    b64, _mime = encode_image_base64(image_path)
    endpoint = ollama_url.rstrip("/") + "/api/generate"
    payload: dict[str, Any] = {
        "model": model,
        "prompt": OCR_PROMPT,
        "images": [b64],
        "stream": False,
        "options": {
            "temperature": 0.1,  # 降低隨機性，讓號碼更穩定
        },
    }

    resp = requests.post(endpoint, json=payload, timeout=timeout)
    resp.raise_for_status()
    body = resp.json()
    # Ollama generate 回傳欄位為 response
    return str(body.get("response") or "")


def extract_bibs_from_text(text: str) -> list[str]:
    """
    從模型回覆中解析號碼布清單。
    優先解析 JSON 陣列；失敗則用正則抓取數字字串。
    """
    text = text.strip()
    if not text:
        return []

    # 嘗試擷取第一個 [...] JSON 陣列
    match = re.search(r"\[[\s\S]*?\]", text)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                bibs = [str(x).strip() for x in parsed if str(x).strip()]
                return _dedupe_preserve_order(bibs)
        except json.JSONDecodeError:
            pass

    # 後備：抓取連續數字（2～6 位，符合常見號碼布）
    found = re.findall(r"\b\d{2,6}\b", text)
    return _dedupe_preserve_order(found)


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    """去重但保留出現順序。"""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def load_existing_index(output_path: Path) -> list[dict[str, Any]]:
    """讀取既有 data.json；不存在或損壞則回空陣列。"""
    if not output_path.exists():
        return []
    try:
        data = json.loads(output_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def relative_file_key(image_path: Path, photos_dir: Path) -> str:
    """產生前端使用的相對路徑，例如 photos/IMG_001.jpg。"""
    return str(Path(photos_dir.name) / image_path.name).replace("\\", "/")


def save_index(output_path: Path, records: list[dict[str, Any]]) -> None:
    """以美化縮排寫入 data.json。"""
    output_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def process_photos(args: argparse.Namespace) -> int:
    """主流程：批次辨識並寫檔。"""
    photos_dir: Path = args.photos_dir
    output_path: Path = args.output

    try:
        images = list_image_files(photos_dir)
    except FileNotFoundError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 1

    if args.limit and args.limit > 0:
        images = images[: args.limit]

    if not images:
        print(f"在 {photos_dir} 找不到圖片檔。請放入 jpg/png/webp 後再執行。")
        return 0

    existing = load_existing_index(output_path)
    by_file = {str(item.get("file")): item for item in existing if isinstance(item, dict)}

    print(f"共 {len(images)} 張待處理｜模型={args.model}｜Ollama={args.ollama_url}")
    if args.dry_run:
        print("【dry-run】只列出檔案，不呼叫模型、不寫檔。")
        for path in images:
            key = relative_file_key(path, photos_dir)
            print(f"  - {key}")
        return 0

    processed = 0
    skipped = 0

    for idx, path in enumerate(images, start=1):
        key = relative_file_key(path, photos_dir)

        # 續跑：已有紀錄且未指定 --force 則跳過
        if not args.force and key in by_file and by_file[key].get("bibs") is not None:
            print(f"[{idx}/{len(images)}] 跳過（已存在）：{key}")
            skipped += 1
            continue

        print(f"[{idx}/{len(images)}] 辨識中：{key} …", flush=True)
        try:
            raw = call_ollama_vision(
                image_path=path,
                ollama_url=args.ollama_url,
                model=args.model,
                timeout=args.timeout,
            )
            bibs = extract_bibs_from_text(raw)
            by_file[key] = {"file": key, "name": path.name, "bibs": bibs}
            processed += 1
            print(f"    → {bibs if bibs else '（未辨識到號碼）'}")
        except requests.RequestException as exc:
            print(f"    × 呼叫 Ollama 失敗：{exc}", file=sys.stderr)
            print("      請確認已執行 `ollama serve`，且模型已 pull。", file=sys.stderr)
            return 1
        except Exception as exc:  # noqa: BLE001 — 單張失敗不中斷整批
            print(f"    × 處理失敗，略過：{exc}", file=sys.stderr)
            by_file[key] = {"file": key, "name": path.name, "bibs": []}

        # 每張都寫一次，避免長時間中斷後全丟
        ordered = [by_file[relative_file_key(p, photos_dir)] for p in images if relative_file_key(p, photos_dir) in by_file]
        # 合併：保留不在本次 photos 清單內、但原本就有的紀錄（例如已搬到圖床的 URL）
        known_keys = {relative_file_key(p, photos_dir) for p in images}
        extras = [item for k, item in by_file.items() if k not in known_keys]
        save_index(output_path, ordered + extras)

        if args.sleep > 0:
            time.sleep(args.sleep)

    print(f"完成。新辨識 {processed} 張，跳過 {skipped} 張。輸出：{output_path.resolve()}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="本地批次辨識 photos/ 號碼布，產出 data.json（一對多）",
    )
    parser.add_argument(
        "--photos-dir",
        type=Path,
        default=DEFAULT_PHOTOS_DIR,
        help="照片資料夾路徑（預設 photos/）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="輸出 JSON 路徑（預設 data.json）",
    )
    parser.add_argument(
        "--ollama-url",
        default=DEFAULT_OLLAMA_URL,
        help="Ollama 服務位址（預設 http://127.0.0.1:11434）",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="視覺模型名稱（預設 llava；可改 qwen2.5vl 等）",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="單張請求逾時秒數",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="只處理前 N 張（0=全部）",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.0,
        help="每張間隔秒數，避免本機過熱",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="強制重跑已存在於 data.json 的檔案",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只列出將處理的檔案，不呼叫模型",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return process_photos(args)


if __name__ == "__main__":
    raise SystemExit(main())
