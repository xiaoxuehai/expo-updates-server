import type { Context } from 'hono';

import { createRollBackDirective, NoUpdateAvailableError } from '../../core/directives.js';
import { signPayloadIfRequestedAsync } from '../../core/signing.js';
import { buildMultipartForm, sendMultipartResponse } from './multipart.js';

/**
 * 回滚响应：不下发新的 JS bundle，而是告诉客户端回退到原生包内嵌的 embedded update。
 * 只有 protocol v1 支持 rollBackToEmbedded directive。
 *
 * 边界处理：
 * - 客户端必须通过 expo-embedded-update-id header 自报"我打包时的 embedded 是哪一版"。
 * - 如果客户端当前运行的就是 embedded（current === embedded），
 *   抛 NoUpdateAvailableError，避免无意义的回滚指令。
 */
export async function putRollBackInResponseAsync(
  c: Context,
  commitTime: string,
  protocolVersion: number,
): Promise<Response> {
  if (protocolVersion === 0) {
    throw new Error('Rollbacks not supported on protocol version 0');
  }

  const embeddedUpdateId = c.req.header('expo-embedded-update-id');
  if (!embeddedUpdateId || typeof embeddedUpdateId !== 'string') {
    throw new Error('Invalid Expo-Embedded-Update-ID request header specified.');
  }

  const currentUpdateId = c.req.header('expo-current-update-id');
  if (currentUpdateId === embeddedUpdateId) {
    throw new NoUpdateAvailableError();
  }

  const directive = createRollBackDirective(commitTime);
  const payload = JSON.stringify(directive);
  const signature = await signPayloadIfRequestedAsync(
    payload,
    c.req.header('expo-expect-signature'),
  );

  const form = buildMultipartForm([{ name: 'directive', payload, signature }]);
  return sendMultipartResponse(c, form, 1);
}
