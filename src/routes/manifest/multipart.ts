/**
 * multipart/mixed 响应组装：
 *
 * Expo Updates 协议要求 manifest/directive 响应使用 multipart/mixed，
 * 这里用 form-data 库当作"拼装 multipart body"的工具。
 *
 * 三种 manifest 响应（普通更新 / 回滚 / no-update）都走这两个工具，差异只在 parts 内容。
 */
import FormData from 'form-data';
import type { Context } from 'hono';

export type MultipartPart = {
  name: string; // form field 名：manifest / directive / extensions
  payload: string; // JSON 字符串
  signature?: string | null; // 可选，写入 part 的 expo-signature header
};

export function buildMultipartForm(parts: MultipartPart[]): FormData {
  const form = new FormData();
  for (const part of parts) {
    form.append(part.name, part.payload, {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(part.signature ? { 'expo-signature': part.signature } : {}),
      },
    });
  }
  return form;
}

/**
 * 用 Hono 把已组装好的 form 转成 200 multipart 响应，写入协议必需的几个响应头。
 *
 * 实现细节：Hono 的 c.body 要求 Uint8Array<ArrayBuffer>，
 * 这里把 Node Buffer 复制成新的 Uint8Array 避免 SharedArrayBuffer 的类型分歧。
 */
export function sendMultipartResponse(
  c: Context,
  form: FormData,
  protocolVersion: number,
): Response {
  const body = new Uint8Array(form.getBuffer());
  return c.body(body, 200, {
    'expo-protocol-version': String(protocolVersion),
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${form.getBoundary()}`,
  });
}
