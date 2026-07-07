// Fixed answers for specific topics, checked before the LLM is called.
// Use this when you want a guaranteed, consistent reply regardless of what the
// model would say (e.g. pricing, legal, anything customer-sensitive).
export const TOPIC_RULES = [
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
];

export function matchTopicRule(message) {
  return TOPIC_RULES.find((rule) => rule.keywords.some((re) => re.test(message))) || null;
}
