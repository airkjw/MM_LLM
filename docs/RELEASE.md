# MM_LLM 배포 안내

이 문서는 개발자용 빌드·서명·공증·GitHub Release 절차를 정리합니다.

## 로컬 빌드

Node.js 24 이상을 사용합니다.

```bash
npm ci
npm test
npm run build
npm run dist:win
```

`dist:win`은 Windows x64 NSIS 설치 파일, 블록맵과 `latest.yml`을 만듭니다. Windows 실행과 Authenticode 서명은 Windows 환경에서 최종 검증해야 합니다.

## macOS 서명과 공증

키체인에 Developer ID Application 인증서가 설치되어 있어야 합니다. Apple 계정의 앱 전용 암호는 명령 인수나 소스에 넣지 말고 `notarytool` 보안 프롬프트에 직접 입력합니다.

```bash
xcrun notarytool store-credentials MM_LLM \
  --apple-id '<APPLE_ID>' \
  --team-id '<APPLE_TEAM_ID>'

APPLE_KEYCHAIN_PROFILE=MM_LLM npm run dist:mac
```

`dist:mac`은 Intel(x64)과 Apple Silicon(arm64) 앱을 서명·공증하고 DMG, 업데이트용 ZIP, 블록맵과 `latest-mac.yml`을 만듭니다. 완료 후 다음을 확인합니다.

```bash
codesign --verify --deep --strict release/mac/MM_LLM.app
codesign --verify --deep --strict release/mac-arm64/MM_LLM.app
xcrun stapler validate release/mac/MM_LLM.app
xcrun stapler validate release/mac-arm64/MM_LLM.app
spctl --assess --type execute --verbose=4 release/mac/MM_LLM.app
spctl --assess --type execute --verbose=4 release/mac-arm64/MM_LLM.app
```

## GitHub Actions

`.github/workflows/release.yml`은 `v*.*.*` 태그를 푸시하면 macOS와 Windows 패키지를 병렬 빌드합니다. 두 작업이 모두 성공한 뒤 공개 GitHub Release와 자동 업데이트 메타데이터를 게시합니다.

저장소의 **Settings → Secrets and variables → Actions**에 다음 Secret이 필요합니다.

- `MAC_CSC_LINK`: Developer ID Application `.p12` 파일의 base64 값
- `MAC_CSC_KEY_PASSWORD`: `.p12` 내보내기 암호
- `APPLE_ID`: 공증에 사용할 Apple 계정
- `APPLE_APP_SPECIFIC_PASSWORD`: Apple 계정의 앱 전용 암호
- `APPLE_TEAM_ID`: Apple Developer Team ID

인증서, 개인키, 암호는 저장소 파일·이슈·로그에 넣지 않습니다.

## 버전 배포

`package.json`의 버전과 태그가 일치해야 합니다.

```bash
npm version patch
git push origin main
git push origin "v$(node -p \"require('./package.json').version\")"
```

워크플로는 서명과 공증을 검증하고 필수 설치 파일 및 업데이트 메타데이터가 모두 있을 때만 Release를 생성합니다. 학생용 앱은 공개 Release를 사용하므로 GitHub 개인 토큰을 포함하지 않습니다.
