import type { AlignmentReport } from './types.js';

export async function sendNotificationEmail(report: AlignmentReport, clientEmail: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const { total, grade } = report.score;
  const topActions = report.prioritizedActions.slice(0, 3);
  const dashboardUrl = `${process.env.DASHBOARD_WORKER_URL ?? 'https://dashboard.foundbyai.dk'}/?view=client&client=${report.clientId}`;

  const actionsHtml = topActions.map((a, i) =>
    `<tr><td style="padding:8px 4px;font-size:13px;color:#1a1a1a">${i + 1}. ${a.action_da}</td><td style="padding:8px 4px;font-size:12px;color:#6b7280;white-space:nowrap">${a.timeEstimate_da}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html lang="da"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <p style="color:#6b7280;font-size:12px;margin:0 0 24px">Found by AI · Platformtilpasningsrapport · ${report.generatedAt.slice(0, 10)}</p>
  <h1 style="color:#1a1a1a;font-size:20px;margin:0 0 4px">${report.client.name}</h1>
  <p style="color:#6b7280;font-size:14px;margin:0 0 28px">${report.client.domain}</p>

  <div style="background:#fff;border-radius:8px;padding:24px;margin:0 0 24px;text-align:center">
    <p style="font-size:56px;font-weight:900;color:${grade.color};margin:0;line-height:1">${grade.grade}</p>
    <p style="font-size:24px;font-weight:700;color:#1a1a1a;margin:4px 0 0">${total}/100</p>
    <p style="font-size:14px;color:#6b7280;margin:4px 0 0">${grade.label_da} · GEO Health Score</p>
  </div>

  ${topActions.length ? `
  <h2 style="font-size:16px;color:#1a1a1a;margin:0 0 12px">Anbefalede handlinger</h2>
  <div style="background:#fff;border-radius:8px;padding:16px;margin:0 0 24px">
    <table style="width:100%;border-collapse:collapse">${actionsHtml}</table>
  </div>` : ''}

  <div style="text-align:center;margin:24px 0">
    <a href="${dashboardUrl}" style="background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block">
      Se din fulde rapport →
    </a>
  </div>

  <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:24px 0">
    <p style="margin:0;font-size:13px;color:#166534;line-height:1.6">
      Når du har rettet ovenstående, opdaterer vi automatisk dit GEO-lag med de korrekte platformlinks.
      Skriv til <a href="mailto:hello@foundbyai.dk" style="color:#166534">hello@foundbyai.dk</a> ved spørgsmål.
    </p>
  </div>

  <p style="text-align:center;font-size:11px;color:#a1a1aa;margin:28px 0 0;line-height:1.6">
    Genereret automatisk af Found by AI · Næste rapport om 2 uger<br>
    <a href="https://foundbyai.dk" style="color:#a1a1aa">foundbyai.dk</a>
  </p>
</div></body></html>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Found by AI <rapport@foundbyai.dk>',
      to: [clientEmail],
      subject: `Din AI-synlighedsrapport: ${grade.grade} — ${total}/100 · ${report.client.name}`,
      html,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[alignment] Notification email sent to ${clientEmail}`);
}
