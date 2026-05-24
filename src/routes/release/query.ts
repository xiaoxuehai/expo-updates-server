import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';

function getUpdatesRoot(): string {
  return process.env.UPDATES_DIR ?? 'updates';
}

type ReleaseJson = {
  id?: string;
  publishedAt?: string;
  notes?: string | null;
  gitSha?: string | null;
  source?: string | null;
};

async function readReleaseJson(dir: string): Promise<ReleaseJson | null> {
  const file = path.join(dir, 'release.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(await fsp.readFile(file, 'utf-8'));
}

function readDeploymentJson(rvRoot: string): {
  active: string | null;
  previous: string | null;
  history: Array<{ at: string; from: string | null; to: string; reason?: string }>;
} | null {
  const file = path.join(rvRoot, 'deployment.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export async function handleListRuntimeVersions(c: Context): Promise<Response> {
  const root = getUpdatesRoot();
  if (!fs.existsSync(root)) {
    return c.json([]);
  }

  const entries = await fsp.readdir(root);
  const result = await Promise.all(
    entries
      .filter((e) => fs.statSync(path.join(root, e)).isDirectory())
      .map(async (rv) => {
        const rvRoot = path.join(root, rv);
        const deployment = readDeploymentJson(rvRoot);
        const subDirs = await fsp.readdir(rvRoot);
        const totalReleases = subDirs.filter(
          (d) => fs.statSync(path.join(rvRoot, d)).isDirectory() && !d.startsWith('.'),
        ).length;
        return {
          runtimeVersion: rv,
          active: deployment?.active ?? null,
          totalReleases,
        };
      }),
  );

  return c.json(result);
}

export async function handleListUpdates(c: Context): Promise<Response> {
  const runtimeVersion = c.req.param('runtimeVersion') ?? '';
  const rvRoot = path.join(getUpdatesRoot(), runtimeVersion);

  if (!fs.existsSync(rvRoot)) {
    return c.json({ error: `Runtime version not found: ${runtimeVersion}` }, 404);
  }

  const entries = await fsp.readdir(rvRoot);
  const releases = await Promise.all(
    entries
      .filter((d) => fs.statSync(path.join(rvRoot, d)).isDirectory() && !d.startsWith('.'))
      .map(async (dir) => {
        const release = await readReleaseJson(path.join(rvRoot, dir));
        return {
          dir,
          id: release?.id ?? '',
          publishedAt: release?.publishedAt ?? '',
          notes: release?.notes ?? null,
          source: release?.source ?? null,
        };
      }),
  );

  releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return c.json(releases);
}

export async function handleGetDeployment(c: Context): Promise<Response> {
  const runtimeVersion = c.req.param('runtimeVersion') ?? '';
  const rvRoot = path.join(getUpdatesRoot(), runtimeVersion);

  if (!fs.existsSync(rvRoot)) {
    return c.json({ error: `Runtime version not found: ${runtimeVersion}` }, 404);
  }

  const deployment = readDeploymentJson(rvRoot);
  if (!deployment) {
    return c.json({ error: 'No deployment found' }, 404);
  }

  return c.json({
    runtimeVersion,
    active: deployment.active,
    previous: deployment.previous,
    history: deployment.history,
  });
}
