# LecturAI demo

Next.js 16, React 19, TypeScript, Zod와 OpenAI를 사용하는 실시간 강의 필기 데모입니다. PDF/PPTX 자료 지식과 시간순 원본 대본을 보존하고, 2분 체크포인트마다 하나의 구조화 필기를 수정·병합·확장합니다.

2단계에서는 질문 시점까지의 수업 내부 근거만 사용하는 질문창, 교수자 설명 스타일 프로필, 부재 시작·복귀 요약, 명시적 종료와 10분 비활동 종료 후보를 추가했습니다. 사실 오류 탐지, Claim Ledger, 웹 검색, 외부 지식 보충과 DB는 포함하지 않습니다. 종료 후보의 grace period가 끝나면 남은 대본을 반영한 `finalNote`를 만든 뒤 Review Sheet를 생성합니다.

세션은 한 Node.js 프로세스의 `globalThis` 기반 `Map`에만 저장되므로 서버 재시작 시 사라집니다. 인증, DB, 외부 큐, 영구 파일 저장, 앱 WebSocket/SSE는 사용하지 않습니다.

## 실행

Node.js 20 이상에서 다음을 실행합니다.

```bash
npm install
cp .env.example .env.local
```

생성된 `.env.local`에 실제 `OPENAI_API_KEY`를 입력합니다. 환경변수를 바꾼
뒤에는 개발 서버를 다시 시작해야 합니다. `.env.local`은 Git에 커밋하지
않습니다.

`.env.local` 예시:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_FAST_MODEL=gpt-4.1-nano
OPENAI_SMART_MODEL=gpt-4.1-nano
OPENAI_FINAL_NOTE_MODEL=gpt-4.1-nano
OPENAI_MATERIAL_MODEL=gpt-4.1-nano
# Google 번역 없이 자막을 바로 번역하는 저지연 모델
OPENAI_TRANSLATION_MODEL=gpt-4.1-nano
LECTURE_ENDING_GRACE_SECONDS=10
LECTURE_INACTIVITY_SECONDS=600
LECTURE_INACTIVITY_GRACE_SECONDS=30

# 선택: MP3/TXT/typed 데모 입력 표시
NEXT_PUBLIC_ENABLE_DEMO_CONTROLS=false
```

`OPENAI_SEARCH_MODEL`은 과거 코드 호환을 위해 환경 스키마에 남아 있을 수 있지만 1단계에서 웹 검색은 항상 fail-closed로 비활성화됩니다.

```bash
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 실제 마이크는 브라우저 권한이 필요합니다.

## 단일 VM 운영 배포

현재 메모리 세션 구조를 유지하는 데모/소규모 운영 환경은 Google Compute
Engine 같은 단일 Linux VM에서 `compose.yaml`로 실행합니다. Compose는 Next.js
앱과 자동 HTTPS 리버스 프록시인 Caddy를 각각 하나씩 실행합니다. 현재 사이트는
별도 로그인 없이 공개되므로 OpenAI API 사용량과 비용을 모니터링해야 합니다.

서버 환경변수는 저장소에 커밋하지 않고 다음 두 파일에 둡니다.

```text
/etc/lecturai/app.env     # .env.example과 같은 앱 설정
/etc/lecturai/caddy.env   # deploy/caddy.env.example과 같은 HTTPS/접근 설정
```

도메인이 없을 때는 VM 고정 IPv4를 `203.0.113.10`처럼 하이픈으로 바꾼
`lecturai.203-0-113-10.sslip.io`를 데모 주소로 사용할 수 있습니다. 이 주소는
외부 무료 DNS 서비스에 의존하므로 정식 운영 전에는 소유 도메인으로 교체합니다.

```bash
sudo docker compose up -d --build
sudo docker compose ps
curl https://YOUR_SITE/api/health
```

컨테이너나 VM을 재시작하면 메모리의 강의 세션은 사라집니다. 여러 앱
컨테이너를 동시에 실행하지 마세요.

