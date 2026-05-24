import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Context } from 'hono';

const REQUIRED_FILES = ['metadata.json', 'expoConfig.json'];

function nowStr(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function getUpdatesRoot(): string {
  return process.env.UPDATES_DIR ?? 'updates';
}

export async function handleDeploy(c: Context): Promise<Response> {
  const form = await c.req.formData();
  const runtimeVersion = String(form.get('runtimeVersion') ?? '');
  const bundleFile = form.get('bundle');
  const notes = form.get('notes');
  const setActive = form.get('setActive');

  if (!runtimeVersion.trim()) {
    return c.json(
      {
        error: 'Invalid request',
        details: [{ field: 'runtimeVersion', message: 'runtimeVersion is required' }],
      },
      400,
    );
  }
  if (!(bundleFile instanceof File)) {
    return c.json(
      {
        error: 'Invalid request',
        details: [{ field: 'bundle', message: 'bundle (zip file) is required' }],
      },
      400,
    );
  }

  const isActive = setActive !== 'false';

  let zip: AdmZip;
  try {
    const buffer = Buffer.from(await bundleFile.arrayBuffer());
    zip = new AdmZip(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Invalid zip: ${message}` }, 400);
  }

  const rvRoot = path.join(getUpdatesRoot(), runtimeVersion);
  await fsp.mkdir(rvRoot, { recursive: true });
  const stagingDir = path.join(rvRoot, `.upload-${randomUUID()}`);

  try {
    zip.extractAllTo(stagingDir, true);

    for (const f of REQUIRED_FILES) {
      if (!fs.existsSync(path.join(stagingDir, f))) {
        return c.json({ error: `Bundle missing required file: ${f}` }, 400);
      }
    }

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const toDirName = () => {
      const d = new Date();
      return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    };
    let dirName = toDirName();
    let finalDir = path.join(rvRoot, dirName);
    if (fs.existsSync(finalDir)) {
      dirName = `${toDirName()}_${String(Date.now()).slice(-3)}`;
      finalDir = path.join(rvRoot, dirName);
    }
    await fsp.rename(stagingDir, finalDir);

    const release = {
      id: randomUUID(),
      publishedAt: nowStr(),
      notes: typeof notes === 'string' && notes.trim() ? notes : null,
      gitSha: null,
      source: 'upload',
    };
    await fsp.writeFile(
      path.join(finalDir, 'release.json'),
      `${JSON.stringify(release, null, 2)}\n`,
    );

    if (isActive) {
      const deploymentFile = path.join(rvRoot, 'deployment.json');
      let deployment: {
        active: string | null;
        previous: string | null;
        history: Array<{ at: string; from: string | null; to: string; reason?: string }>;
      } = {
        active: null,
        previous: null,
        history: [],
      };
      if (fs.existsSync(deploymentFile)) {
        deployment = JSON.parse(await fsp.readFile(deploymentFile, 'utf-8'));
      }
      const previous = deployment.active;
      const next = {
        active: dirName,
        previous: previous === dirName ? deployment.previous : previous,
        history: [
          ...(deployment.history ?? []),
          {
            at: nowStr(),
            from: previous,
            to: dirName,
            reason: 'upload',
          },
        ],
      };
      await fsp.writeFile(deploymentFile, `${JSON.stringify(next, null, 2)}\n`);
    }

    return c.json(
      {
        id: release.id,
        runtimeVersion,
        dir: dirName,
        publishedAt: release.publishedAt,
        active: isActive,
      },
      201,
    );
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Upload failed: ${message}` }, 500);
  } finally {
    if (fs.existsSync(stagingDir)) {
      await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
