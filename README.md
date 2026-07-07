# alrouter.ai 고객센터 챗봇

로컬 Ollama로 답변하고, Confluence 위키를 지식 베이스로 참고하며,
답변 실패/불만/상담원 요청/대화 종료 시 Slack·이메일로 담당자에게 알림을 보내는
고객센터 챗봇입니다. `public/widget.js`를 `<script>` 태그로 삽입하면 어떤 웹사이트에도 붙일 수 있습니다.

## 준비

1. Ollama가 로컬에서 실행 중이고 모델이 있어야 합니다. 운영(서버)은 `gemma4`를 씁니다 — `qwen2.5:14b`,
   `qwen3:32b`, `llama3.2`와 비교했을 때 한국어 답변 품질/사실 정확도가 가장 좋았고, `qwen3:32b`보다
   응답도 빨랐습니다. 로컬 개발 데모용으로는 다운로드가 가벼운 `llama3.2`도 괜찮습니다 (`OLLAMA_MODEL`로 전환).
   ```
   ollama pull gemma4   # 운영 권장 (약 9.6GB)
   # 또는 로컬 데모용 경량 모델
   ollama pull llama3.2
   ollama pull bge-m3   # 지식 베이스 의미 검색용 임베딩 모델 (약 1.2GB, 권장)
   ollama serve  # 실행 중이 아니라면
   ```
   `bge-m3`가 없으면 임베딩 검색 대신 키워드 검색으로 자동 폴백합니다
   (`OLLAMA_EMBED_MODEL` 환경 변수로 다른 임베딩 모델 지정 가능).
2. 의존성 설치
   ```
   npm install
   ```
3. `.env.example`을 `.env`로 복사하고 값 채우기
   ```
   cp .env.example .env
   ```
   - `CONFLUENCE_*`: 비워두면 지식 베이스 없이 일반 답변만 합니다.
     - `CONFLUENCE_ROOT_PAGE_ID`: 지식 베이스로 쓸 상위 페이지 ID. 이 페이지의 하위 문서 전체가 지식 베이스가 됩니다
       (스페이스 전체가 아니라, AlRouter 관련 문서가 모여있는 상위 페이지만 지정하세요).
     - `CONFLUENCE_EXCLUDE_PAGE_IDS`: 하위 문서 중 고객에게 노출하면 안 되는 페이지(가격표 등)를 콤마로 구분해 제외.
   - `SLACK_WEBHOOK_URL`: 비워두면 슬랙 알림을 건너뜁니다.
   - `SMTP_*`, `ALERT_EMAIL_*`: 비워두면 이메일 알림을 건너뜁니다.

## 실행

```
npm start
```

`http://localhost:3000/demo.html` 에서 위젯을 바로 테스트할 수 있습니다.

## alrouter.ai에 위젯 삽입

운영 챗봇 서버는 `https://chatbot.alrouter.ai`에 배포되어 있습니다 (Cloudflare Tunnel 경유).
alrouter.ai 사이트의 공통 템플릿(모든 페이지에 뜨는 곳, 예: 푸터 또는 `</body>` 바로 앞)에
아래 스크립트 태그 한 줄만 추가하면 됩니다.

```html
<script src="https://chatbot.alrouter.ai/widget.js" data-api-base="https://chatbot.alrouter.ai"></script>
```

- `data-api-base`는 챗봇 서버가 위젯을 서빙하는 사이트와 다른 도메인일 때 지정합니다. CORS는
  `https://alrouter.ai`, `https://www.alrouter.ai`로 이미 허용되어 있습니다 (다른 도메인에서 쓸 경우
  서버 `.env`의 `CORS_ALLOWED_ORIGINS`에 추가해야 함).
- 같은 도메인에서 직접 서빙한다면 `data-api-base=""`로 두면 됩니다.
- 위젯은 프레임워크 의존성이 없는 바닐라 JS라 React/Vue든 정적 HTML이든 그대로 붙습니다.

## 알림이 발생하는 경우

- 챗봇이 답을 찾지 못했을 때
- 고객이 불만/부정적 표현을 사용했을 때
- 고객이 상담원 연결을 요청했을 때
- 대화가 종료될 때 (요약 알림)

같은 세션에서 동일한 알림 유형은 한 번만 전송됩니다 (스팸 방지).

## 구조

```
server/
  index.js       Express 서버, 라우팅
  ollama.js      로컬 Ollama 호출
  confluence.js  Confluence 지식 베이스 조회
  alerts.js      Slack/이메일 알림 발송
  detect.js      답변 실패/불만/상담원 요청 감지 (키워드 기반)
public/
  widget.js      임베드용 바닐라 JS 위젯
  demo.html      위젯 테스트 페이지
```
