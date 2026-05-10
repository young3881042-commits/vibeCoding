#!/usr/bin/env bash
set -euo pipefail

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
NAMESPACE="${KUBE_NAMESPACE:-jupiter}"
POD_SELECTOR="${POD_SELECTOR:-app=jupiter-cli}"
TARGET_ROOT="${LOCALTRIP_TARGET_ROOT:-/workspace-data/analysis/localtrip}"

TMP_DIR="$(mktemp -d)"
STAGE_DIR="$TMP_DIR/localtrip"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

write_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat >"$path"
}

stage_files() {
  mkdir -p \
    "$STAGE_DIR/01_destinations" \
    "$STAGE_DIR/02_events_courses" \
    "$STAGE_DIR/03_api_sync/logs" \
    "$STAGE_DIR/03_api_sync/raw_samples" \
    "$STAGE_DIR/04_rag/regions/seoul/food/solo" \
    "$STAGE_DIR/04_rag/regions/seoul/food/couple" \
    "$STAGE_DIR/04_rag/regions/seoul/food/male" \
    "$STAGE_DIR/04_rag/regions/seoul/food/female" \
    "$STAGE_DIR/04_rag/regions/seoul/food/family" \
    "$STAGE_DIR/04_rag/regions/seoul/attractions/solo" \
    "$STAGE_DIR/04_rag/regions/seoul/attractions/couple" \
    "$STAGE_DIR/04_rag/regions/seoul/attractions/male" \
    "$STAGE_DIR/04_rag/regions/seoul/attractions/female" \
    "$STAGE_DIR/04_rag/regions/seoul/attractions/family" \
    "$STAGE_DIR/04_rag/regions/seoul/activities/solo" \
    "$STAGE_DIR/04_rag/regions/seoul/activities/couple" \
    "$STAGE_DIR/04_rag/regions/seoul/activities/male" \
    "$STAGE_DIR/04_rag/regions/seoul/activities/female" \
    "$STAGE_DIR/04_rag/regions/seoul/activities/family" \
    "$STAGE_DIR/04_rag/regions/gyeongju/food/solo" \
    "$STAGE_DIR/04_rag/regions/gyeongju/food/couple" \
    "$STAGE_DIR/04_rag/regions/gyeongju/food/male" \
    "$STAGE_DIR/04_rag/regions/gyeongju/food/female" \
    "$STAGE_DIR/04_rag/regions/gyeongju/food/family" \
    "$STAGE_DIR/04_rag/regions/gyeongju/attractions/solo" \
    "$STAGE_DIR/04_rag/regions/gyeongju/attractions/couple" \
    "$STAGE_DIR/04_rag/regions/gyeongju/attractions/male" \
    "$STAGE_DIR/04_rag/regions/gyeongju/attractions/female" \
    "$STAGE_DIR/04_rag/regions/gyeongju/attractions/family" \
    "$STAGE_DIR/04_rag/regions/gyeongju/activities/solo" \
    "$STAGE_DIR/04_rag/regions/gyeongju/activities/couple" \
    "$STAGE_DIR/04_rag/regions/gyeongju/activities/male" \
    "$STAGE_DIR/04_rag/regions/gyeongju/activities/female" \
    "$STAGE_DIR/04_rag/regions/gyeongju/activities/family" \
    "$STAGE_DIR/04_rag/regions/busan/food/solo" \
    "$STAGE_DIR/04_rag/regions/busan/food/couple" \
    "$STAGE_DIR/04_rag/regions/busan/food/male" \
    "$STAGE_DIR/04_rag/regions/busan/food/female" \
    "$STAGE_DIR/04_rag/regions/busan/food/family" \
    "$STAGE_DIR/04_rag/regions/busan/attractions/solo" \
    "$STAGE_DIR/04_rag/regions/busan/attractions/couple" \
    "$STAGE_DIR/04_rag/regions/busan/attractions/male" \
    "$STAGE_DIR/04_rag/regions/busan/attractions/female" \
    "$STAGE_DIR/04_rag/regions/busan/attractions/family" \
    "$STAGE_DIR/04_rag/regions/busan/activities/solo" \
    "$STAGE_DIR/04_rag/regions/busan/activities/couple" \
    "$STAGE_DIR/04_rag/regions/busan/activities/male" \
    "$STAGE_DIR/04_rag/regions/busan/activities/female" \
    "$STAGE_DIR/04_rag/regions/busan/activities/family" \
    "$STAGE_DIR/04_rag/regions/jeju/food/solo" \
    "$STAGE_DIR/04_rag/regions/jeju/food/couple" \
    "$STAGE_DIR/04_rag/regions/jeju/food/male" \
    "$STAGE_DIR/04_rag/regions/jeju/food/female" \
    "$STAGE_DIR/04_rag/regions/jeju/food/family" \
    "$STAGE_DIR/04_rag/regions/jeju/attractions/solo" \
    "$STAGE_DIR/04_rag/regions/jeju/attractions/couple" \
    "$STAGE_DIR/04_rag/regions/jeju/attractions/male" \
    "$STAGE_DIR/04_rag/regions/jeju/attractions/female" \
    "$STAGE_DIR/04_rag/regions/jeju/attractions/family" \
    "$STAGE_DIR/04_rag/regions/jeju/activities/solo" \
    "$STAGE_DIR/04_rag/regions/jeju/activities/couple" \
    "$STAGE_DIR/04_rag/regions/jeju/activities/male" \
    "$STAGE_DIR/04_rag/regions/jeju/activities/female" \
    "$STAGE_DIR/04_rag/regions/jeju/activities/family" \
    "$STAGE_DIR/05_account_profile_templates" \
    "$STAGE_DIR/config"

  write_file "$STAGE_DIR/README.md" <<'EOF'
# LocalTrip AI Data Collection Workspace

This directory is the shared analysis-volume workspace for LocalTrip AI collection work. It is intentionally seeded with mock TourAPI-style data so the team can build parsers, notebooks, and validation checks without external API keys.

## Directory Roles

- `01_destinations/`: destination seed data and TourAPI `areaBasedList2`-style samples.
- `02_events_courses/`: event and course seed data split from destination work.
- `03_api_sync/`: raw API response samples plus mock sync logs for ingestion testing.
- `04_rag/`: region and sector based RAG corpus scaffold. Persona folders are routing hints; store shared facts once and keep metadata precise.
- `05_account_profile_templates/`: account-level preference templates for personalized planning.
- `config/`: templates for real TourAPI collection. Do not commit real keys.

## Collection Flow

1. Destination collector refreshes `01_destinations` from TourAPI destination endpoints such as `areaBasedList2` and `detailCommon2`.
2. Events/courses collector refreshes `02_events_courses` from festival, event, and course endpoints such as `searchFestival2` and content type `25` course listings.
3. API sync owner writes raw responses under `03_api_sync/raw_samples/YYYYMMDD/` before normalization, then records each run in `03_api_sync/logs`.
4. Notebook or batch jobs consume the normalized CSV/JSON seeds first, then compare against raw samples and sync logs.

The checked-in initializer is safe to rerun. It refreshes these sample files but does not create or overwrite a real secret-bearing `.env.local`.
EOF

  write_file "$STAGE_DIR/04_rag/README.md" <<'EOF'
# LocalTrip RAG Corpus Layout

Use this directory as the shared travel knowledge corpus.

Recommended routing:

- Region first: `regions/{seoul|gyeongju|busan|jeju}`
- Sector second: `{food|attractions|activities}`
- Persona third: `{solo|couple|male|female|family}`

Do not duplicate the same place description across every persona folder. Keep canonical place facts in the best matching region/sector, then add persona-specific notes only when the recommendation logic truly differs.

Each RAG document should include front matter or a sibling metadata JSON with:

- `region`
- `sector`
- `persona`
- `source`
- `source_url`
- `content_id`
- `tags`
- `updated_at`
- `confidence`

User customization should not be stored here. Put user preference and click/save history in the account folder top level, for example `/workspace/users/{username}/localtrip/preferences.json`.
EOF

  write_file "$STAGE_DIR/04_rag/rag_taxonomy.json" <<'EOF'
{
  "regions": ["seoul", "gyeongju", "busan", "jeju"],
  "sectors": ["food", "attractions", "activities"],
  "personas": ["solo", "couple", "male", "female", "family"],
  "metadataFields": [
    "region",
    "sector",
    "persona",
    "source",
    "source_url",
    "content_id",
    "tags",
    "updated_at",
    "confidence"
  ],
  "personalizationRule": "Shared corpus stays in 04_rag. User-specific preferences stay under /workspace/users/{username}/localtrip/."
}
EOF

  write_file "$STAGE_DIR/04_rag/regions/gyeongju/attractions/couple/gyeongju-night-history.seed.md" <<'EOF'
---
region: gyeongju
sector: attractions
persona: couple
source: localtrip-mock
source_url: ""
content_id: GYEONGJU-002
tags: ["history", "night-view", "photo", "walkable"]
updated_at: "2026-05-10"
confidence: seed
---

# Gyeongju Night History Route

Donggung and Wolji works well as a late-evening anchor for couples who want a slower photo-focused route. Pair it with Cheomseongdae and Hwangnidan-gil when the user asks for history, cafes, or night scenery without a packed schedule.
EOF

  write_file "$STAGE_DIR/04_rag/regions/gyeongju/food/family/gyeongju-family-food.seed.md" <<'EOF'
---
region: gyeongju
sector: food
persona: family
source: localtrip-mock
source_url: ""
content_id: GYEONGJU-005
tags: ["local-food", "family", "short-walk", "traditional"]
updated_at: "2026-05-10"
confidence: seed
---

# Gyeongju Family Food Notes

Gyochon Village is a practical food stop for family trips because it connects traditional streets, light snacks, and short walks. Use it as a flexible lunch slot near Cheomseongdae or Woljeonggyo.
EOF

  write_file "$STAGE_DIR/04_rag/regions/jeju/activities/solo/jeju-solo-nature.seed.md" <<'EOF'
---
region: jeju
sector: activities
persona: solo
source: localtrip-mock
source_url: ""
content_id: JEJU-003
tags: ["nature", "solo", "slow-travel", "morning"]
updated_at: "2026-05-10"
confidence: seed
---

# Jeju Solo Nature Notes

For solo travelers, keep Jeju nature routes less dense and leave buffer time for weather changes. Prefer one major outdoor stop per half day, then add nearby cafes or markets as optional slots.
EOF

  write_file "$STAGE_DIR/05_account_profile_templates/preferences.schema.json" <<'EOF'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "LocalTrip account preference profile",
  "type": "object",
  "required": ["version", "preferredRegions", "preferredSectors", "persona", "pace", "avoidTags", "likedTags"],
  "properties": {
    "version": {"type": "integer"},
    "preferredRegions": {"type": "array", "items": {"type": "string"}},
    "preferredSectors": {"type": "array", "items": {"enum": ["food", "attractions", "activities"]}},
    "persona": {"enum": ["solo", "couple", "male", "female", "family", "custom"]},
    "pace": {"enum": ["slow", "normal", "dense"]},
    "budgetLevel": {"enum": ["LOW", "NORMAL", "HIGH"]},
    "transportType": {"enum": ["PUBLIC_TRANSPORT", "CAR", "WALKING", "MIXED"]},
    "avoidTags": {"type": "array", "items": {"type": "string"}},
    "likedTags": {"type": "array", "items": {"type": "string"}},
    "memo": {"type": "string"}
  }
}
EOF

  write_file "$STAGE_DIR/05_account_profile_templates/preferences.sample.json" <<'EOF'
{
  "version": 1,
  "preferredRegions": ["gyeongju", "jeju"],
  "preferredSectors": ["food", "attractions"],
  "persona": "couple",
  "pace": "normal",
  "budgetLevel": "NORMAL",
  "transportType": "PUBLIC_TRANSPORT",
  "avoidTags": ["too-crowded", "long-stairs"],
  "likedTags": ["history", "night-view", "local-food", "photo"],
  "memo": "Night scenery and local food matter more than checking every famous place."
}
EOF

  write_file "$STAGE_DIR/05_account_profile_templates/history.sample.jsonl" <<'EOF'
{"ts":"2026-05-10T00:00:00Z","event":"plan_generated","region":"gyeongju","persona":"couple","likedTags":["history","night-view"],"saved":true}
{"ts":"2026-05-10T00:10:00Z","event":"destination_saved","contentId":"GYEONGJU-002","tags":["history","photo"]}
EOF

  write_file "$STAGE_DIR/01_destinations/destinations_seed.csv" <<'EOF'
