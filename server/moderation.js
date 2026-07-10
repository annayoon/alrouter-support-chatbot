// Basic profanity/abuse filter. Extend this list as needed — kept short and
// pattern-based rather than exhaustive.
const BANNED_WORDS = [
  /씨\s*발/i, /시\s*발/i, /병\s*신/i, /지\s*랄/i, /좆/, /개\s*새\s*끼/,
  /미친\s*(놈|년|새끼)/, /닥\s*쳐/, /꺼\s*져/,
];

export function containsBannedWord(message) {
  return BANNED_WORDS.some((re) => re.test(message));
}

// Order matters: card numbers must be masked before the more permissive
// phone-number pattern could otherwise partially match inside them.
const MASK_PATTERNS = [
  { name: '주민등록번호', re: /\b(\d{6})[-\s]?(\d{7})\b/g, replace: '$1-*******' },
  { name: '카드번호', re: /\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})\b/g, replace: '$1-****-****-$4' },
  { name: '전화번호', re: /\b(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g, replace: '$1-****-$3' },
];

export function maskSensitiveInfo(text) {
  return MASK_PATTERNS.reduce((acc, { re, replace }) => acc.replace(re, replace), text);
}
