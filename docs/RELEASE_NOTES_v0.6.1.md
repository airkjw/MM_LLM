# MM_LLM v0.6.1

대화 첨부와 프로젝트 문서에 텍스트·Markdown·CSV·PowerPoint(.pptx)·한글(.hwpx) 파일을 추가할 수 있습니다.

## 첨부 형식 추가

- 새로 지원하는 형식: `.txt`, `.md`, `.csv`, `.pptx`, `.hwpx`. 기존 PDF·Word(.docx)·Excel(.xlsx)·이미지도 그대로 지원합니다.
- 파일 내용은 이 기기 안에서 본문 텍스트로 추출한 뒤 전송합니다. 기존 문서와 같은 첨부 전송 확인·비식별 확인 절차를 거칩니다.
- PowerPoint는 슬라이드 순서대로 본문과 발표자 노트를 읽습니다. 한글(.hwpx)은 문단 순서대로 본문을 읽습니다.
- PowerPoint의 수식·SmartArt·차트 안의 글자는 아직 읽지 않습니다. 필요한 내용은 슬라이드 본문이나 노트에 적어 주세요.
- 한글 Windows에서 저장한 텍스트·CSV 파일(CP949)도 글자가 깨지지 않게 읽습니다.
- 구형 바이너리 형식(`.hwp`, `.doc`, `.xls`, `.ppt`)은 아직 지원하지 않습니다. 한글·Word·Excel·PowerPoint에서 `.hwpx`·`.docx`·`.xlsx`·`.pptx`로 저장한 뒤 첨부해 주세요.
- 배포용(암호화) 한글 문서와 암호가 걸린 파일은 읽을 수 없습니다.

## 업데이트 후 확인

- 기존 대화·프로젝트·설정은 그대로 이어집니다.
- macOS Apple Silicon: `MM_LLM-0.6.1-arm64.dmg`
- macOS Intel: `MM_LLM-0.6.1.dmg`
- Windows x64: `MM_LLM-0.6.1-x64-Setup.exe`
- macOS 앱은 Developer ID 서명과 Apple 공증을 거칩니다. Windows 설치파일에는 별도의 Authenticode 서명이 적용되지 않습니다.

[전체 변경 내역](https://github.com/airkjw/MM_LLM/compare/v0.6.0...v0.6.1)