localtrip_id,content_id,content_type_id,title,area_code,sigungu_code,addr1,map_x,map_y,category,source,collection_role
lt-dest-seoul-001,3101001,12,북촌 한옥마을,1,23,서울특별시 종로구 계동길 37,126.984936,37.582604,heritage,TourAPI mock,destinations
lt-dest-busan-001,3102001,12,감천문화마을,6,3,부산광역시 사하구 감내2로 203,129.010596,35.097446,culture,TourAPI mock,destinations
lt-dest-jeju-001,3103001,12,성산일출봉,39,3,제주특별자치도 서귀포시 성산읍 일출로 284-12,126.940521,33.458057,nature,TourAPI mock,destinations
EOF

  write_file "$STAGE_DIR/01_destinations/destinations_seed.json" <<'EOF'
[
  {
    "localtripId": "lt-dest-seoul-001",
    "contentid": "3101001",
    "contenttypeid": "12",
    "title": "북촌 한옥마을",
    "addr1": "서울특별시 종로구 계동길 37",
    "areacode": "1",
    "sigungucode": "23",
    "mapx": "126.984936",
    "mapy": "37.582604",
    "tags": ["heritage", "walkable", "photo_spot"],
    "collectorRole": "destinations"
  },
  {
    "localtripId": "lt-dest-busan-001",
    "contentid": "3102001",
    "contenttypeid": "12",
    "title": "감천문화마을",
    "addr1": "부산광역시 사하구 감내2로 203",
    "areacode": "6",
    "sigungucode": "3",
    "mapx": "129.010596",
    "mapy": "35.097446",
    "tags": ["culture", "village", "viewpoint"],
    "collectorRole": "destinations"
  },
  {
    "localtripId": "lt-dest-jeju-001",
    "contentid": "3103001",
    "contenttypeid": "12",
    "title": "성산일출봉",
    "addr1": "제주특별자치도 서귀포시 성산읍 일출로 284-12",
    "areacode": "39",
    "sigungucode": "3",
    "mapx": "126.940521",
    "mapy": "33.458057",
    "tags": ["nature", "unesco", "sunrise"],
    "collectorRole": "destinations"
  }
]
EOF

  write_file "$STAGE_DIR/01_destinations/tourapi_area_based_list_sample.json" <<'EOF'
{
  "response": {
    "header": {
      "resultCode": "0000",
      "resultMsg": "OK"
    },
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
            "firstimage": "https://example.localtrip.ai/images/bukchon.jpg",
            "mapx": "126.984936",
            "mapy": "37.582604",
            "sigungucode": "23",
            "title": "북촌 한옥마을"
          },
          {
            "addr1": "부산광역시 사하구 감내2로 203",
            "areacode": "6",
            "cat1": "A02",
            "cat2": "A0203",
            "cat3": "A02030400",
            "contentid": "3102001",
            "contenttypeid": "12",
            "firstimage": "https://example.localtrip.ai/images/gamcheon.jpg",
            "mapx": "129.010596",
            "mapy": "35.097446",
            "sigungucode": "3",
            "title": "감천문화마을"
          }
        ]
      },
      "numOfRows": 2,
      "pageNo": 1,
      "totalCount": 2
    }
  }
}
EOF

  write_file "$STAGE_DIR/02_events_courses/events_seed.csv" <<'EOF'
