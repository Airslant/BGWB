import DmClient, { SingleSendMailRequest } from "@alicloud/dm20151123";
import { Config } from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";

import type { EmailCodePurpose } from "./types";

type VerificationEmailPayload = {
  to: string;
  purpose: EmailCodePurpose;
  code: string;
};

type DeliveryMode = "aliyun" | "console";

const EMAIL_SUBJECTS = {
  register: "BGWB 邮箱验证码",
  reset_password: "BGWB 密码重置验证码"
} satisfies Record<EmailCodePurpose, string>;

let aliyunClient: DmClient | undefined;

function getDeliveryMode(): DeliveryMode {
  const configuredMode = process.env.EMAIL_DELIVERY_MODE;

  if (process.env.NODE_ENV === "production" && configuredMode === "console") {
    throw new Error("EMAIL_DELIVERY_MODE=console is not allowed in production.");
  }

  if (configuredMode === "aliyun" || configuredMode === "console") {
    return configuredMode;
  }

  return process.env.NODE_ENV === "production" ? "aliyun" : "console";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailBody({ purpose, code }: VerificationEmailPayload) {
  const actionText = purpose === "register" ? "注册 BGWB 账号" : "重置 BGWB 密码";
  const englishActionText = purpose === "register" ? "create your BGWB account" : "reset your BGWB password";
  const text = [
    `你的验证码是：${code}`,
    "",
    `此验证码用于${actionText}，10 分钟内有效。`,
    "如果这不是你本人操作，可以忽略这封邮件。",
    "",
    `Your verification code is ${code}. It is valid for 10 minutes to ${englishActionText}.`
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#1a1815">
      <p>你的验证码是：</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0">${escapeHtml(code)}</p>
      <p>此验证码用于${escapeHtml(actionText)}，10 分钟内有效。</p>
      <p>如果这不是你本人操作，可以忽略这封邮件。</p>
      <p style="color:#716b62">Your verification code is ${escapeHtml(code)}. It is valid for 10 minutes to ${escapeHtml(englishActionText)}.</p>
    </div>
  `;

  return { text, html };
}

function getAliyunClient() {
  if (aliyunClient) {
    return aliyunClient;
  }

  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error("Aliyun DirectMail credentials are not configured.");
  }

  aliyunClient = new DmClient(
    new Config({
      accessKeyId,
      accessKeySecret,
      endpoint: process.env.ALIYUN_DM_ENDPOINT ?? "dm.aliyuncs.com"
    }) as never
  );

  return aliyunClient;
}

export async function sendVerificationEmail(payload: VerificationEmailPayload) {
  const mode = getDeliveryMode();
  const subject = EMAIL_SUBJECTS[payload.purpose];
  const { text, html } = buildEmailBody(payload);

  if (mode === "console") {
    console.info(`[BGWB email:${payload.purpose}] ${payload.to} -> ${payload.code}`);
    return;
  }

  const accountName = process.env.ALIYUN_DM_ACCOUNT_NAME ?? "noreply@boardgamewb.com";
  const fromAlias = process.env.ALIYUN_DM_FROM_ALIAS ?? "BGWB";
  const client = getAliyunClient();

  await client.singleSendMailWithOptions(
    new SingleSendMailRequest({
      accountName,
      addressType: 1,
      clickTrace: "0",
      fromAlias,
      htmlBody: html,
      replyToAddress: false,
      subject,
      textBody: text,
      toAddress: payload.to,
      unSubscribeLinkType: "disabled"
    }),
    new RuntimeOptions({})
  );
}
