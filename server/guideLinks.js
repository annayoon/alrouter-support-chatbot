// Public guide pages appended to relevant answers so customers get the full
// step-by-step walkthrough (with video) instead of only the chat summary.
// Unlike KB links (stripped in confluence.js), these are customer-facing URLs.
export const GUIDE_LINKS = [
  {
    id: 'cli-connect',
    keywords: [
      /cli/i, /환경\s*변수/, /cc\s*switch/i, /연결/, /라우팅/, /routing/i,
      /설정/, /등록/, /claude/i, /터미널/, /base[_\s]*url/i,
    ],
    url: 'https://alrouter.ai/guide',
    label: 'AlRouter를 CLI에서 연결하는 방법 (영상 포함)',
  },
];

export function matchGuideLink(text) {
  return GUIDE_LINKS.find((g) => g.keywords.some((re) => re.test(text))) || null;
}
