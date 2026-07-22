# B2B 카탈로그 시스템 (B2B Catalog System)

엑셀로 상품 정보를 등록하면 자동으로 웹 카탈로그(플립북)를 생성하는 시스템입니다.

## 기술 스택

- Backend: Node.js, Express
- Frontend: HTML5, CSS3, Vanilla JavaScript
- Database: PostgreSQL
- 이미지 저장 방식: URL 참조 방식 (파일 업로드 없음)

## 시작하기

```bash
npm install
cp .env.example .env   # DATABASE_URL, PORT, KAKAO_JS_KEY 값을 채워주세요
npm run db:init         # PostgreSQL 스키마 생성
npm run dev              # http://localhost:3000
```

## Render로 배포하기

저장소 루트의 `render.yaml`(Blueprint)로 웹서비스를 배포할 수 있습니다. PostgreSQL은 Render가 계정당 무료 DB를 1개로 제한하므로, Blueprint에 포함하지 않고 [Neon](https://neon.tech) 또는 [Supabase](https://supabase.com) 같은 별도 무료 PostgreSQL을 연결하는 방식입니다.

1. Neon(또는 Supabase)에서 무료 프로젝트를 만들고 연결 문자열(connection string)을 복사합니다. (`sslmode=require`가 포함된 URL이면 앱이 자동으로 SSL 연결을 사용합니다.)
2. [Render 대시보드](https://dashboard.render.com) → **New +** → **Blueprint**
3. `kiltaejung/b2b-catalog` 저장소 연결 후 `claude/b2b-catalog-system-c47k2u` 브랜치 선택
4. Render가 `render.yaml`을 읽어 `b2b-catalog` 웹서비스를 생성하되, `DATABASE_URL`과 `KAKAO_JS_KEY`는 수동 입력 항목으로 남겨둡니다. 배포 화면에서 `DATABASE_URL`에 1번의 연결 문자열을 붙여넣어 주세요. (`KAKAO_JS_KEY`는 카카오톡 공유용 선택 항목)
5. 서비스 시작 시 `npm run db:init`이 자동 실행되어 스키마가 생성되고, 이후 `/admin/index.html`에서 바로 사용 가능합니다.

Render 무료 웹서비스 플랜은 일정 시간 미사용 시 슬립되며 첫 요청 시 재시작에 시간이 걸릴 수 있습니다.

## 폴더 구조

```
server/            Express 백엔드
  config/db.js      PostgreSQL 커넥션 풀
  controllers/       라우트 핸들러 (상품/카탈로그/견적)
  services/          엑셀 파싱, 검증, 카탈로그 스냅샷 생성 로직
  routes/             API 라우트 정의
  middleware/upload.js  엑셀 업로드 multer 설정
db/schema.sql       PostgreSQL 테이블 정의
db/init.js          스키마 적용 스크립트
public/admin/       관리자 웹 (상품관리, 카탈로그 관리)
public/catalog/      웹 플립북 뷰어 (표지/목차/카테고리/상품/마지막 페이지)
```

## 주요 기능

- **엑셀 업로드/양식 다운로드**: `상품관리` 화면에서 지정된 엑셀 양식(노출순서, 카테고리, 상품코드, 상품명, 브랜드, 대표이미지 URL, 정상가, 판매가, 상품구성, 원산지, 상품특징, 상품설명, 배송안내)을 다운로드하고 업로드하면 자동으로 검증 후 등록/수정됩니다.
- **업로드 검증**: 필수값 누락, 이미지 URL 형식/확장자(JPG/PNG/WEBP) 오류, 가격 오류, 파일 내 상품코드 중복을 행 단위로 표시합니다.
- **이미지 자동 여백 제거**: 상품 등록/수정/엑셀 업로드 시 대표이미지 가장자리의 흰색/단색(또는 투명) 여백을 자동 감지해 상품 피사체 주변으로 타이트하게 크롭한 이미지를 별도로 저장하고, 카탈로그에서는 이 크롭 이미지를 우선 사용합니다. 배경이 복잡하거나 이미 타이트한 이미지, 크롭에 실패한 경우는 원본 이미지를 그대로 사용하며 상품 등록 자체는 영향을 받지 않습니다. 관리자 상품 수정 화면에서 이미지 확대/축소·위치 이동·원본 초기화도 가능합니다.
- **카탈로그 생성**: 카테고리 노출 순서, 가격 표시/숨김, 고객사명/로고를 지정해 생성하면 생성 시점의 상품 스냅샷이 저장되어 이후 상품이 변경되어도 카탈로그 내용은 유지됩니다.
- **웹 플립북**: 표지 → 목차 → 카테고리별 상품 그리드 페이지 → 상품 상세 페이지 → 마지막 페이지(주문/배송안내/회사정보) 순으로 구성되며, 페이지 넘김 효과, 확대/축소, 처음/이전/다음/마지막 이동, 페이지 번호 입력 이동을 지원하고 PC/모바일 모두 반응형으로 동작합니다.
- **상품 검색**: 플립북 상단 검색창에서 상품명/상품코드/카테고리로 실시간 검색 후 해당 상품 페이지로 바로 이동합니다.
- **견적 담기**: 상품 상세 페이지의 '견적 담기' 버튼으로 담은 상품을 기반으로 견적서를 생성하고 인쇄/PDF 저장이 가능한 페이지로 확인할 수 있습니다.
- **카카오톡 공유**: `KAKAO_JS_KEY` 설정 시 현재 보고 있는 페이지를 카카오톡으로 공유할 수 있습니다.

## API 개요

| Method | Path | 설명 |
| --- | --- | --- |
| GET | /api/products | 상품 목록 조회 (search, category 쿼리) |
| GET | /api/products/template | 엑셀 등록 양식 다운로드 |
| POST | /api/products/upload | 엑셀 업로드 및 검증/등록 |
| POST/PUT/DELETE | /api/products/:id | 상품 생성/수정/삭제 |
| GET/POST | /api/catalogs | 카탈로그 목록 조회 / 생성 |
| GET/DELETE | /api/catalogs/:id | 카탈로그 상세(플립북 데이터) 조회 / 삭제 |
| POST | /api/quotes | 견적서 생성 |
| GET | /api/quotes/:id | 견적서 상세 조회 |
