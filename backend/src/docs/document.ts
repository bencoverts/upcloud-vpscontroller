export function openApiDocument(origin: string) {
  const job = { $ref: '#/components/schemas/Job' };
  return {
    openapi: '3.1.0', info: { title: 'CerdasNet Panel API', version: '1.1.0', description: 'API untuk dashboard dan integrasi billing. Semua operasi upstream bersifat terverifikasi/asynchronous; 202 bukan klaim provisioning selesai.' },
    servers: [{ url: `${origin}/api` }], components: {
      parameters: { Uuid: { name: 'uuid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } } },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Dashboard API key dengan prefix cnp_. Jangan gunakan UpCloud token.' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
        Job: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string', enum: ['token_sync', 'server_sync', 'server_control', 'server_rebuild', 'server_deploy'] }, status: { type: 'string', enum: ['queued', 'running', 'verifying', 'succeeded', 'failed', 'verification_timeout'] }, serverUuid: { type: ['string', 'null'], format: 'uuid' } } },
        Deployment: { type: 'object', required: ['tokenId', 'title', 'hostname', 'zone', 'plan', 'templateUuid', 'storageGib', 'passwordDelivery'], properties: {
          tokenId: { type: 'string', format: 'uuid' }, title: { type: 'string', maxLength: 255 }, hostname: { type: 'string', maxLength: 253 }, zone: { type: 'string', example: 'sg-sin1' }, plan: { type: 'string', example: '2xCPU-4GB' }, templateUuid: { type: 'string', format: 'uuid' }, storageGib: { type: 'integer', minimum: 1, maximum: 4096 }, storageTier: { type: 'string', enum: ['maxiops', 'standard', 'hdd'] }, sshKeys: { type: 'array', items: { type: 'string' } }, passwordDelivery: { type: 'string', enum: ['none', 'email'] },
        } },
      },
    }, security: [{ bearerAuth: [] }], paths: {
      '/dashboard': { get: { summary: 'Dashboard aggregate', responses: { 200: { description: 'Data dashboard dari cache panel' } } } },
      '/servers': { get: { summary: 'List VPS yang diizinkan', parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }], responses: { 200: { description: 'Paged servers' } } } },
      '/servers/{uuid}': { get: { summary: 'Detail VPS dan metrik terbaru', parameters: [{ $ref: '#/components/parameters/Uuid' }], responses: { 200: { description: 'Server detail' }, 404: { description: 'Tidak ditemukan/akses berakhir' } } } },
      '/servers/{uuid}/metrics': { get: { summary: 'Riwayat metrik nyata UpCloud/guest agent', parameters: [{ $ref: '#/components/parameters/Uuid' }, { name: 'range', in: 'query', schema: { type: 'string', enum: ['15m', '1h', '6h', '24h', '7d'] } }], responses: { 200: { description: 'Metric samples' } } } },
      '/servers/{uuid}/actions': { post: { summary: 'Start, soft stop, atau restart terverifikasi', parameters: [{ $ref: '#/components/parameters/Uuid' }], responses: { 202: { description: 'Job diterima', content: { 'application/json': { schema: job } } } } } },
      '/servers/{uuid}/rebuild': { post: { summary: 'Ganti/reset OS; VPS harus stopped atau shutdownFirst=true', parameters: [{ $ref: '#/components/parameters/Uuid' }], responses: { 202: { description: 'Rebuild diterima sebagai job', content: { 'application/json': { schema: job } } }, 409: { description: 'Status VPS tidak mengizinkan' } } } },
      '/catalog/{tokenId}': { get: { summary: 'Katalog OS, plan, dan zone dari UpCloud', responses: { 200: { description: 'Upstream catalog' } } } },
      '/deployments': { post: { summary: 'Deploy VPS untuk integrasi billing', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Deployment' } } } }, responses: { 202: { description: 'Deployment job', content: { 'application/json': { schema: job } } } } } },
      '/sync/jobs/{id}': { get: { summary: 'Status job sampai succeeded/failed/verification_timeout', responses: { 200: { description: 'Job status' } } } },
      '/proxmox/resources': { get: { summary: 'Resource QEMU/LXC Proxmox yang disinkronkan', responses: { 200: { description: 'Proxmox resources' } } } },
    },
  } as const;
}
