# 릴리즈 자동화

GitHub Actions의 **Build and publish release**를 기존 버전 태그로 실행한다.
두 운영체제의 검사·빌드가 모두 성공해야 설치파일과 업데이트 메타데이터를 초안에 업로드하고 공개한다.
이미 공개된 버전의 설치파일은 이 워크플로로 덮어쓰지 않는다.

## 저장소 설정

Repository Settings → Secrets and variables → Actions에 다음 Secret을 등록한다.
값을 소스, README, 이슈 또는 채팅에 붙여넣지 않는다.

| 이름 | 값 |
| --- | --- |
| MAC_CSC_LINK | 개인키가 포함된 Developer ID Application 인증서의 .p12 파일을 Base64로 인코딩한 값 |
| MAC_CSC_KEY_PASSWORD | 위 .p12 파일을 내보낼 때 설정한 암호 |
| APPLE_ID | 인증서 소유 Apple Developer 계정 |
| APPLE_APP_SPECIFIC_PASSWORD | 해당 계정의 앱 전용 암호 |
| APPLE_TEAM_ID | 인증서와 일치하는 Developer Team ID |

다른 저장소의 Actions Secret은 원문을 다시 읽거나 복사할 수 없다. 원본 자료로 이 저장소에 등록한다.
실제 값은 로그에 출력하지 않으며 macOS 빌드 단계에만 전달한다.

## 배포 절차

1. package.json과 package-lock.json 버전을 맞추고 `docs/RELEASE_NOTES_v버전.md`를 작성한다.
2. 변경사항을 커밋·푸시하고 동일 커밋에 버전 태그를 푸시한다.
3. Actions → Build and publish release → Run workflow에서 태그와 publish를 선택한다.
4. macOS arm64/x64는 서명·공증 후 codesign, stapler, Gatekeeper 검사를 거친다.
5. Windows x64와 macOS 산출물의 SHA512·크기·필수 파일을 검사하고 릴리즈 노트를 함께 게시한다.

`publish=false`이면 공개하지 않고 Actions 아티팩트만 보관한다(14일).
Windows Authenticode 인증서는 별도이며 현재 Windows 빌드는 미서명이다.
