export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Git WebUI API',
    version: '0.1.0',
    description: '直接查询和操作部署机器真实 Git Working Tree 的本机 API。',
  },
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        responses: {
          '200': { description: '服务运行正常。' },
        },
      },
    },
  },
} as const;
