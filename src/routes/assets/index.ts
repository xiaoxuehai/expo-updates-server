import fs from 'fs';
import fsPromises from 'fs/promises';
import type { Context } from 'hono';
import mime from 'mime';
import nullthrows from 'nullthrows';
import path from 'path';

import { getMetadataAsync } from '../../core/bundle.js';
import { getActiveBundlePathForRuntimeVersionAsync } from '../../core/deployment.js';

export async function handleAssets(c: Context): Promise<Response> {
  const assetName = c.req.query('asset');
  const runtimeVersion = c.req.query('runtimeVersion');
  const platform = c.req.query('platform');

  if (!assetName || typeof assetName !== 'string') {
    return c.json({ error: 'No asset name provided.' }, 400);
  }
  if (platform !== 'ios' && platform !== 'android') {
    return c.json({ error: 'No platform provided. Expected "ios" or "android".' }, 400);
  }
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    return c.json({ error: 'No runtimeVersion provided.' }, 400);
  }

  let updateBundlePath: string;
  try {
    updateBundlePath = await getActiveBundlePathForRuntimeVersionAsync(runtimeVersion);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 404);
  }

  const { metadataJson } = await getMetadataAsync({ updateBundlePath, runtimeVersion });

  const relativeAssetPath = assetName.replace(`${updateBundlePath}/`, '');
  const platformMeta = metadataJson.fileMetadata[platform as 'ios' | 'android'];
  const isLaunchAsset = platformMeta.bundle === relativeAssetPath;
  const assetMetadata = platformMeta.assets.find((asset) => asset.path === relativeAssetPath);
  if (!assetMetadata && !isLaunchAsset) {
    return c.json({ error: `Asset "${relativeAssetPath}" not found in metadata.` }, 404);
  }

  const assetPath = path.resolve(assetName);
  if (!fs.existsSync(assetPath)) {
    return c.json({ error: `Asset "${assetName}" does not exist.` }, 404);
  }

  try {
    const asset = await fsPromises.readFile(assetPath, null);

    const contentType = isLaunchAsset
      ? 'application/javascript'
      : nullthrows(mime.getType(assetMetadata!.ext));

    const body = new Uint8Array(asset);
    return c.body(body, 200, { 'content-type': contentType });
  } catch (error) {
    console.log(error);
    return c.json({ error: String(error) }, 500);
  }
}
