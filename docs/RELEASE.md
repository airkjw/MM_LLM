# MM_LLM 배포 안내

이 문서는 개발자용 빌드·서명·공증·GitHub Release 절차를 정리합니다.

## 검증

Node.js 24 이상을 사용합니다.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

## macOS 서명과 공증

키체인에 Developer ID Application 인증서와 `notarytool` 프로필이 있어야 합니다. Apple 계정의 앱 전용 암호는 소스, 셸 기록, GitHub에 넣지 않습니다.

```bash
APPLE_KEYCHAIN_PROFILE=MM_LLM npm run dist:mac
```

이 명령은 Intel(x64)과 Apple Silicon(arm64) 앱을 서명·공증하고 DMG, 업데이트용 ZIP, 블록맵을 만든 뒤 두 아키텍처를 모두 담은 `latest-mac.yml`을 생성합니다. 완료 후 다음을 확인합니다.

```bash
codesign --verify --deep --strict release/mac/MM_LLM.app
codesign --verify --deep --strict release/mac-arm64/MM_LLM.app
xcrun stapler validate release/mac/MM_LLM.app
xcrun stapler validate release/mac-arm64/MM_LLM.app
spctl --assess --type execute --verbose=4 release/mac/MM_LLM.app
spctl --assess --type execute --verbose=4 release/mac-arm64/MM_LLM.app
```

## Windows 패키지

GitHub Actions의 **Build Windows release artifact** 워크플로를 수동 실행합니다. 워크플로는 Windows x64 NSIS 설치 파일, 블록맵과 `latest.yml`을 `windows-release` 아티팩트로 만듭니다.

## GitHub Release

`package.json` 버전과 태그를 일치시킨 뒤, macOS와 Windows 산출물을 한 공개 Release에 올립니다.

```bash
VERSION=0.3.0
git tag "v${VERSION}"
git push origin main "v${VERSION}"
gh release create "v${VERSION}" \
  release/*.dmg release/*.zip release/*.exe \
  release/latest-mac.yml release/latest.yml release/*.blockmap \
  --verify-tag --title "MM_LLM ${VERSION}" --generate-notes
```

`latest-mac.yml`, `latest.yml`과 각 블록맵이 앱의 GitHub Releases 자동 업데이트에 필요합니다. 인증서, 개인키, API 키와 암호는 저장소 파일·이슈·로그에 넣지 않습니다.
