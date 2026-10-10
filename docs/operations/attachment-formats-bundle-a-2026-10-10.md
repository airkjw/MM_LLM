# 첨부 형식 확장 묶음 A — TXT·MD·CSV·PPTX·HWPX

Run `run_ff806a19183d`, 구현 worker W1(Sonnet 5.5). 기준 커밋 `3921784`(v0.6.0).

## 범위

채팅 첨부와 프로젝트 문서가 기존 PDF·DOCX·XLSX·이미지에 더해 `.txt`, `.md`, `.csv`, `.pptx`, `.hwpx`를
받는다. 모두 기기 안에서 텍스트를 추출하고 그 텍스트만 전송한다. 새 업로드 경로, IPC 채널, 네트워크
origin은 없다. 새 형식도 `kind: "document"`이므로 파일 전송 동의·개인정보 제거 확인·프로젝트 보관함
암호화·백업/복원이 기존 문서와 똑같이 적용된다. 구형 `.hwp`·`.ppt`는 받지 않는다.

## 소유권

| 파일 | 내용 |
| --- | --- |
| `src/main/document-formats.ts` (신규) | 확장자↔정규 MIME·허용 MIME, 첨부 시점 시그니처 검사, 텍스트·PPTX·HWPX 추출, 제한된 ZIP 리더 |
| `src/main/attachments.ts` | 허용 확장자·MIME 맵·파일 선택 필터·추출 분기 |
| `src/main/project-vault.ts` | 확장자·MIME·내용 검증, 정규 MIME 저장, 추출 분기, 안내 문구 |
| `src/main/index.ts` | `projects:add-document` 거부 문구 한 줄(복사만, 코디네이터 승인) |
| `src/renderer/src/ChatPanel.tsx`, `ProjectsScreen.tsx`, `README.md` | 형식 안내 문구 |

`document-text.ts`는 변경하지 않았다. 새 추출기를 별도 모듈에 둔 이유는 기존 테스트 여러 개가
`document-text`를 `extractPdf/extractDocx/extractXlsx`만 내보내는 fixture로 대체하기 때문이다.
새 추출기를 거기에 두면 그 fixture의 import가 깨진다.

## 형식별 동작

- **TXT·MD·CSV**: UTF-8(BOM 제거), BOM이 있는 UTF-16LE/BE, 그 밖에는 UTF-8이 아니면 CP949(`euc-kr`)로
  디코딩한다. NUL 바이트나 제어 문자 비율이 2%를 넘으면 이진 파일로 보고 거부한다. 줄바꿈만 `\n`으로
  통일하고 마크다운·CSV 구조는 그대로 둔다.
- **PPTX**: ZIP과 `[Content_Types].xml`의 `presentationml`을 확인한다. `presentation.xml` 순서(없으면
  슬라이드 번호 순)로 `a:p`별 `a:t`를 모아 `[슬라이드 N]`을 붙이고, 슬라이드 뒤에 발표자 노트를
  `[슬라이드 N 발표자 노트]`로 붙인다(노트 페이지의 번호 필드는 제외).
- **HWPX**: ZIP과 `mimetype` = `application/hwp+zip`을 확인한다. `content.hpf` spine 순서(없으면 번호 순)로
  `Contents/section*.xml`의 `hp:p`별 `hp:t`를 모은다. 표 셀 문단은 읽는 순서대로 한 줄씩, 탭·줄바꿈은
  반영한다. 암호화·배포용 문서는 안내 문구와 함께 거부한다.

## 안전 한도

| 항목 | 값 |
| --- | --- |
| 파일 크기 | 18MB(기존 그대로) |
| 추출 텍스트 | 1,000,000자(기존 `MAX_EXTRACTED_CHARS`와 동일) |
| ZIP 항목 수 | 5,000 |
| 선언된 압축 해제 총량 / 읽은 항목당 / 읽은 총량 | 80MB / 16MB / 48MB |

중앙 디렉터리의 선언 크기를 inflate 전에 검사하고 `maxOutputLength`로 inflate 중에도 강제한다. 암호화
항목, ZIP64, 중복 항목명, 지원하지 않는 압축 방식은 거부한다. `<!DOCTYPE`·`<!ENTITY`가 있는 XML은
거부하고, 엔티티는 미리 정의된 5개와 숫자 참조만 풀며 파서·외부 참조를 쓰지 않는다. 오류 문구에는
문서 내용이 들어가지 않는다.

