import { Router } from 'express';
import { openApiDocument } from './document.js';

export function docsRoutes(origin: string): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json({ data: {
    apiBase: '/api', authentication: 'Authorization: Bearer cnp_…', websocket: '/api/events',
    scopes: ['read', 'servers:write', 'servers:deploy', 'admin'], openApiUrl: '/api/docs/openapi.json',
    guides: [
      { id: 'billing', title: 'Deployment billing', text: 'Buat API key read + servers:deploy, baca katalog, kirim deployment, lalu poll job hingga terminal. Jangan menganggap HTTP 202 sebagai VPS siap.' },
      { id: 'rebuild', title: 'Ganti/reset OS', text: 'Operasi destructive memerlukan judul konfirmasi dan disk terlampir. VPS wajib stopped; shutdownFirst menjalankan soft stop dan verifikasi. Disk lama dipertahankan secara default.' },
      { id: 'metrics', title: 'Monitoring', text: 'Nilai berasal dari UpCloud, guest agent, atau Proxmox. fieldSampledAt menunjukkan umur setiap nilai; null berarti tidak tersedia.' },
    ],
  } }));
  router.get('/openapi.json', (_req, res) => res.json(openApiDocument(origin)));
  return router;
}