localtrip_id,content_id,content_type_id,title,event_start_date,event_end_date,area_code,sigungu_code,addr1,map_x,map_y,source,collection_role
lt-event-seoul-001,4101001,15,서울 야간도보 축제,20260612,20260614,1,23,서울특별시 종로구 세종대로 172,126.976883,37.575921,TourAPI mock,events_courses
lt-event-busan-001,4102001,15,부산 바다 미식 주간,20260703,20260712,6,7,부산광역시 해운대구 우동,129.158862,35.158698,TourAPI mock,events_courses
lt-event-jeju-001,4103001,15,제주 오름 트레일 데이,20260905,20260906,39,4,제주특별자치도 제주시 조천읍,126.669972,33.506846,TourAPI mock,events_courses
EOF

  write_file "$STAGE_DIR/02_events_courses/courses_seed.json" <<'EOF'
[
  {
    "localtripId": "lt-course-seoul-001",
    "contentid": "5101001",
    "contenttypeid": "25",
    "title": "서울 역사 산책 반나절 코스",
    "areaCode": "1",
    "durationHours": 4,
    "stops": [
      {"order": 1, "contentid": "3101001", "title": "북촌 한옥마을"},
      {"order": 2, "contentid": "3101002", "title": "창덕궁"},
      {"order": 3, "contentid": "3101003", "title": "인사동"}
    ],
    "collectorRole": "events_courses"
  },
  {
    "localtripId": "lt-course-jeju-001",
    "contentid": "5103001",
    "contenttypeid": "25",
    "title": "제주 동쪽 자연 코스",
    "areaCode": "39",
    "durationHours": 7,
    "stops": [
      {"order": 1, "contentid": "3103001", "title": "성산일출봉"},
      {"order": 2, "contentid": "3103002", "title": "섭지코지"},
      {"order": 3, "contentid": "3103003", "title": "비자림"}
    ],
    "collectorRole": "events_courses"
  }
]
EOF

  write_file "$STAGE_DIR/02_events_courses/tourapi_search_festival_sample.json" <<'EOF'
{
  "response": {
    "header": {
      "resultCode": "0000",
      "resultMsg": "OK"
    },
    "body": {
      "items": {
        "item": [
          {
            "addr1": "서울특별시 종로구 세종대로 172",
            "areacode": "1",
            "contentid": "4101001",
            "contenttypeid": "15",
            "eventstartdate": "20260612",
            "eventenddate": "20260614",
            "mapx": "126.976883",
            "mapy": "37.575921",
            "sigungucode": "23",
            "title": "서울 야간도보 축제"
          },
          {
            "addr1": "부산광역시 해운대구 우동",
            "areacode": "6",
            "contentid": "4102001",
            "contenttypeid": "15",
            "eventstartdate": "20260703",
            "eventenddate": "20260712",
            "mapx": "129.158862",
            "mapy": "35.158698",
            "sigungucode": "7",
            "title": "부산 바다 미식 주간"
          }
        ]
      },
      "numOfRows": 2,
      "pageNo": 1,
      "totalCount": 2
    }
  }
}
EOF

  write_file "$STAGE_DIR/03_api_sync/logs/tourapi_sync_log_seed.csv" <<'EOF'