새 Ubuntu 24.04 Compute Engine VM에서는 다음 설치 스크립트를 실행할 수
있습니다. OpenAI 키와 인증서 알림 이메일을 터미널에서 직접 물어보고
`/etc/lecturai`에 권한 `0600`으로 저장합니다.

```bash
bash deploy/setup-ubuntu-vm.sh
```

Google Cloud Shell에서는 다음 명령으로 서울 리전의 `e2-medium`, 30GB
Ubuntu VM, 고정 IP, 웹 방화벽을 생성합니다. Compute Engine 사용 요금이
발생하며, 같은 이름의 리소스가 있으면 중복 생성하지 않습니다.

```bash
bash deploy/create-gcp-vm.sh GOOGLE_CLOUD_PROJECT_ID
```

## 현재 처리 흐름

```text
확정 자막 → immutable Transcript Log 저장
                         ↓
        2분 서버 타이머 / 수동 요청 / 종료
                         ↓
기존 currentNote + 직전 문맥 + 새 transcript + Material Knowledge
                         ↓
      하나의 누적 Structured Note 전체 갱신
                         ↓
      종료 시 finalNote → Review Sheet → ended
```

독립적인 2단계 체인은 다음처럼 동작합니다.

```text
질문 시점 snapshot → 내부 관련 문맥 선택 → Answer Composer → Reviewer → 답변/보류
부재 start/end sequence → 부재 구간 요약 → Reviewer → 상세 catch-up/fallback
최근 수업 activity → 명시적 종료 10초 또는 비활동 30초 후보 → 취소/최종 정리
```

- 자료 분석은 실제 문서에 보이는 정의, 조건, 과정, 공식, 비교, 예시, 경고를 분리하고 각 항목의 `sourceText`와 `sourcePage`를 보존합니다. 기존 자료 UI와 전사 keyword 호환을 위한 Slide Map도 함께 반환하지만 단원 판정에는 사용하지 않습니다.
- 자료가 없으면 빈 `MaterialKnowledge`로 시작하며 대본만으로 동작합니다.
- Realtime WebRTC는 브라우저가 OpenAI와 직접 연결합니다. 확정 자막만 서버에 보내며 delta는 Transcript Notebook 아래에 임시 스타일로 표시합니다.
- 서버는 `itemId` 중복을 막고 원본 자막을 모델 호출 전에 저장합니다. 저장된 대본은 필기 실패와 무관하게 reset 전까지 유지됩니다.
- 자막 저장은 필기 모델을 호출하지 않습니다. 첫 확정 자막이 들어오면 서버의 2분 타이머가 시작됩니다.
- 생성 시작 시 transcript `itemId` 목록을 snapshot으로 고정하고 아직 처리하지 않은 대본만 반영합니다. 생성 중이거나 순서가 뒤바뀌어 늦게 도착한 대본은 다음 작업에 남습니다.
- scheduled는 `OPENAI_FAST_MODEL`, manual은 `OPENAI_SMART_MODEL`, final은 `OPENAI_FINAL_NOTE_MODEL`을 사용합니다. 세 경로 모두 Composer → Grounding Reviewer → 필요 시 수정 1회 → 서버 근거 검증을 실행합니다.
- 자동 체크포인트는 짧은 발화 하나라도 새 대본이 있으면 실행하며, 모델 처리 시간과 무관하게 다음 체크포인트를 예약합니다.
- 세션별 `noteGenerationChain`이 자동·수동 작업의 동시 실행을 막습니다. 생성 중 수동 요청은 boolean pending 요청 하나로 합쳐집니다.
- 자동 필기를 끄더라도 transcript 저장과 수동/최종 필기는 계속됩니다. reset은 타이머와 note epoch를 바꿔 오래된 비동기 결과를 거절합니다.
- 모델 입력이 비정상적으로 커지면 서버의 원본 note/source 상태는 유지한 채 시험·중요 항목과 섹션별 핵심 항목을 우선하는 모델 입력 사본으로 축소하고 Raw Log에 크기 플래그를 남깁니다.
- `important`는 굵게, `exam`은 굵게와 시험 배지로 렌더링합니다. 모델이 직접 Markdown `**`를 생성하지 않습니다.
- PDF 자동 페이지 판정은 새 필기 경로에서 사용하지 않습니다. PDF 뷰어의 이전/다음 버튼으로 사용자가 직접 페이지를 탐색할 수 있습니다.
- 화면 상태 폴링은 기존 350ms 간격을 유지합니다.
- 실시간 번역은 Google Cloud Translation과 별도 AI 보정 단계 없이 `gpt-4.1-nano`로 바로 생성합니다. 각 자막 번역은 독립적으로 실행되어 느린 요청이 다음 자막을 막지 않습니다.
- 실시간 번역을 켜면 일반 질문과 번역문 선택 설명의 답변도 선택한 목표 언어로 생성합니다. 번역문을 드래그해 질문해도 번역 segment와 원본 `itemId`를 서버에서 검증하고, 원문 대본·자료를 근거로 답하므로 번역문이 새 사실 근거로 취급되지는 않습니다.
- 질문은 요청 시점의 `lectureRevision`과 transcript sequence를 고정합니다. 최근 문맥은 항상 포함하고 질문 단어와 겹치는 자료·필기·과거 대본을 로컬 관련도로 선별하며, 외부 검색 도구를 전달하지 않습니다.
- 교수자 스타일은 의미 있는 발화 12개 이후 처음 생성하고, 이후 의미 있는 발화 25개마다 별도 체인에서 갱신합니다. 사실 내용과 공격적 표현은 프로필에 저장하지 않습니다.
- 부재 모드는 분석을 멈추지 않습니다. 부재 기간의 sequence만 결과 근거로 허용하고 긴 구간은 40개 발화 단위로 부분 요약 후 병합합니다.
- 활동/종료 분류는 자막마다 LLM을 호출하지 않는 최근 문맥 기반 로컬 분류기입니다. 부재 중에는 비활동 종료를 보류하지만 명시적 종료는 계속 감지합니다.

