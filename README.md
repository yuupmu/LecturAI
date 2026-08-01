# LecturAI demo

PDF/PPTX 강의 자료와 실시간 강의 자막을 함께 분석하는 로컬 해커톤 데모입니다. 자료 없이 음성 강의만 모니터링할 수도 있습니다. Next.js App Router 프론트엔드가 브라우저에서 OpenAI Realtime WebRTC 전사를 받고, 완성된 자막만 Node.js API Route에 전달합니다. 강조·자료와 발화의 충돌 검증·수업 종료 복습지를 별도 조작 없이 화면에 반영합니다.

인증, DB, 큐, 워커, 앱 WebSocket/SSE 서버, 영구 파일 저장은 사용하지 않습니다. 모든 세션은 한 Node.js 프로세스의 `globalThis` 기반 `Map`에만 저장되므로 서버를 재시작하면 사라집니다.

## 설치 및 실행

Node.js 20 이상과 Node.js에 포함된 npm이 필요합니다.

```bash
npm install
```

`.env.local`을 만듭니다.

```dotenv
OPENAI_API_KEY=sk-...
LINER_API_KEY=...
OPENAI_FAST_MODEL=gpt-5-mini
OPENAI_SMART_MODEL=gpt-5.6

# 선택: 숨겨진 typed transcript 비상 패널 활성화
NEXT_PUBLIC_ENABLE_DEMO_CONTROLS=false
```

```bash
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 마이크는 브라우저 권한이 필요하며 로컬에서는 `localhost`로 접속해야 합니다. 타입 검사는 `npm run typecheck`, 린트는 `npm run lint`, 프로덕션 빌드는 `npm run build`로 실행합니다.

## 프론트엔드 흐름

- Setup Desk에서 선택적으로 PDF/PPTX 자료를 올리고 최초 지시문과 언어를 제출합니다. 자료를 올리지 않아도 시작할 수 있습니다.
- 같은 클릭 흐름에서 마이크 권한, 자료 분석 또는 무자료 문맥 준비, Realtime client secret, WebRTC 연결, 상태 폴링이 자동으로 이어집니다.
- Live Workspace는 현재 슬라이드 문맥, 실시간 delta, 확정 자막, Agent 이벤트와 Liner 근거를 표시합니다.
- 수업 종료가 감지되면 WebRTC와 마이크가 자동으로 닫히고 세 문제의 Review Sheet가 펼쳐집니다.
- 상단 `RAW`는 별도 창에서 `agent_stream`, `tool_call`, `tool_result`, `error` 원본 JSON을 커서 기반으로 보여줍니다.

비상용 typed transcript 패널은 기본적으로 숨겨져 있습니다. `.env.local`의 `NEXT_PUBLIC_ENABLE_DEMO_CONTROLS=true` 또는 `http://localhost:3000/?debug=1`로만 활성화되며, 모든 프리셋은 가짜 UI 이벤트가 아니라 실제 transcript API를 통과합니다.

## 오류 로그 읽기

- 서버 오류는 실행 중인 터미널에 `[LecturAI:error]` 접두사와 함께 JSON으로 출력됩니다. 각 로그에는 `errorId`, 시간, `scope`, 세션 context, 오류 이름·메시지·stack이 포함됩니다.
- 세션 생성 이후 발생한 Agent, OpenAI, Liner, review fallback, API 오류는 상단 `RAW` 창의 `error` category에도 같은 구조로 기록됩니다.
- Setup 또는 Live Workspace에서 발생한 브라우저/API 오류는 화면의 `ERROR LOG`를 펼쳐 HTTP status, 서버 diagnostic, 응답 원문, 브라우저 stack을 확인할 수 있습니다.
- API 오류 응답에는 전체 stack 대신 `diagnostic.errorId`, `scope`, `message`, `timestamp`가 들어갑니다. 전체 stack은 터미널이나 해당 세션의 Raw 창에서 같은 `errorId`로 찾습니다.
- 로그는 데모 세션과 마찬가지로 메모리에만 존재하므로 서버를 재시작하면 사라집니다.

## 데모 진행 순서

1. PDF/PPTX를 선택하거나 자료 없이 진행합니다. 전체 검증 시연에는 이진 탐색 자료를 사용합니다.
2. `강의실 열기`를 누릅니다.
3. 브라우저의 마이크 권한을 허용합니다.
4. 정상 문장: “이진 탐색은 정렬된 배열에서 사용합니다.”
5. 불일치 문장: “이진 탐색의 최악 시간복잡도는 O(n)입니다.”
6. 강조 문장: “정렬된 배열이라는 전제는 시험에 꼭 나옵니다.”
7. 종료 문장: “오늘 수업은 여기까지 하겠습니다.”
8. 자동으로 펼쳐지는 Review Sheet의 문제 3개를 확인합니다.
9. `RAW` 창에서 `tool_call`과 `tool_result`를 확인합니다.

