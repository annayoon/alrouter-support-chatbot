// Fixed answers for specific topics, checked before the LLM is called.
// Use this when you want a guaranteed, consistent reply regardless of what the
// model would say (e.g. pricing, legal, anything customer-sensitive).
export const TOPIC_RULES = [
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
];

export function matchTopicRule(message) {
  return TOPIC_RULES.find((rule) => rule.keywords.some((re) => re.test(message))) || null;
}
