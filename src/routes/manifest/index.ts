import type { Context } from 'hono';

import { type ActiveUpdate, resolveActiveUpdateAsync } from '../../core/deployment.js';
import { NoUpdateAvailableError } from '../../core/directives.js';
import { CodeSigningKeyMissingError } from '../../core/signing.js';
import { putNoUpdateAvailableInResponseAsync } from './no-update.js';
import { putNormalUpdateInResponseAsync } from './normal-update.js';
import { putRollBackInResponseAsync } from './rollback.js';

export async function handleManifest(c: Context): Promise<Response> {
  // protocol version: 0 或 1，客户端在 header 里声明
  const protocolVersionMaybe = c.req.header('expo-protocol-version');
  if (protocolVersionMaybe !== undefined && Number.isNaN(parseInt(protocolVersionMaybe, 10))) {
    return c.json({ error: 'Unsupported protocol version. Expected either 0 or 1.' }, 400);
  }
  const protocolVersion = parseInt(protocolVersionMaybe ?? '0', 10);

  // platform / runtime-version 允许 header 或 query 任一来源，便于本地浏览器手工调试。
  const platform = c.req.header('expo-platform') ?? c.req.query('platform');
  if (platform !== 'ios' && platform !== 'android') {
    return c.json({ error: 'Unsupported platform. Expected either ios or android.' }, 400);
  }

  const runtimeVersion = c.req.header('expo-runtime-version') ?? c.req.query('runtime-version');
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    return c.json({ error: 'No runtimeVersion provided.' }, 400);
  }

  // 解析当前 active：正常发布 or 回滚态
  let active: null | ActiveUpdate;
  try {
    active = await resolveActiveUpdateAsync(runtimeVersion);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 404);
  }

  // 三种业务分支 + 两类受控异常的统一拦截
  try {
    if (active.kind === 'normal') {
      return await putNormalUpdateInResponseAsync(
        c,
        active,
        runtimeVersion,
        platform,
        protocolVersion,
      );
    } else {
      return await putRollBackInResponseAsync(c, active.commitTime, protocolVersion);
    }
  } catch (error) {
    if (error instanceof NoUpdateAvailableError) {
      return await putNoUpdateAvailableInResponseAsync(c, protocolVersion);
    }
    if (error instanceof CodeSigningKeyMissingError) {
      return c.json({ error: error.message }, 400);
    }
    console.error(error);
    return c.json({ error: String(error) }, 404);
  }
}
