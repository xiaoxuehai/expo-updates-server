import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';

function nowStr(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function getUpdatesRoot(): string {
  return process.env.UPDATES_DIR ?? 'updates';
}

export async function handleRollback(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Request body must be JSON' }, 400);
  }

  const { runtimeVersion, target, reason } = body as {
    runtimeVersion?: string;
    target?: string;
    reason?: string;
  };

  if (!runtimeVersion || !target) {
    return c.json({ error: 'runtimeVersion and target are required' }, 400);
  }

  const rvRoot = path.join(getUpdatesRoot(), runtimeVersion);
  if (!fs.existsSync(rvRoot)) {
    return c.json({ error: `Runtime version not found: ${runtimeVersion}` }, 404);
  }

  // 回滚到 embedded 不需要校验目录；回滚到历史版本时必须确保目录存在
  if (target !== 'embedded' && !fs.existsSync(path.join(rvRoot, target))) {
    return c.json({ error: `Target release dir not found: ${target}` }, 404);
  }

  const deploymentFile = path.join(rvRoot, 'deployment.json');
  let deployment: {
    active: string | null;
    previous: string | null;
    history: Array<{ at: string; from: string | null; to: string; reason?: string }>;
  } = { active: null, previous: null, history: [] };

  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(await fsp.readFile(deploymentFile, 'utf-8'));
  }

  if (deployment.active === target) {
    return c.json({
      runtimeVersion,
      from: deployment.active,
      to: target,
      reason,
    });
  }

  // 回滚到历史版本时，重新生成 release.json（新 UUID + 新时间戳）
  // 这样 Expo 客户端会认为这是一个不同的更新，从而触发下载
  if (target !== 'embedded') {
    const releaseFile = path.join(rvRoot, target, 'release.json');
    const existing: Record<string, unknown> = fs.existsSync(releaseFile)
      ? JSON.parse(await fsp.readFile(releaseFile, 'utf-8'))
      : {};
    await fsp.writeFile(
      releaseFile,
      `${JSON.stringify(
        {
          ...existing,
          id: randomUUID(),
          publishedAt: nowStr(),
          source: 'rollback',
        },
        null,
        2,
      )}\n`,
    );
  }

  const previous = deployment.active;
  const next = {
    active: target,
    previous: previous === target ? deployment.previous : previous,
    history: [
      ...deployment.history,
      {
        at: nowStr(),
        from: previous,
        to: target,
        reason: reason ?? 'rollback',
      },
    ],
  };

  await fsp.writeFile(deploymentFile, `${JSON.stringify(next, null, 2)}\n`);

  return c.json({
    runtimeVersion,
    from: previous,
    to: target,
    reason: reason ?? 'rollback',
  });
}