run_id,started_at_utc,finished_at_utc,endpoint,role,status,page_no,num_rows,total_count,raw_sample_path,notes
mock-20260510-dest-001,2026-05-10T00:00:00Z,2026-05-10T00:00:03Z,areaBasedList2,destinations,success,1,2,2,03_api_sync/raw_samples/area_based_list2_page1.sample.json,seed mock run
mock-20260510-event-001,2026-05-10T00:05:00Z,2026-05-10T00:05:02Z,searchFestival2,events_courses,success,1,2,2,03_api_sync/raw_samples/search_festival2_page1.sample.json,seed mock run
mock-20260510-course-001,2026-05-10T00:10:00Z,2026-05-10T00:10:02Z,areaBasedList2,events_courses,success,1,2,2,03_api_sync/raw_samples/course_area_based_list2_page1.sample.json,contentTypeId 25 seed mock run
EOF

  write_file "$STAGE_DIR/03_api_sync/logs/tourapi_sync_summary_seed.json" <<'EOF'
{
  "workspace": "LocalTrip AI",
  "generatedBy": "scripts/localtrip_init_analysis_volume.sh",
  "mockRunDate": "2026-05-10",
  "endpoints": [
    {
      "endpoint": "areaBasedList2",
      "role": "destinations",
      "records": 2,
      "status": "success"
    },
    {
      "endpoint": "searchFestival2",
      "role": "events_courses",
      "records": 2,
      "status": "success"
    },
    {
      "endpoint": "areaBasedList2",
      "role": "events_courses",
      "contentTypeId": "25",
      "records": 2,
      "status": "success"
    }
  ],
  "containsSecrets": false
}
EOF

  write_file "$STAGE_DIR/03_api_sync/raw_samples/area_based_list2_page1.sample.json" <<'EOF'
{
  "request": {
    "baseUrl": "https://apis.data.go.kr/B551011/KorService2",
    "endpoint": "areaBasedList2",
    "params": {
      "MobileOS": "ETC",
      "MobileApp": "LocalTripAI",
      "_type": "json",
      "numOfRows": 2,
      "pageNo": 1,
      "contentTypeId": 12,
      "areaCode": 1
    },
    "serviceKey": "REDACTED"
  },
  "response": {
    "header": {"resultCode": "0000", "resultMsg": "OK"},
    "body": {
      "items": {
        "item": [
          {"contentid": "3101001", "contenttypeid": "12", "title": "북촌 한옥마을", "areacode": "1"},
          {"contentid": "3101002", "contenttypeid": "12", "title": "창덕궁", "areacode": "1"}
        ]
      },
      "numOfRows": 2,
      "pageNo": 1,
      "totalCount": 2
    }
  }
}
EOF

  write_file "$STAGE_DIR/03_api_sync/raw_samples/search_festival2_page1.sample.json" <<'EOF'
{
  "request": {
    "baseUrl": "https://apis.data.go.kr/B551011/KorService2",
    "endpoint": "searchFestival2",
    "params": {
      "MobileOS": "ETC",
      "MobileApp": "LocalTripAI",
      "_type": "json",
      "numOfRows": 2,
      "pageNo": 1,
      "eventStartDate": "20260601"
    },
    "serviceKey": "REDACTED"
  },
  "response": {
    "header": {"resultCode": "0000", "resultMsg": "OK"},
    "body": {
      "items": {
        "item": [
          {"contentid": "4101001", "contenttypeid": "15", "title": "서울 야간도보 축제", "eventstartdate": "20260612"},
          {"contentid": "4102001", "contenttypeid": "15", "title": "부산 바다 미식 주간", "eventstartdate": "20260703"}
        ]
      },
      "numOfRows": 2,
      "pageNo": 1,
      "totalCount": 2
    }
  }
}
EOF

  write_file "$STAGE_DIR/03_api_sync/raw_samples/course_area_based_list2_page1.sample.json" <<'EOF'
{
  "request": {
    "baseUrl": "https://apis.data.go.kr/B551011/KorService2",
    "endpoint": "areaBasedList2",
    "params": {
      "MobileOS": "ETC",
      "MobileApp": "LocalTripAI",
      "_type": "json",
      "numOfRows": 2,
      "pageNo": 1,
      "contentTypeId": 25
    },
    "serviceKey": "REDACTED"
  },
  "response": {
    "header": {"resultCode": "0000", "resultMsg": "OK"},
    "body": {
      "items": {
        "item": [
          {"contentid": "5101001", "contenttypeid": "25", "title": "서울 역사 산책 반나절 코스", "areacode": "1"},
          {"contentid": "5103001", "contenttypeid": "25", "title": "제주 동쪽 자연 코스", "areacode": "39"}
        ]
      },
      "numOfRows": 2,
      "pageNo": 1,
      "totalCount": 2
    }
  }
}
EOF

  write_file "$STAGE_DIR/config/tourapi.env.template" <<'EOF'
