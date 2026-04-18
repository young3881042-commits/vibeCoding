#!/usr/bin/env python3
"""Collect files under an admin1 directory and publish JSON snapshots to Kafka.

The script is intentionally dependency-light:
- It prefers ``confluent_kafka`` if available.
- It falls back to ``kafka-python`` if available.
- It can emit JSON lines to stdout when Kafka libraries are unavailable.

Default behavior is driven by environment variables so it can run cleanly
in Kubernetes jobs, local shells, or CI.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import mimetypes
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Sequence


DEFAULT_SOURCE_DIR = os.getenv("ADMIN1_SOURCE_DIR", "/workspace-data/users/admin1")
DEFAULT_TOPIC = os.getenv("KAFKA_TOPIC", "admin1.directory.snapshots")
DEFAULT_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
DEFAULT_CLIENT_ID = os.getenv("KAFKA_CLIENT_ID", "admin1-directory-collector")
DEFAULT_BACKEND = os.getenv("KAFKA_BACKEND", "auto")
DEFAULT_MAX_CONTENT_BYTES = int(os.getenv("ADMIN1_MAX_CONTENT_BYTES", "16384"))
DEFAULT_INCLUDE_HIDDEN = os.getenv("ADMIN1_INCLUDE_HIDDEN", "").lower() in {"1", "true", "yes"}
DEFAULT_INCLUDE_BINARY = os.getenv("ADMIN1_INCLUDE_BINARY", "").lower() in {"1", "true", "yes"}

DEFAULT_EXCLUDES = (
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "node_modules",
    "dist",
    "build",
    ".DS_Store",
)

TEXT_EXTENSIONS = {
    "txt",
    "md",
    "csv",
    "json",
    "log",
    "yaml",
    "yml",
    "py",
    "java",
    "js",
    "jsx",
    "ts",
    "tsx",
    "sh",
    "sql",
    "xml",
    "html",
    "css",
    "properties",
    "toml",
    "ini",
    "env",
}


@dataclass(frozen=True)
class FileRecord:
    relative_path: str
    directory: str
    name: str
    size_bytes: int
    modified_at: str
    sha256: str
    content_type: str
    content: str | None
    content_truncated: bool
    content_included: bool


class KafkaSink:
    def send(self, topic: str, key: str, payload: dict) -> None:
        raise NotImplementedError

    def close(self) -> None:
        pass


class StdoutSink(KafkaSink):
    def send(self, topic: str, key: str, payload: dict) -> None:
        print(json.dumps({"topic": topic, "key": key, "payload": payload}, ensure_ascii=False))


class KafkaPythonSink(KafkaSink):
    def __init__(self, producer, async_mode: bool):
        self.producer = producer
        self.async_mode = async_mode

    def send(self, topic: str, key: str, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if self.async_mode:
            self.producer.send(topic, key=key.encode("utf-8"), value=data)
            return
        self.producer.send(topic, key=key.encode("utf-8"), value=data)
        self.producer.flush()

    def close(self) -> None:
        self.producer.flush()


class ConfluentSink(KafkaSink):
    def __init__(self, producer):
        self.producer = producer

    def send(self, topic: str, key: str, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.producer.produce(topic, key=key.encode("utf-8"), value=data)

    def close(self) -> None:
        self.producer.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Walk an admin1 directory, build JSON snapshots, and publish them to Kafka."
    )
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR, help="Directory to scan.")
    parser.add_argument("--topic", default=DEFAULT_TOPIC, help="Kafka topic for file snapshot events.")
    parser.add_argument(
        "--bootstrap-servers",
        default=DEFAULT_BOOTSTRAP_SERVERS,
        help="Kafka bootstrap servers, comma-separated.",
    )
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="Kafka client id.")
    parser.add_argument(
        "--backend",
        choices=("auto", "confluent", "kafka-python", "stdout"),
        default=DEFAULT_BACKEND,
        help="Kafka backend selection.",
    )
    parser.add_argument(
        "--max-content-bytes",
        type=int,
        default=DEFAULT_MAX_CONTENT_BYTES,
        help="Maximum bytes to inline from a text file.",
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        default=DEFAULT_INCLUDE_HIDDEN,
        help="Include hidden files and directories.",
    )
    parser.add_argument(
        "--include-binary",
        action="store_true",
        default=DEFAULT_INCLUDE_BINARY,
        help="Attempt to include binary files as base64 content.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Glob pattern to exclude. May be supplied multiple times.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print JSON events to stdout instead of sending them.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional maximum number of files to send. Zero means unlimited.",
    )
    parser.add_argument(
        "--send-summary",
        action="store_true",
        help="Emit a directory summary event before each directory's file events.",
    )
    return parser.parse_args()


def load_sink(args: argparse.Namespace) -> KafkaSink:
    if args.dry_run or args.backend == "stdout":
        return StdoutSink()

    if args.backend in {"auto", "confluent"}:
        try:
            from confluent_kafka import Producer  # type: ignore

            producer = Producer(
                {
                    "bootstrap.servers": args.bootstrap_servers,
                    "client.id": args.client_id,
                }
            )
            return ConfluentSink(producer)
        except Exception:
            if args.backend == "confluent":
                raise

    if args.backend in {"auto", "kafka-python"}:
        try:
            from kafka import KafkaProducer  # type: ignore

            producer = KafkaProducer(
                bootstrap_servers=args.bootstrap_servers.split(","),
                client_id=args.client_id,
                value_serializer=lambda value: value,
                key_serializer=lambda value: value,
                retries=3,
            )
            return KafkaPythonSink(producer, async_mode=True)
        except Exception:
            if args.backend == "kafka-python":
                raise

    return StdoutSink()


def is_hidden(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts)


def should_skip(path: Path, patterns: Sequence[str]) -> bool:
    name = path.name
    for pattern in patterns:
        if fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(str(path).replace(os.sep, "/"), pattern):
            return True
    return False


def iter_files(root: Path, include_hidden: bool, excludes: Sequence[str]) -> Iterator[Path]:
    for current_root, dirs, files in os.walk(root):
        current_path = Path(current_root)
        dirs[:] = sorted(
            d for d in dirs
            if (include_hidden or not d.startswith("."))
            and not should_skip(current_path / d, excludes)
        )
        for filename in sorted(files):
            candidate = current_path / filename
            if not include_hidden and is_hidden(candidate.relative_to(root)):
                continue
            if should_skip(candidate, excludes):
                continue
            yield candidate


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def looks_textual(path: Path) -> bool:
    suffix = path.suffix.lower().lstrip(".")
    if suffix in TEXT_EXTENSIONS:
        return True
    content_type, _ = mimetypes.guess_type(path.name)
    return bool(content_type and content_type.startswith("text/"))


def read_content(path: Path, max_content_bytes: int, include_binary: bool) -> tuple[str | None, bool, bool]:
    size = path.stat().st_size
    if size > max_content_bytes and not include_binary:
        return None, True, False

    if looks_textual(path):
        with path.open("r", encoding="utf-8", errors="replace") as stream:
            content = stream.read(max_content_bytes)
        truncated = size > max_content_bytes
        return content, truncated, True

    if include_binary:
        import base64

        with path.open("rb") as stream:
            raw = stream.read(max_content_bytes)
        truncated = size > max_content_bytes
        return base64.b64encode(raw).decode("ascii"), truncated, True

    return None, size > max_content_bytes, False


def to_record(root: Path, path: Path, max_content_bytes: int, include_binary: bool) -> FileRecord:
    stat = path.stat()
    content, truncated, included = read_content(path, max_content_bytes, include_binary)
    content_type, _ = mimetypes.guess_type(path.name)
    return FileRecord(
        relative_path=path.relative_to(root).as_posix(),
        directory=path.relative_to(root).parent.as_posix() if path.relative_to(root).parent != Path(".") else "",
        name=path.name,
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        sha256=sha256_of(path),
        content_type=content_type or "application/octet-stream",
        content=content,
        content_truncated=truncated,
        content_included=included,
    )


def build_payload(root: Path, record: FileRecord, event_type: str) -> dict:
    return {
        "schema_version": 1,
        "event_type": event_type,
        "source_root": root.as_posix(),
        "collected_at": datetime.now(tz=timezone.utc).isoformat(),
        "file": {
            "relative_path": record.relative_path,
            "directory": record.directory,
            "name": record.name,
            "size_bytes": record.size_bytes,
            "modified_at": record.modified_at,
            "sha256": record.sha256,
            "content_type": record.content_type,
            "content": record.content,
            "content_truncated": record.content_truncated,
            "content_included": record.content_included,
        },
    }


def emit_directory_summary(sink: KafkaSink, topic: str, root: Path, directory: str, records: list[FileRecord]) -> None:
    payload = {
        "schema_version": 1,
        "event_type": "directory_snapshot",
        "source_root": root.as_posix(),
        "collected_at": datetime.now(tz=timezone.utc).isoformat(),
        "directory": directory,
        "file_count": len(records),
        "files": [
            {
                "relative_path": record.relative_path,
                "name": record.name,
                "size_bytes": record.size_bytes,
                "sha256": record.sha256,
            }
            for record in records
        ],
    }
    key = directory or root.name
    sink.send(topic, key, payload)


def main() -> int:
    args = parse_args()
    root = Path(args.source_dir).expanduser().resolve()
    if not root.exists():
        print(f"source directory does not exist: {root}", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"source path is not a directory: {root}", file=sys.stderr)
        return 2

    excludes = tuple(DEFAULT_EXCLUDES) + tuple(args.exclude or ())
    sink = load_sink(args)

    file_count = 0
    directory_buckets: dict[str, list[FileRecord]] = {}
    try:
        for path in iter_files(root, args.include_hidden, excludes):
            if args.limit and file_count >= args.limit:
                break
            record = to_record(root, path, args.max_content_bytes, args.include_binary)
            directory_key = record.directory
            directory_buckets.setdefault(directory_key, []).append(record)
            payload = build_payload(root, record, "file_snapshot")
            sink.send(args.topic, record.relative_path, payload)
            file_count += 1

        if args.send_summary:
            for directory in sorted(directory_buckets):
                emit_directory_summary(sink, args.topic, root, directory, directory_buckets[directory])

        summary = {
            "schema_version": 1,
            "event_type": "collection_summary",
            "source_root": root.as_posix(),
            "collected_at": datetime.now(tz=timezone.utc).isoformat(),
            "file_count": file_count,
            "topic": args.topic,
        }
        sink.send(args.topic, root.name or "admin1", summary)
    finally:
        sink.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
