// Fixed answers for specific topics, checked before the LLM is called.
// Use this when you want a guaranteed, consistent reply regardless of what the
// model would say (e.g. pricing, legal, anything customer-sensitive).
const ENGLISH_GREETING = /\b(hello|hi|hey|good\s*(morning|afternoon|evening))\b/i;

export const TOPIC_RULES = [
  {
    // Checked first: a plain greeting shouldn't fall through to KB lookup/LLM at all.
    id: 'greeting',
    keywords: [
      /^\s*(안녕|하이|헬로|안뇽)/,
      /반갑/,
      /좋은\s*(아침|오후|저녁)/,
      /여보세요/,
      /굿\s*모닝/,
      ENGLISH_GREETING,
    ],
    silent: true, // just a greeting — doesn't need a staff alert
    // reply can be a function(message) for cases where the fixed answer still
    // needs to match the customer's language.
    reply: (message) => ENGLISH_GREETING.test(message)
      ? "Hi! I'm an AI-powered support chatbot for AlRouter.ai. I'll do my best to help, but as an AI I may occasionally give incomplete or inaccurate answers. How can I help you today?"
      : '안녕하세요! 저는 AI 기반 AlRouter.ai 고객센터 챗봇입니다. 최선을 다해 답변드리지만, AI 특성상 응대가 미흡하거나 부정확할 수 있는 점 양해 부탁드립니다. 무엇을 도와드릴까요?',
  },
  {
    // "중간 수수료 때문에 오히려 더 비싸지는 것 아닌가요?" — must come before
    // 'discount', whose /싸/ also matches "비싸" and would answer with the
    // discount rate instead.
    id: 'reseller-pricing',
    keywords: [/수수료/, /마진/, /(더|오히려)\s*비싸/, /비싸지/, /commission/i, /markup/i, /middleman/i],
    reply: '아니요. 당사는 B2B 대량 계약과 비용 최적화를 통해 할인된 단가를 적용받고 있으며, 이를 바탕으로 고객이 공급사와 직접 개별 계약을 맺는 경우보다 경쟁력 있는 가격으로 공급합니다.',
  },
  {
    // Must come before 'pricing' below — "할인율 얼마야?" would otherwise also
    // match pricing's /얼마/ keyword and never reach this more specific rule.
    id: 'discount',
    keywords: [/할인/, /discount/i, /싸/, /저렴/, /cheap(er)?/i, /affordable/i],
    reply: 'AlRouter.ai 할인율은 공급사 공식 가격 대비 최대 10%입니다.',
  },
  {
    // "요금제는 정액제인가요, 토큰 기반인가요?" — must come before 'pricing',
    // whose /요금/ would otherwise deflect this to the support email.
    id: 'billing-model',
    keywords: [/정액제/, /월정액/, /종량제/, /토큰\s*(기반|과금)/, /과금\s*(방식|체계|구조)/, /flat[- ]?(rate|fee)/i, /pay[- ]?as[- ]?you[- ]?go/i, /token[- ]?based/i],
    reply: '토큰 사용량에 따라 과금되는 종량제 방식입니다. 현재 정액제 요금제는 제공하지 않습니다.',
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
    reply: '서비스 이용에 필요한 최소한의 정보(아이디, 비밀번호)만으로 계정을 운영하며, 그 외 불필요한 개인정보는 수집·보관하지 않습니다. 자세한 내용은 AlRouter.ai 홈페이지 하단의 개인정보처리방침을 참고해주세요.',
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
    // "특정 모델의 서비스가 중단되면 어떻게 되나요?" — must come before
    // 'service-outage', whose /서비스.{0,15}(다운|중단)/ would otherwise treat
    // it as an outage report.
    id: 'model-discontinued',
    keywords: [/모델.{0,15}(중단|중지|종료|없어지|사라지)/, /model.{0,25}(discontinu|deprecat|retire|shut\s*down)/i],
    reply: '제공 모델은 각 공급사의 운영 정책에 따라 변경될 수 있습니다. 특정 모델이 중단되거나 변경되더라도 동등 수준 이상의 다른 모델을 즉시 선택해 서비스를 계속 이용하실 수 있습니다. 단일 모델에 종속되지 않는 멀티모델 게이트웨이 구조의 가장 큰 장점입니다.',
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
  {
    id: 'supported-models',
    keywords: [
      /(지원|제공).{0,5}모델/,
      /모델.{0,5}(목록|리스트|종류)/,
      /어떤\s*모델/,
      /무슨\s*모델/,
      /which\s*models/i,
      /supported\s*models/i,
      /available\s*models/i,
    ],
    reply: "제공되는 모델 목록은 '모델 & 가격' 페이지를 참고해주세요. 제공 모델과 가격은 수시로 변동될 수 있으니, 정확한 사항은 support@alrouter.ai로 문의해주시면 안내드리겠습니다.",
  },
];

export function matchTopicRule(message) {
  return TOPIC_RULES.find((rule) => rule.keywords.some((re) => re.test(message))) || null;
}

export function resolveTopicReply(rule, message) {
  return typeof rule.reply === 'function' ? rule.reply(message) : rule.reply;
}