## UI

- Transcript Notebook은 모든 확정 대본을 시간순으로 표시하며 텍스트 선택/복사가 가능합니다. 사용자가 아래를 보고 있을 때만 새 발화를 따라가고, 과거를 읽고 있으면 새 발화 개수 버튼을 표시합니다.
- 필기 패널은 자동 필기 토글, 마지막 생성 시간, 서버 `nextScheduledAt` 기반 카운트다운, 수동 정리 버튼, 반영 sequence와 새 대본 여부를 표시합니다.
- `important`는 굵게, `exam`은 굵게와 시험 배지로 표시합니다. 실시간 `currentNote`와 종료 `finalNote`를 구분합니다.
- Raw 창은 스케줄, snapshot context, 생성, 검토, 수정, 근거 거절, final fallback 이벤트를 보여주며 전체 prompt/transcript는 로그에 복사하지 않습니다.
- 하단 지원 패널은 자리 비움/복귀, 부재 기록, 수업 질문 입력을 제공합니다. 답변 근거는 PPT/PDF 페이지, transcript ID, 필기 ID별로 접어 볼 수 있습니다.
- 종료 후보가 생기면 서버의 `expiresAt`을 기준으로 카운트다운과 `[계속 듣기]` 버튼을 표시합니다. 종료 확정 후에는 마이크/WebRTC를 중지하고 `finalizing` 진행 상태를 보여줍니다.

개발자 모드는 `.env.local`의 `NEXT_PUBLIC_ENABLE_DEMO_CONTROLS=true` 또는 `/?debug=1`로 활성화합니다. MP3는 기존 Realtime WebRTC 경로로 재생하고, TXT는 partial→completed 자막 흐름을 로컬에서 시뮬레이션하되 완료 문장은 실제 transcript API를 통과합니다. `public/demo`의 Binary Search 자료와 원고를 사용할 수 있습니다.

