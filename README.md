# MM_LLM

경희대학교 의료경영학과(Medical MBA) 학생을 위한 ChatKHU 데스크톱 앱입니다. Electron과 assistant-ui로 만들었으며, 학생 본인의 API 키만으로 시작합니다.

## 사용하기

1. macOS라면 기기 CPU에 맞는 DMG, Windows라면 x64 설치 파일을 실행합니다.
2. ChatKHU Gateway API 키를 앱의 로그인 화면에 입력합니다. 키는 운영체제의 안전한 저장 기능으로 암호화해 이 기기에 보관하며, 다음 실행 때 자동 로그인합니다.
3. 채팅 상단에서 모델을 선택합니다. 사용 가능한 모델은 로그인 시 Gateway의 `/models/`에서 직접 읽습니다. 사용자가 제공한 화면의 채팅 모델 36개를 표시 이름에 반영했고, API가 반환하는 추가 모델도 선택할 수 있습니다.
4. 왼쪽의 이미지·오디오·비디오 탭에서 해당 종류의 모델을 고릅니다. 오디오는 텍스트 음성 변환, 받아쓰기, 음악·효과음을 지원합니다.

채팅에는 의료경영 시작 템플릿, 대화 기록, 답변 다시 생성, 생성 중단, PDF·DOCX·XLSX·이미지 첨부가 있습니다. 일반 텍스트 질문은 Enter로 바로 전송합니다. 문서의 텍스트는 이 기기에서 추출합니다. 선택한 이미지와 추출한 텍스트는 질문과 함께 API로 전송됩니다. 오래된 `.doc`·`.xls` 파일, 스캔본 PDF의 OCR, 오디오 파일의 채팅 첨부는 현재 지원하지 않습니다.

## 환자 정보와 보관 위치

실제 환자를 식별할 수 있는 이름, 연락처, 등록번호, 주소, 얼굴 등을 전송하기 전에 사용자가 직접 제거해야 합니다. 한 대화에서 처음 파일을 첨부하면 “환자 식별정보나 개인정보를 제거하셨습니까? 사용은 가능하지만 책임은 본인에게 있습니다.”라는 팝업이 뜹니다. 확인 여부는 해당 대화에 저장되어 이후 같은 대화에서 다시 묻지 않습니다. 기존 대화에 첨부가 있지만 확인 기록이 없다면 다음 전송 전에 한 번 확인해야 합니다. 이미지·오디오·비디오 생성은 요청마다 확인을 요구합니다. 일반 텍스트 질문은 확인 없이 전송되므로 입력 전에 직접 식별정보를 제거해야 합니다. **앱이 자동으로 비식별화하거나 환자 정보를 탐지하는 기능은 없습니다.** 자료에 식별정보가 남아 있다면 전송하지 마세요.

API 키와 채팅 기록, 대화에 포함된 첨부 내용은 Electron의 `safeStorage`로 암호화해 각 기기의 앱 데이터 폴더에만 저장합니다. macOS는 앱 지원 폴더, Windows는 사용자 앱 데이터 폴더를 사용합니다. 로그아웃하면 저장된 API 키를 제거하며, 대화 기록은 같은 키로 다시 로그인할 때 볼 수 있도록 기기에 남깁니다. 대화 삭제는 앱에서 가능합니다. 미디어 결과는 자동 저장하지 않으므로 필요한 결과는 직접 다운로드하세요. 질문·첨부·생성 요청은 확인 후 ChatKHU Gateway로 전송됩니다.

남은 크레딧은 로그인 시 불러오고, 앱을 사용하는 동안 1분마다 갱신합니다. 채팅 응답이나 이미지·오디오·비디오 생성 요청이 끝난 직후에도 다시 조회합니다. ChatKHU API 키는 운영체제 보안 저장소에서 불러와 자동 로그인에 사용합니다. 공개된 Gateway 문서에는 API 키 자동 재발급 엔드포인트가 없으므로 키가 만료되거나 폐기되면 새 키로 다시 로그인해야 합니다.

## 개발과 배포

Node.js 24 이상을 사용합니다.

