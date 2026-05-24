import { createRoute, z } from '@hono/zod-openapi';

export const openApiInfo = {
  title: 'Expo Updates Server',
  version: '1.0.0',
  description: '自托管 Expo Updates 服务端，支持 OTA 更新下发、资源分发和发布管理',
} as const;

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ description: '错误描述' }),
});

export const ValidationErrorResponseSchema = z.object({
  error: z.string().openapi({ description: '错误类型' }),
  details: z
    .array(
      z.object({
        field: z.string().openapi({ description: '字段路径' }),
        message: z.string().openapi({ description: '错误信息' }),
      }),
    )
    .optional()
    .openapi({ description: '字段级校验错误详情' }),
});

export const DeployResponseSchema = z.object({
  id: z.uuid().openapi({ description: '服务端生成的发布 UUID' }),
  runtimeVersion: z.string().openapi({ description: '运行时版本' }),
  dir: z.string().openapi({ description: '发布目录名（时间戳）' }),
  publishedAt: z.string().openapi({ description: '发布时间 ISO 8601' }),
  active: z.boolean().openapi({ description: '是否已设为当前活跃发布' }),
});

export const PublishFormSchema = z.object({
  runtimeVersion: z.string().trim().min(1, 'runtimeVersion is required'),
  bundle: z.instanceof(File, { message: 'bundle (zip file) is required' }),
  notes: z.string().trim().min(1).optional(),
  setActive: z.enum(['true', 'false']).optional(),
});

// --- Routes ---

export const healthRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: '健康检查',
  description: '检查服务是否正常运行',
  responses: {
    200: {
      description: '服务正常',
      content: { 'text/plain': { schema: z.string() } },
    },
  },
});