# LocalTrip AI TourAPI collection template.
# Copy this outside version control or into a local secret store before real collection.
# Do not put a real service key in this template.

TOUR_API_SERVICE_KEY=
TOUR_API_BASE_URL=https://apis.data.go.kr/B551011/KorService2
TOUR_API_MOBILE_OS=ETC
TOUR_API_MOBILE_APP=LocalTripAI
TOUR_API_RESPONSE_TYPE=json
TOUR_API_NUM_ROWS=100
TOUR_API_DEFAULT_LANGUAGE=ko
EOF

  write_file "$STAGE_DIR/config/collection_plan.md" <<'EOF'
# LocalTrip AI Collection Plan

## Roles

- Destinations: collect and normalize attractions, cultural sites, nature spots, and destination detail records.
- Events/courses: collect festivals, events, itinerary courses, and course stop relationships.
- API sync: own request parameters, raw response archiving, run logs, retries, and key handling.

## Real TourAPI Placeholder

Use `TOUR_API_BASE_URL=https://apis.data.go.kr/B551011/KorService2` and provide the key at runtime through `TOUR_API_SERVICE_KEY`.

Example endpoint paths to wire later:

- `${TOUR_API_BASE_URL}/areaBasedList2`
- `${TOUR_API_BASE_URL}/detailCommon2`
- `${TOUR_API_BASE_URL}/searchFestival2`

