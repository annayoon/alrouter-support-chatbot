// Fixed answers for specific topics, checked before the LLM is called.
// Use this when you want a guaranteed, consistent reply regardless of what the
// model would say (e.g. pricing, legal, anything customer-sensitive).
const ENGLISH_GREETING = /\b(hello|hi|hey)\b/i;

export const TOPIC_RULES = [
  {
    // Checked first: a plain greeting shouldn't fall through to KB lookup/LLM at all.
    id: 'greeting',
    keywords: [/^\s*(안녕|하이|헬로)/, /반갑/, ENGLISH_GREETING],
    silent: true, // just a greeting — doesn't need a staff alert
    // reply can be a function(message) for cases where the fixed answer still
    // needs to match the customer's language.
    reply: (message) => ENGLISH_GREETING.test(message)
      ? 'Hello! This is the AlRouter.ai support chatbot. How can I help you today?'
      : '안녕하세요! AlRouter.ai 고객센터입니다. 무엇을 도와드릴까요?',
  },
  {
    // Must come before 'pricing' below — "할인율 얼마야?" would otherwise also
    // match pricing's /얼마/ keyword and never reach this more specific rule.
    id: 'discount',
    keywords: [/할인/, /discount/i],
    reply: 'AlRouter.ai 할인율은 공급사 공식 가격 대비 최대 10%입니다.',
  },
  {
    id: 'pricing',
    keywords: [/가격/, /요금/, /비용/, /얼마/, /플랜/, /pricing/i, /price/i],
    reply: 'AlRouter.ai 가격 안내는 support@alrouter.ai로 문의해주시면 담당자가 확인 후 안내드리겠습니다.',
  },
  {
    id: 'refund',
    keywords: [/환불/, /refund/i],
    reply: 'AlRouter.ai 환불 문의는 support@alrouter.ai로 남겨주시면 계정 정보를 확인한 뒤 담당자가 환불 정책에 따라 안내드리겠습니다.',
  },
  {
    id: 'privacy',
    keywords: [/개인정보/, /데이터\s*처리/, /privacy/i, /personal (data|information)/i],
    reply: '개인정보 처리와 관련된 문의는 AlRouter.ai 홈페이지 하단의 개인정보처리방침을 참고해주세요.',
  },
  {
    id: 'contract-termination',
    keywords: [/해지/, /계약\s*(종료|취소)/, /cancel(l)?ation/i, /terminat(e|ion)/i],
    reply: '계약 해지 절차 및 조건은 이용약관에 따라 달라질 수 있어, support@alrouter.ai로 문의해주시면 담당자가 확인 후 정확히 안내드리겠습니다.',
  },
  {
    id: 'security-report',
    keywords: [/취약점/, /보안\s*(신고|이슈|문제|사고)/, /vulnerabilit(y|ies)/i, /security\s*(issue|report|bug)/i],
    reply: '보안 취약점 신고는 support@alrouter.ai로 상세 내용(재현 방법 포함)과 함께 제보해주시면 담당팀이 신속히 확인 후 조치하겠습니다.',
  },
  {
    id: 'payment-method',
    keywords: [/결제\s*수단/, /카드\s*(등록|변경|삭제)/, /payment\s*method/i, /card\s*regist/i],
    reply: '결제 수단 등록/변경 관련 문의는 support@alrouter.ai로 남겨주시면 담당자가 확인 후 안내드리겠습니다.',
  },
  {
    id: 'account-deletion',
    keywords: [/회원\s*탈퇴/, /계정\s*(삭제|탈퇴)/, /delete\s*(my\s*)?account/i, /account\s*deletion/i],
    reply: '회원 탈퇴는 본인 확인이 필요하여, support@alrouter.ai로 문의해주시면 절차를 안내해드리겠습니다.',
  },
  {
    id: 'service-outage',
    // Bare /다운/ would also match "다운로드" (download), so require it near "서비스".
    keywords: [/장애/, /서비스.{0,15}(다운|중단)/, /오류\s*(신고|접수)/, /service\s*(down|outage)/i],
    reply: '서비스 장애나 오류는 support@alrouter.ai로 발생 시각과 증상을 함께 알려주시면 신속히 확인하겠습니다.',
  },
  {
    id: 'enterprise-inquiry',
    keywords: [/기업\s*(도입|이용|계약|문의)/, /엔터프라이즈/, /enterprise/i],
    reply: '기업(엔터프라이즈) 도입 문의는 support@alrouter.ai로 남겨주시면 담당자가 안내드리겠습니다.',
  },
];

export function matchTopicRule(message) {
  return TOPIC_RULES.find((rule) => rule.keywords.some((re) => re.test(message))) || null;
}

export function resolveTopicReply(rule, message) {
  return typeof rule.reply === 'function' ? rule.reply(message) : rule.reply;
}
