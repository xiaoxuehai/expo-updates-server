import type { Context } from 'hono';

import { createNoUpdateAvailableDirective } from '../../core/directives.js';
import { signPayloadIfRequestedAsync } from '../../core/signing.js';
import { buildMultipartForm, sendMultipartResponse } from './multipart.js';

/**
 * "已是最新"响应（protocol v1 才支持）：明确告诉客户端不用下任何东西。
 *
 * 触发场景：
 * - 普通更新路径：客户端自报的 current update id 等于服务端 active 的 id
 * - 回滚路径：客户端 current 就是 embedded，没必要再触发一次回滚
 *
 * 没有这条 directive 时（protocol v0），客户端会重复下载相同的 manifest 才能确认无更新。
 */
export async function putNoUpdateAvailableInResponseAsync(
  c: Context,
  protocolVersion: number,
): Promise<Response> {
  if (protocolVersion === 0) {
    throw new Error('NoUpdateAvailable directive not available in protocol version 0');
  }

  const directive = createNoUpdateAvailableDirective();
  const payload = JSON.stringify(directive);
  const signature = await signPayloadIfRequestedAsync(
    payload,
    c.req.header('expo-expect-signature'),
  );

  const form = buildMultipartForm([{ name: 'directive', payload, signature }]);
  return sendMultipartResponse(c, form, 1);
}