Keep raw responses in `03_api_sync/raw_samples/YYYYMMDD/` and normalized outputs in the role-owned directories.
EOF
}

sync_to_host_volume() {
  local parent
  parent="$(dirname "$TARGET_ROOT")"
  mkdir -p "$parent"
  mkdir -p "$TARGET_ROOT"
  rm -rf \
    "$TARGET_ROOT/01_destinations" \
    "$TARGET_ROOT/02_events_courses" \
    "$TARGET_ROOT/03_api_sync" \
    "$TARGET_ROOT/04_rag" \
    "$TARGET_ROOT/05_account_profile_templates" \
    "$TARGET_ROOT/config" \
    "$TARGET_ROOT/README.md"
  cp -a "$STAGE_DIR/." "$TARGET_ROOT/"
}

sync_to_pod_volume() {
  echo "[localtrip] ready pod wait: $POD_SELECTOR"
  "$KUBECTL_BIN" -n "$NAMESPACE" wait pod -l "$POD_SELECTOR" --for=condition=Ready --timeout=120s >/dev/null

  local pod
  pod="$("$KUBECTL_BIN" -n "$NAMESPACE" get pod -l "$POD_SELECTOR" -o jsonpath='{.items[0].metadata.name}')"

  if [[ -z "$pod" ]]; then
    echo "[localtrip] pod not found: namespace=$NAMESPACE selector=$POD_SELECTOR" >&2
    exit 1
  fi

  echo "[localtrip] sync: $STAGE_DIR -> $NAMESPACE/$pod:$TARGET_ROOT"
  "$KUBECTL_BIN" -n "$NAMESPACE" exec "$pod" -- sh -lc "mkdir -p '$TARGET_ROOT' && rm -rf '$TARGET_ROOT/01_destinations' '$TARGET_ROOT/02_events_courses' '$TARGET_ROOT/03_api_sync' '$TARGET_ROOT/04_rag' '$TARGET_ROOT/05_account_profile_templates' '$TARGET_ROOT/config' '$TARGET_ROOT/README.md'"
  tar -C "$STAGE_DIR" -cf - . | "$KUBECTL_BIN" -n "$NAMESPACE" exec -i "$pod" -- tar -xf - -C "$TARGET_ROOT"
}

stage_files

if [[ -d /workspace-data && -w /workspace-data ]]; then
  echo "[localtrip] using host-mounted workspace volume: $TARGET_ROOT"
  sync_to_host_volume
else
  echo "[localtrip] host /workspace-data unavailable; using kubectl workspace volume sync"
  sync_to_pod_volume
fi

echo "[localtrip] initialized: $TARGET_ROOT"
