#!/usr/bin/env python3
"""Safe TourAPI collector scaffold for LocalTrip AI raw sample collection."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Mapping, Optional


DEFAULT_BASE_URL = "http://apis.data.go.kr/B551011/KorService2"
DEFAULT_OUTPUT_DIR = "/workspace-data/analysis/localtrip/03_api_sync/raw_samples"
DEFAULT_MOBILE_OS = "ETC"
DEFAULT_MOBILE_APP = "LocalTripAI"
DEFAULT_NUM_ROWS = 10


MOCK_ITEMS: Dict[str, Dict[str, Any]] = {
    "areaBasedList2": {
        "header": {"resultCode": "0000", "resultMsg": "OK"},
        "body": {
            "items": {
                "item": [
                    {
                        "addr1": "서울특별시 종로구 계동길 37",
                        "areacode": "1",
                        "cat1": "A02",
                        "cat2": "A0201",
                        "cat3": "A02010600",
                        "contentid": "3101001",
                        "contenttypeid": "12",
                        "mapx": "126.984936",
                        "mapy": "37.582604",
                        "sigungucode": "23",
                        "title": "북촌 한옥마을",
                    },
                    {
                        "addr1": "부산광역시 사하구 감내2로 203",
                        "areacode": "6",
                        "cat1": "A02",
                        "cat2": "A0203",
                        "cat3": "A02030400",
                        "contentid": "3102001",
                        "contenttypeid": "12",
                        "mapx": "129.010596",
                        "mapy": "35.097446",
                        "sigungucode": "3",
                        "title": "감천문화마을",
                    },
                ]
            },
            "numOfRows": 2,
            "pageNo": 1,
            "totalCount": 2,
        },
    },
    "searchKeyword2": {
        "header": {"resultCode": "0000", "resultMsg": "OK"},
        "body": {
            "items": {
                "item": [
                    {
                        "addr1": "제주특별자치도 서귀포시 성산읍 일출로 284-12",
                        "areacode": "39",
                        "contentid": "3103001",
                        "contenttypeid": "12",
                        "mapx": "126.940521",
                        "mapy": "33.458057",
                        "sigungucode": "3",
                        "title": "성산일출봉",
                    }
                ]
            },
            "numOfRows": 1,
            "pageNo": 1,
            "totalCount": 1,
        },
    },
    "detailCommon2": {
        "header": {"resultCode": "0000", "resultMsg": "OK"},
        "body": {
            "items": {
                "item": [
                    {
                        "addr1": "서울특별시 종로구 계동길 37",
                        "contentid": "3101001",
                        "contenttypeid": "12",
                        "homepage": "<a href=\"https://example.localtrip.ai/bukchon\">북촌 한옥마을</a>",
                        "overview": "LocalTrip offline mock detail record for parser development.",
                        "title": "북촌 한옥마을",
                    }
                ]
            },
            "numOfRows": 1,
            "pageNo": 1,
            "totalCount": 1,
        },
    },
}


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def compact_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def common_params(args: argparse.Namespace) -> Dict[str, str]:
    return {
        "MobileOS": args.mobile_os,
        "MobileApp": args.mobile_app,
        "_type": "json",
        "numOfRows": str(args.num_rows),
        "pageNo": str(args.page_no),
    }


def without_empty(params: Mapping[str, Optional[str]]) -> Dict[str, str]:
    return {key: value for key, value in params.items() if value not in (None, "")}


def build_url(base_url: str, endpoint: str, params: Mapping[str, str], service_key: str) -> str:
    query_params = dict(params)
    query_params["serviceKey"] = service_key
    encoded = urllib.parse.urlencode(query_params, doseq=True)
    return f"{base_url.rstrip('/')}/{endpoint}?{encoded}"


def safe_envelope(
    *,
    base_url: str,
    endpoint: str,
    params: Mapping[str, str],
    mode: str,
    response: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "collectedAtUtc": utc_stamp(),
        "mode": mode,
        "request": {
            "baseUrl": base_url,
            "endpoint": endpoint,
            "params": dict(params),
            "serviceKey": "REDACTED" if mode.startswith("live") else "NOT_USED",
        },
        "response": response,
        "containsSecrets": False,
    }


def read_json_response(url: str, timeout_seconds: int) -> Dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        data = response.read().decode("utf-8")
    return json.loads(data)


def write_json(output_dir: Path, filename: str, payload: Mapping[str, Any]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def collect(
    args: argparse.Namespace,
    *,
    endpoint: str,
    params: Mapping[str, str],
    filename_prefix: str,
) -> int:
    output_dir = Path(args.output_dir)
    service_key = os.environ.get("TOUR_API_SERVICE_KEY", "")
    has_key = bool(service_key.strip())
    use_mock = args.mock or args.dry_run or not has_key
    mode = "mock" if use_mock else "live"

    if use_mock:
        response = {"response": MOCK_ITEMS[endpoint]}
    else:
        url = build_url(args.base_url, endpoint, params, service_key)
        try:
            response = read_json_response(url, args.timeout_seconds)
        except urllib.error.HTTPError as exc:
            response = {
                "error": {
                    "type": "HTTPError",
                    "status": exc.code,
                    "reason": exc.reason,
                }
            }
            mode = "live-error"
        except urllib.error.URLError as exc:
            response = {
                "error": {
                    "type": "URLError",
                    "reason": str(exc.reason),
                }
            }
            mode = "live-error"
        except json.JSONDecodeError as exc:
            response = {
                "error": {
                    "type": "JSONDecodeError",
                    "message": str(exc),
                }
            }
            mode = "live-error"

    payload = safe_envelope(
        base_url=args.base_url,
        endpoint=endpoint,
        params=params,
        mode=mode,
        response=response,
    )
    output_path = write_json(output_dir, f"{filename_prefix}_{compact_timestamp()}.json", payload)

    if mode == "mock" and not has_key and not args.mock and not args.dry_run:
        print("TOUR_API_SERVICE_KEY is not set; wrote offline mock sample.")
    print(f"Wrote {mode} sample: {output_path}")
    return 2 if mode == "live-error" else 0


def command_area_based_list(args: argparse.Namespace) -> int:
    params = common_params(args)
    params.update(
        without_empty(
            {
                "contentTypeId": args.content_type_id,
                "areaCode": args.area_code,
                "sigunguCode": args.sigungu_code,
                "cat1": args.cat1,
                "cat2": args.cat2,
                "cat3": args.cat3,
                "arrange": args.arrange,
            }
        )
    )
    return collect(
        args,
        endpoint="areaBasedList2",
        params=params,
        filename_prefix="area_based_list2",
    )


def command_keyword_search(args: argparse.Namespace) -> int:
    params = common_params(args)
    params.update(
        without_empty(
            {
                "keyword": args.keyword,
                "contentTypeId": args.content_type_id,
                "areaCode": args.area_code,
                "sigunguCode": args.sigungu_code,
                "arrange": args.arrange,
            }
        )
    )
    return collect(
        args,
        endpoint="searchKeyword2",
        params=params,
        filename_prefix="search_keyword2",
    )


def command_detail_common(args: argparse.Namespace) -> int:
    params = common_params(args)
    params.update(
        without_empty(
            {
                "contentId": args.content_id,
                "contentTypeId": args.content_type_id,
                "defaultYN": args.default_yn,
                "firstImageYN": args.first_image_yn,
                "addrinfoYN": args.addrinfo_yn,
                "mapinfoYN": args.mapinfo_yn,
                "overviewYN": args.overview_yn,
            }
        )
    )
    return collect(
        args,
        endpoint="detailCommon2",
        params=params,
        filename_prefix="detail_common2",
    )


def command_mock_export(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir)
    examples = [
        (
            "area_based_list2_mock.json",
            "areaBasedList2",
            {
                "MobileOS": args.mobile_os,
                "MobileApp": args.mobile_app,
                "_type": "json",
                "numOfRows": "2",
                "pageNo": "1",
                "contentTypeId": "12",
                "areaCode": "1",
            },
        ),
        (
            "search_keyword2_mock.json",
            "searchKeyword2",
            {
                "MobileOS": args.mobile_os,
                "MobileApp": args.mobile_app,
                "_type": "json",
                "numOfRows": "1",
                "pageNo": "1",
                "keyword": "제주",
                "contentTypeId": "12",
            },
        ),
        (
            "detail_common2_mock.json",
            "detailCommon2",
            {
                "MobileOS": args.mobile_os,
                "MobileApp": args.mobile_app,
                "_type": "json",
                "numOfRows": "1",
                "pageNo": "1",
                "contentId": "3101001",
                "contentTypeId": "12",
                "defaultYN": "Y",
                "overviewYN": "Y",
            },
        ),
    ]

    written = []
    for filename, endpoint, params in examples:
        payload = safe_envelope(
            base_url=args.base_url,
            endpoint=endpoint,
            params=params,
            mode="mock-export",
            response={"response": MOCK_ITEMS[endpoint]},
        )
        written.append(write_json(output_dir, filename, payload))

    readme = output_dir / "README.collector_samples.md"
    readme.write_text(
        "# LocalTrip TourAPI Collector Samples\n\n"
        "These JSON files were generated by `scripts/localtrip_collect_tourapi.py mock-export`.\n"
        "They contain no service key and are suitable for offline parser demos.\n",
        encoding="utf-8",
    )
    written.append(readme)

    for path in written:
        print(f"Wrote mock sample: {path}")
    return 0


def add_common_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--base-url",
        default=os.environ.get("TOUR_API_BASE_URL", DEFAULT_BASE_URL),
        help=f"TourAPI base URL. Default: {DEFAULT_BASE_URL}",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for raw JSON output. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--mobile-os",
        default=os.environ.get("TOUR_API_MOBILE_OS", DEFAULT_MOBILE_OS),
        help=f"TourAPI MobileOS value. Default: {DEFAULT_MOBILE_OS}",
    )
    parser.add_argument(
        "--mobile-app",
        default=os.environ.get("TOUR_API_MOBILE_APP", DEFAULT_MOBILE_APP),
        help=f"TourAPI MobileApp value. Default: {DEFAULT_MOBILE_APP}",
    )
    parser.add_argument(
        "--num-rows",
        default=int(os.environ.get("TOUR_API_NUM_ROWS", DEFAULT_NUM_ROWS)),
        type=int,
        help=f"Rows to request. Default: {DEFAULT_NUM_ROWS}",
    )
    parser.add_argument("--page-no", default=1, type=int, help="TourAPI page number. Default: 1")
    parser.add_argument(
        "--timeout-seconds",
        default=15,
        type=int,
        help="HTTP timeout for live calls. Default: 15",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Force offline mock response even when TOUR_API_SERVICE_KEY is set.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not call TourAPI; write a mock response showing the planned request parameters.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Safe LocalTrip AI TourAPI collector scaffold. Reads TOUR_API_SERVICE_KEY "
            "for live calls, but never prints or writes the key. Without the env var it "
            "writes offline mock samples."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    area = subparsers.add_parser(
        "area-based-list",
        help="Collect or mock TourAPI areaBasedList2 raw JSON.",
        description="Collect areaBasedList2. Without TOUR_API_SERVICE_KEY, writes a mock sample.",
    )
    add_common_options(area)
    area.add_argument("--content-type-id", default="12", help="TourAPI contentTypeId. Default: 12")
    area.add_argument("--area-code", default="1", help="TourAPI areaCode. Default: 1")
    area.add_argument("--sigungu-code", help="Optional TourAPI sigunguCode.")
    area.add_argument("--cat1", help="Optional TourAPI cat1.")
    area.add_argument("--cat2", help="Optional TourAPI cat2.")
    area.add_argument("--cat3", help="Optional TourAPI cat3.")
    area.add_argument("--arrange", default="A", help="TourAPI arrange. Default: A")
    area.set_defaults(func=command_area_based_list)

    keyword = subparsers.add_parser(
        "keyword-search",
        help="Collect or mock TourAPI searchKeyword2 raw JSON.",
        description="Collect searchKeyword2. Without TOUR_API_SERVICE_KEY, writes a mock sample.",
    )
    add_common_options(keyword)
    keyword.add_argument("--keyword", default="제주", help="Search keyword. Default: 제주")
    keyword.add_argument("--content-type-id", default="12", help="TourAPI contentTypeId. Default: 12")
    keyword.add_argument("--area-code", help="Optional TourAPI areaCode.")
    keyword.add_argument("--sigungu-code", help="Optional TourAPI sigunguCode.")
    keyword.add_argument("--arrange", default="A", help="TourAPI arrange. Default: A")
    keyword.set_defaults(func=command_keyword_search)

    detail = subparsers.add_parser(
        "detail-common",
        help="Collect or mock TourAPI detailCommon2 raw JSON.",
        description="Collect detailCommon2. Without TOUR_API_SERVICE_KEY, writes a mock sample.",
    )
    add_common_options(detail)
    detail.add_argument("--content-id", default="3101001", help="TourAPI contentId. Default: 3101001")
    detail.add_argument("--content-type-id", default="12", help="TourAPI contentTypeId. Default: 12")
    detail.add_argument("--default-yn", default="Y", choices=["Y", "N"], help="Include defaults. Default: Y")
    detail.add_argument("--first-image-yn", default="Y", choices=["Y", "N"], help="Include images. Default: Y")
    detail.add_argument("--addrinfo-yn", default="Y", choices=["Y", "N"], help="Include address info. Default: Y")
    detail.add_argument("--mapinfo-yn", default="Y", choices=["Y", "N"], help="Include map info. Default: Y")
    detail.add_argument("--overview-yn", default="Y", choices=["Y", "N"], help="Include overview. Default: Y")
    detail.set_defaults(func=command_detail_common)

    mock_export = subparsers.add_parser(
        "mock-export",
        help="Write deterministic offline sample files for all supported commands.",
        description="Export deterministic mock area, keyword, and detail samples with no network or key required.",
    )
    add_common_options(mock_export)
    mock_export.set_defaults(func=command_mock_export)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
