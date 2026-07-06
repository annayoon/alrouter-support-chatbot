const HUMAN_REQUEST_PATTERNS = [
  /상담원/, /사람.{0,3}(연결|바꿔|말하고)/, /담당자/, /사람이랑/,
  /talk to (a )?human/i, /speak to (a )?person/i, /real person/i, /human agent/i,
];

const NEGATIVE_SENTIMENT_PATTERNS = [
  /화나/, /짜증/, /최악/, /답답/, /환불/, /불만/, /사기/, /형편없/,
  /angry/i, /frustrat/i, /terrible/i, /awful/i, /scam/i, /unacceptable/i,
];

const NO_ANSWER_PATTERNS = [
  /모르겠/, /확인.{0,3}(후|해서).{0,3}(안내|답변)/, /정보가 없/, /찾을 수 없/,
  /i (don't|do not) know/i, /not sure/i, /no information/i, /cannot find/i,
];

function matchesAny(patterns, text) {
  return patterns.some((p) => p.test(text));
}

export function detectHumanRequest(userMessage) {
  return matchesAny(HUMAN_REQUEST_PATTERNS, userMessage);
}

export function detectNegativeSentiment(userMessage) {
  return matchesAny(NEGATIVE_SENTIMENT_PATTERNS, userMessage);
}

export function detectNoAnswer(botReply) {
  return matchesAny(NO_ANSWER_PATTERNS, botReply);
}
