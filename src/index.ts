import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import {
  assetsRoute as assetsRouteDef,
  deployRoute,
  getDeploymentRoute,
  healthRoute,
  listRuntimeVersionsRoute,
  listUpdatesRoute,
  manifestRoute as manifestRouteDef,
  openApiInfo,
  rollbackRoute,
} from './openapi.js';
import { handleAssets } from './routes/assets/index.js';
import { handleHealth } from './routes/health/index.js';
import { handleManifest } from './routes/manifest/index.js';
import { handleDeploy } from './routes/release/deploy.js';
import {
  handleGetDeployment,
  handleListRuntimeVersions,
  handleListUpdates,
} from './routes/release/query.js';
import { handleRollback } from './routes/release/rollback.js';

const app = new OpenAPIHono();

// OpenAPI spec endpoint
app.doc('/doc', { openapi: '3.0.0', info: openApiInfo });

// Scalar API docs UI
app.get(
  '/reference',
  Scalar({
    url: '/doc',
    theme: 'kepler',
    layout: 'modern',
  }),
);

// Routes — handlers return Response directly; OpenAPIHono strict types are bypassed via cast
app.openapi(healthRoute, handleHealth as never);
app.openapi(manifestRouteDef, handleManifest as never);
app.openapi(assetsRouteDef, handleAssets as never);
app.openapi(deployRoute, handleDeploy as never);
app.openapi(rollbackRoute, handleRollback as never);

// Query routes
app.openapi(listRuntimeVersionsRoute, handleListRuntimeVersions as never);
app.openapi(listUpdatesRoute, handleListUpdates as never);
app.openapi(getDeploymentRoute, handleGetDeployment as never);

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`> Ready on http://localhost:${info.port}`);
  console.log(`> API Docs: http://localhost:${info.port}/reference`);
});
