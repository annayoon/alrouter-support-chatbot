import nodemailer from 'nodemailer';

const {
  SLACK_WEBHOOK_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  ALERT_EMAIL_FROM,
  ALERT_EMAIL_TO,
} = process.env;

const isSlackConfigured = () => Boolean(SLACK_WEBHOOK_URL);
const isEmailConfigured = () =>
  Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && ALERT_EMAIL_FROM && ALERT_EMAIL_TO);

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

async function sendSlack(title, lines) {
  if (!isSlackConfigured()) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*${title}*\n${lines.join('\n')}`,
      }),
    });
  } catch (err) {
    console.error('[alerts] slack send failed:', err.message);
  }
}

async function sendEmail(subject, body) {
  if (!isEmailConfigured()) return;
  try {
    await getTransporter().sendMail({
      from: ALERT_EMAIL_FROM,
      to: ALERT_EMAIL_TO,
      subject,
      text: body,
    });
  } catch (err) {
    console.error('[alerts] email send failed:', err.message);
  }
}

async function notify(title, lines) {
  await Promise.all([sendSlack(title, lines), sendEmail(title, lines.join('\n'))]);
}

export const AlertReason = {
  NO_ANSWER: 'no_answer',
  NEGATIVE_SENTIMENT: 'negative_sentiment',
  HUMAN_REQUESTED: 'human_requested',
  SESSION_SUMMARY: 'session_summary',
  TOPIC_RULE_MATCHED: 'topic_rule_matched',
};

const TITLES = {
  [AlertReason.NO_ANSWER]: '[챗봇] 답변 실패 알림',
  [AlertReason.NEGATIVE_SENTIMENT]: '[챗봇] 고객 불만 감지',
  [AlertReason.HUMAN_REQUESTED]: '[챗봇] 상담원 연결 요청',
  [AlertReason.SESSION_SUMMARY]: '[챗봇] 대화 요약',
  [AlertReason.TOPIC_RULE_MATCHED]: '[챗봇] 특정 주제 문의 (가격 등)',
};

export async function sendAlert(reason, { sessionId, userMessage, botReply, summary }) {
  const title = TITLES[reason] || '[챗봇] 알림';
  const lines = [
    `세션: ${sessionId}`,
    userMessage ? `고객 메시지: ${userMessage}` : null,
    botReply ? `챗봇 응답: ${botReply}` : null,
    summary ? `요약: ${summary}` : null,
  ].filter(Boolean);

  await notify(title, lines);
}

export function isAlertingConfigured() {
  return isSlackConfigured() || isEmailConfigured();
}
