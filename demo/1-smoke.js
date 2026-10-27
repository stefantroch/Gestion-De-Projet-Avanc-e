// @title Smoke test
// @desc 1 utilisateur pendant 10 s : est-ce que tout fonctionne ?
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = {
  vus: 1,            // 1 utilisateur virtuel
  duration: '10s',   // pendant 10 secondes
  thresholds: {
    http_req_failed: ['rate<0.01'],   // moins de 1 % d'erreurs
    http_req_duration: ['p(95)<500'], // 95 % des requêtes sous 500 ms
  },
};

// Chaque VU exécute cette fonction en boucle
export default function () {
  const res = http.get(BASE_URL);
  check(res, { 'statut 200': (r) => r.status === 200 });
  sleep(1); // l'utilisateur "réfléchit" 1 seconde
}