export const manifestRoute = createRoute({
  method: 'get',
  path: '/api/manifest',
  tags: ['Manifest'],
  summary: '获取更新清单',
  description:
    'Expo Updates 客户端拉取更新的主入口。根据当前部署状态返回正常更新（multipart 含 manifest + assets）、回滚指令或无更新指令。',
  request: {
    headers: z.object({
      'expo-protocol-version': z
        .string()
        .optional()
        .openapi({ description: '协议版本，0 或 1，默认 0' }),
      'expo-platform': z.enum(['ios', 'android']).optional().openapi({ description: '客户端平台' }),
      'expo-runtime-version': z.string().optional().openapi({ description: '运行时版本' }),
      'expo-current-update-id': z
        .string()
        .optional()
        .openapi({ description: '客户端当前更新 ID（v1 协议用于去重）' }),
      'expo-embedded-update-id': z
        .string()
        .optional()
        .openapi({ description: '原生包内嵌更新 ID（回滚时使用）' }),
      'expo-expect-signature': z
        .string()
        .optional()
        .openapi({ description: '若存在，则对响应进行 RSA-SHA256 签名' }),
    }),
    query: z.object({
      platform: z
        .enum(['ios', 'android'])
        .optional()
        .openapi({ description: '平台（header 的备选）' }),
      'runtime-version': z
        .string()
        .optional()
        .openapi({ description: '运行时版本（header 的备选）' }),
    }),
  },
  responses: {
    200: {
      description: 'multipart/mixed 响应，包含 manifest/directive 和 extensions',
      content: { 'multipart/mixed': { schema: z.string() } },
    },
    400: {
      description: '参数错误或签名密钥缺失',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: '不支持的 runtimeVersion 或无部署记录',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

export const assetsRoute = createRoute({
  method: 'get',
  path: '/api/assets',
  tags: ['Assets'],
  summary: '下载资源文件',
  description: '根据 manifest 中的资源 URL 下载单个资源文件（JS bundle、图片、字体等）',
  request: {
    query: z.object({
      asset: z.string().openapi({ description: '资源在磁盘上的相对路径' }),
      runtimeVersion: z.string().openapi({ description: '运行时版本' }),
      platform: z.enum(['ios', 'android']).openapi({ description: '客户端平台' }),
    }),
  },
  responses: {
    200: {
      description: '资源二进制内容',
      content: { 'application/octet-stream': { schema: z.unknown() } },
    },
    400: {
      description: '参数缺失或非法',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: '资源不存在或当前处于回滚态',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: '服务器内部错误',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

export const deployRoute = createRoute({
  method: 'post',
  path: '/api/deploy',
  tags: ['Release'],
  summary: '上传 OTA 更新包',
  description:
    '上传 zip 格式的 OTA 更新包。zip 必须包含 metadata.json 和 expoConfig.json。默认自动设为活跃发布。',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            runtimeVersion: z.string().trim().min(1, 'runtimeVersion is required'),
            bundle: z
              .any()
              .openapi({ type: 'string', format: 'binary', description: 'OTA 更新 zip 包' }),
            notes: z.string().trim().min(1).optional(),
            setActive: z.enum(['true', 'false']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: '发布成功',
      content: { 'application/json': { schema: DeployResponseSchema } },
    },
    400: {
      description: '参数校验失败或 zip 内容不合法',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } },
    },
    500: {
      description: '服务器内部错误',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

export const RollbackRequestSchema = z.object({
  runtimeVersion: z.string().openapi({ description: '运行时版本' }),
  target: z.string().openapi({
    description: '回滚目标：发布目录名（时间戳）或 "embedded"（回滚到原生包内嵌版本）',
  }),
  reason: z.string().optional().openapi({ description: '回滚原因' }),
});

export const RollbackResponseSchema = z.object({
  runtimeVersion: z.string().openapi({ description: '运行时版本' }),
  from: z.string().nullable().openapi({ description: '回滚前的 active 值' }),
  to: z.string().openapi({ description: '回滚后的 active 值' }),
  reason: z.string().optional().openapi({ description: '回滚原因' }),
});

export const rollbackRoute = createRoute({
  method: 'post',
  path: '/api/rollback',
  tags: ['Release'],
  summary: '回滚到指定版本',
  description: '将指定 runtimeVersion 的活跃发布回滚到历史版本或 "embedded"（原生包内嵌版本）。',
  request: {
    body: {
      content: {
        'application/json': {
          schema: RollbackRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '回滚成功',
      content: { 'application/json': { schema: RollbackResponseSchema } },
    },
    400: {
      description: '参数校验失败',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'runtimeVersion 或目标发布不存在',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// --- Query Routes ---

const ReleaseItemSchema = z.object({
  dir: z.string().openapi({ description: '发布目录名' }),
  id: z.string().openapi({ description: '发布 UUID' }),
  publishedAt: z.string().openapi({ description: '发布时间 ISO 8601' }),
  notes: z.string().nullable().openapi({ description: '备注' }),
  source: z.string().nullable().openapi({ description: '来源：upload / rollback' }),
});

export const listRuntimeVersionsRoute = createRoute({
  method: 'get',
  path: '/api/runtime-versions',
  tags: ['Release'],
  summary: '查询 runtimeVersion 列表',
  description: '返回所有已注册的 runtimeVersion 及其当前 active 发布信息。',
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              runtimeVersion: z.string(),
              active: z.string().nullable(),
              totalReleases: z.number(),
            }),
          ),
        },
      },
    },
  },
});

export const listUpdatesRoute = createRoute({
  method: 'get',
  path: '/api/updates/{runtimeVersion}',
  tags: ['Release'],
  summary: '查询指定 runtimeVersion 的更新包列表',
  description: '返回指定 runtimeVersion 下所有发布包的元数据列表。',
  request: {
    params: z.object({
      runtimeVersion: z.string().openapi({ description: '运行时版本' }),
    }),
  },
  responses: {
    200: {
      description: '成功',
      content: { 'application/json': { schema: z.array(ReleaseItemSchema) } },
    },
    404: {
      description: 'runtimeVersion 不存在',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

export const getDeploymentRoute = createRoute({
  method: 'get',
  path: '/api/deployment/{runtimeVersion}',
  tags: ['Release'],
  summary: '查询指定 runtimeVersion 的部署状态',
  description: '返回当前 active 发布、previous 发布和完整的切换历史记录。',
  request: {
    params: z.object({
      runtimeVersion: z.string().openapi({ description: '运行时版本' }),
    }),
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: z.object({
            runtimeVersion: z.string(),
            active: z.string().nullable(),
            previous: z.string().nullable(),
            history: z.array(
              z.object({
                at: z.string(),
                from: z.string().nullable(),
                to: z.string(),
                reason: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    404: {
      description: 'runtimeVersion 不存在',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});
