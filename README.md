# alrouter.ai 고객센터 챗봇

로컬 Ollama(`llama3.2`)로 답변하고, Confluence 위키를 지식 베이스로 참고하며,
답변 실패/불만/상담원 요청/대화 종료 시 Slack·이메일로 담당자에게 알림을 보내는
고객센터 챗봇입니다. `public/widget.js`를 `<script>` 태그로 삽입하면 어떤 웹사이트에도 붙일 수 있습니다.

## 준비

1. Ollama가 로컬에서 실행 중이고 `llama3.2` 모델이 있어야 합니다.
   ```
   ollama list   # llama3.2가 보이는지 확인
   ollama serve  # 실행 중이 아니라면
   ```
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

```html
<script src="https://<서버-도메인>/widget.js" data-api-base="https://<서버-도메인>"></script>
```

- `data-api-base`는 챗봇 서버가 위젯을 서빙하는 사이트와 다른 도메인일 때 지정합니다 (CORS 설정 필요).
- 같은 도메인에서 서빙한다면 `data-api-base=""`로 두면 됩니다.

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