## API 요약

세션 생성:

```bash
curl -X POST http://localhost:3000/api/session \
  -F 'material=@./slides.pdf;type=application/pdf' \
  -F 'instruction=2분마다 기존 필기에 새 대본을 누적하세요.' \
  -F 'language=ko'
```

자료 없이 시작하려면 `material`을 생략합니다. PDF와 PPTX를 지원하며 과거 `pdf` form field도 허용합니다.

확정 자막 저장:

```bash
curl -X POST http://localhost:3000/api/session/SESSION_UUID/transcript \
  -H 'Content-Type: application/json' \
  -d '{
    "itemId":"turn-1",
    "sequence":1,
    "text":"정렬된 배열이라는 조건은 중요합니다.",
    "source":"manual",
    "receivedAt":"2026-08-01T08:00:00.000Z",
    "startedAtMs":null,
    "endedAtMs":null
  }'
```

응답의 deprecated `action`은 항상 `none`입니다. 저장 직후 응답하며 자막 요청 안에서 필기 모델을 호출하지 않습니다.

구조화 필기는 수업 중 2분마다 자동으로 누적 생성됩니다.

질문, 부재, 종료 취소:

```bash
curl -X POST http://localhost:3000/api/session/SESSION_UUID/questions \
  -H 'Content-Type: application/json' \
  -d '{"question":"왜 시간복잡도가 O(log n)인가요?"}'

curl http://localhost:3000/api/session/SESSION_UUID/questions
curl -X POST http://localhost:3000/api/session/SESSION_UUID/absence/start
curl -X POST http://localhost:3000/api/session/SESSION_UUID/absence/end
curl http://localhost:3000/api/session/SESSION_UUID/absence
curl -X POST http://localhost:3000/api/session/SESSION_UUID/end/cancel
```

```bash
curl http://localhost:3000/api/session/SESSION_UUID/state
curl 'http://localhost:3000/api/session/SESSION_UUID/raw?after=0'
curl -X POST http://localhost:3000/api/session/SESSION_UUID/reset
```

reset은 분석된 자료와 최초 instruction은 보존하고 transcript, `currentNote`, `finalNote`, 질문, 스타일 프로필, 부재 기록, 종료 후보, cursor, 타이머, pending 작업, review와 raw log를 초기화합니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run test:notes
npm run test:lecture
npm run test:stage2
npm run test:assistant
npm run test:transcription-keywords
npm run test:web-search-parser
npm run test:web-search-disabled
npm run build
```

`test:notes`는 mock Composer/Reviewer로 Binary Search의 세 체크포인트 누적 병합, stable ID, 시험 강조, snapshot 경계, 수동 중복 요청, 실패 cursor, 서버 타이머, 자동 토글, reset stale 결과, final 중복 방지와 fallback을 검사합니다. `test:stage2`는 질문 snapshot/grounding/보류, 교수 스타일, 다중 부재와 fallback, 종료 오탐 방지, 비활동과 부재 억제, grace 취소, Binary Search 통합 시나리오와 종료 중 작업 정리를 검사합니다. `test:lecture`는 기존 지식 처리 유틸리티의 회귀와 transcript 저장 시 필기 LLM을 호출하지 않는 계약을 확인합니다.

개발 서버와 실제 API key를 사용한 E2E:

```bash
npm run demo:smoke
```

이 테스트는 메모리에서 Binary Search PDF를 만들고 Material Knowledge, 수동 누적 필기 API, grounding raw logs, 중복 자막과 reset을 검사합니다. 웹 검색 로그가 하나라도 나오면 실패합니다. 다른 서버는 `DEMO_BASE_URL`, 자료 없는 흐름은 `DEMO_NO_MATERIAL=true`를 사용합니다.