## 처리 흐름

- PDF/PPTX는 해당 MIME type의 Base64 data URL로 Responses API `input_file`에 전달되며 `detail: "low"`와 Zod Structured Output을 사용합니다.
- 자료가 없으면 factual claim이 없는 가상 강의 페이지를 사용합니다. 따라서 명시적 강조·종료·복습은 동작하지만 자료 충돌 검증은 발생하지 않습니다.
- Realtime 엔드포인트는 `gpt-live-transcribe`용 임시 client secret만 반환합니다. `OPENAI_API_KEY`는 응답에 포함되지 않습니다.
- 확정 자막은 세션별 `analysisChain`에서 순차 처리됩니다. Monitor Agent는 `NO_ACTION` 또는 세 툴 중 하나만 선택하며 코드의 `actionTaken`도 두 번째 실행을 차단합니다.
- 강조, 검증, 퀴즈, 원시 스트림 로그는 메모리에만 유지됩니다. Liner는 5초 제한, 무재시도이며 실패한 검증도 `failed` 이벤트로 남습니다.

## API 예시

PDF 세션 생성:

```bash
curl -X POST http://localhost:3000/api/session \
  -F 'material=@./slides.pdf;type=application/pdf' \
  -F 'instruction=강의의 명시적 행동만 기록하세요.' \
  -F 'language=ko'
```

PPTX 세션 생성:

```bash
curl -X POST http://localhost:3000/api/session \
  -F 'material=@./slides.pptx;type=application/vnd.openxmlformats-officedocument.presentationml.presentation' \
  -F 'instruction=강의의 명시적 행동만 기록하세요.' \
  -F 'language=ko'
```

자료 없는 세션 생성:

```bash
curl -X POST http://localhost:3000/api/session \
  -F 'instruction=강의의 명시적 강조와 종료를 기록하세요.' \
  -F 'language=ko'
```

이전 `pdf` form field도 기존 호출과의 호환을 위해 계속 허용합니다.

Realtime client secret 생성:

```bash
curl -X POST http://localhost:3000/api/realtime/token \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_UUID"}'
```

자막 전송:

```bash
curl -X POST http://localhost:3000/api/session/SESSION_UUID/transcript \
  -H 'Content-Type: application/json' \
  -d '{
    "itemId":"7a5f9ab6-c82d-4b36-a942-5a8fdccb43f8",
    "sequence":1,
    "text":"정렬된 배열이라는 전제는 시험에 꼭 나옵니다.",
    "source":"typed",
    "receivedAt":"2026-08-01T08:00:00.000Z"
  }'
```

상태와 커서 이후 원시 로그 조회:

```bash
curl http://localhost:3000/api/session/SESSION_UUID/state
curl 'http://localhost:3000/api/session/SESSION_UUID/raw?after=0'
```

세션 진행 상태 초기화(슬라이드와 최초 instruction은 유지):

```bash
curl -X POST http://localhost:3000/api/session/SESSION_UUID/reset
```

## 데모 스모크 테스트

개발 서버를 실행한 상태에서 별도 터미널에서 실행합니다. 테스트는 이진 탐색 내용의 최소 PDF를 메모리에서 생성하고 정상 자막, 강조, 직접 충돌, 종료 자막을 차례로 전송합니다.

```bash
npm run demo:smoke
```

다른 서버 주소나 PDF/PPTX를 쓰려면 다음 환경변수를 지정합니다.

```bash
DEMO_BASE_URL=http://localhost:3000 DEMO_MATERIAL_PATH=./slides.pptx npm run demo:smoke
```

자료 없는 흐름은 다음처럼 검사합니다. 이 모드에서는 verification assertion을 생략하고 강조와 복습 문제를 확인합니다.

```bash
DEMO_NO_MATERIAL=true npm run demo:smoke
```

기존 `DEMO_PDF_PATH`도 호환 목적으로 지원합니다.

OpenAI 모델 판단은 확률적입니다. 스모크 테스트는 실제 API 키와 네트워크를 사용하며 emphasis 이벤트, 정확히 3개의 review 문제, `tool_call`/`tool_result` 로그를 확인합니다. 자료가 있는 기본 모드에서는 verification 이벤트도 확인하며 검색 실패의 `failed` 상태를 허용합니다.