```bash
npm ci
npm run dev
npm test
npm run build
npm run dist:mac
npm run dist:win
```

`dist:mac`은 설치된 Developer ID Application 인증서로 Intel(x64)과 Apple Silicon(arm64) 앱을 서명하고, DMG·업데이트용 ZIP·`latest-mac.yml`을 만듭니다. `dist:mac:unsigned`는 로컬 검증용입니다. `dist:win`은 Windows x64 NSIS 설치 파일과 `latest.yml`을 만듭니다. 실제 배포 전에 Apple 공증까지 완료해야 합니다. Windows 실행은 Windows 기기에서 최종 검증해야 합니다.

첫 실행 창은 약 1910:2300의 세로 비율로 열립니다. 이후에는 마지막으로 닫은 창의 크기·위치·최대화 상태를 기기의 `window-state.json`에 보관하고 다음 실행 때 복원합니다. 모니터가 바뀌면 화면 안으로 위치와 크기를 보정합니다.

앱은 [airkjw/MM_LLM의 공개 GitHub Releases](https://github.com/airkjw/MM_LLM/releases)를 시작 후와 6시간마다 확인합니다. 새 버전을 자동 다운로드하고, 다운로드가 끝나면 왼쪽의 **업데이트 설치**를 눌러 즉시 재시작할 수 있습니다. 앱을 평소대로 종료해도 다운로드된 업데이트가 설치됩니다. 수동 확인도 가능합니다. 버전 태그(`v` + `package.json`의 버전)를 GitHub에 푸시하면 `.github/workflows/release.yml`이 macOS와 Windows 파일 및 업데이트 메타데이터를 만들고, 두 빌드가 성공한 뒤 공개 Release를 생성합니다. 학생용 앱에 GitHub 토큰은 넣지 않습니다.

GitHub Actions의 macOS 빌드에는 저장소의 **Settings → Secrets and variables → Actions**에 `MAC_CSC_LINK`(Developer ID Application `.p12`의 base64), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`가 필요합니다. Apple 자격 증명은 [Apple ID의 앱 전용 암호 발급](https://account.apple.com/)과 [Apple 공증 문서](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)를 참고해 본인이 저장소 Secret에 직접 넣으세요. 인증서 파일과 암호를 소스나 채팅에 붙여넣지 마세요. Secret이 없으면 Release 작업이 명시적으로 실패하며 업데이트가 배포되지 않습니다.

이 Mac에서 먼저 공증을 시험하려면 터미널에서 `xcrun notarytool store-credentials MM_LLM --apple-id '본인의 Apple ID 이메일' --team-id 9T5JLVT8G6`을 실행하세요. 암호는 터미널의 보안 프롬프트에 입력하고, 검증이 성공한 후 `APPLE_KEYCHAIN_PROFILE=MM_LLM npm run dist:mac`으로 다시 빌드하면 electron-builder가 앱 공증을 수행합니다. 완료 후 `xcrun stapler validate release/mac-arm64/MM_LLM.app`와 `xcrun stapler validate release/mac/MM_LLM.app`으로 확인하세요.

실제 키를 쓰지 않고 화면을 점검할 때만 개발 빌드에서 `MM_LLM_MOCK=1 npm run dev`를 사용합니다. 가상 모델·가상 응답은 패키징한 앱에서 활성화되지 않습니다. API 키를 README, 소스, 터미널 명령에 넣지 마세요.

## API 문서

- [Gateway 모델 목록](https://docs.mindlogic.ai/docs/khu/api-gateway/getting-started/models)
- [Chat Completions](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/chat-completions)
- [이미지 생성](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/image-generation)
- [오디오: 음성 합성](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-tts), [받아쓰기](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-stt), [음악](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/audio-music)
- [비디오 생성](https://docs.mindlogic.ai/docs/khu/api-gateway/reference/video-generation)

참고: ChatKHU의 [챗봇 API](https://docs.mindlogic.ai/docs/khu/factchat/product/api-access)는 챗봇에 설정된 모델을 사용하므로 요청의 `model`을 무시합니다. MM_LLM의 모델 선택은 Gateway의 일반 채팅·미디어 API에 연결합니다.