## MIME 허용

확장자와 내용으로 판정하고 저장은 확장자별 정규 MIME으로 한다. 새 형식은 빈 문자열과 아래 별칭을
받는다. PDF·DOCX·XLSX는 이전처럼 정확한 MIME만 받는다.

| 확장자 | 정규 MIME | 추가로 허용 |
| --- | --- | --- |
| `.txt` | `text/plain` | |
| `.md` | `text/markdown` | `text/x-markdown`, `text/plain` |
| `.csv` | `text/csv` | `text/x-csv`, `application/csv`, `application/vnd.ms-excel`, `text/plain` |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | |
| `.hwpx` | `application/hwp+zip` | `application/haansofthwpx`, `application/x-hwpx`, `application/vnd.hancom.hwpx` |

## 검증

합성 fixture만 사용한다(테스트 안에서 jszip과 바이트 배열로 생성, 바이너리 fixture 없음).
`jszip@3.10.2`를 테스트용 devDependency로 명시했다(이미 mammoth·exceljs의 전이 의존성).

- `tests/document-formats.test.mjs`: 인코딩·이진 거부·슬라이드/구역 순서·노트·엔티티·DOCTYPE/ENTITY·
  암호화·zip bomb·항목 수·글자 수 한도·MIME 별칭·시그니처.
- `tests/attachment-formats.test.mjs`: 첨부·파일 선택 필터·`contentForChat`·프로젝트 추가(MIME 변형)·
  거부 사례·백업 export/restore.
- `tests/screens-ui-dom.test.tsx`: 프로젝트 드롭존과 채팅 입력창의 형식 안내 문구.
- `tests/document-format-guards.test.mjs`: ZIP 가드별 단일 fixture, 선형 XML 스캔 시간 상한(1KB·480KB·파트 상한 직전).
- `tests/chunk-document.test.mjs`: `chunkDocument` 출력 동치와 긴 공백 run 시간 상한.

결과(Linux, 합성 fixture, 4GB 제한 scope):

| 검사 | 결과 | 최대 RSS |
| --- | --- | --- |
| `npm run typecheck` | 통과 | 0.6GB |
| `node --test --test-concurrency=1 tests/*.test.mjs` | 578 pass / 0 fail | 0.43GB |
| `npm run ui:check` | 258 pass / 0 fail | 0.54GB |
| `npm run ui:audit` | 통과 | 0.10GB |
| `npm run build` | 통과 | 0.63GB |

실제 HWPX/PPTX 원본 파일, macOS 서명/공증, Windows 설치본, CI는 이 변경에서 검증하지 않았다.

## 보정 1 (R-1 리뷰)

- **XML 스캔**: PPTX·HWPX 토크나이저를 `indexOf` 기반 단일 방향 스캐너로 교체했다. 닫히지 않은 태그·주석·CDATA·
  따옴표와 태그 안의 `<`는 `문서 XML 구조가 올바르지 않습니다.`로 즉시 끝난다. 노트 본문 선택, rels·spine
  파싱도 같은 스캐너를 쓰며 순서 중복 제거는 `Set`을 쓴다. 정규식은 5개 엔티티·숫자 참조 치환에만 남아 있다.
- **chunkDocument**: `[ \t]+\n` 정규식을 한 번의 선형 패스로 바꿨다. 일반 텍스트의 출력은 이전과 같다
  (`tests/chunk-document.test.mjs`가 이전 구현과 비교).
- **텍스트 인코딩**: ICU가 CP949의 낱개 `0x81` 등을 C1 제어 문자(U+0080–U+009F)로 해석하므로 디코딩된
  텍스트의 제어 문자 비율 검사에 C1을 포함했다.
- **안내 문구**: 채팅 문구를 `PPTX·한글(HWPX)`로 바꾸고 `.hwp`·`.ppt`를 끌어 놓으면 HWPX·PPTX로 저장하라는
  전용 안내를 보여 준다.
