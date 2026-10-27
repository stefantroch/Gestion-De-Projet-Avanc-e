import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = { vus: 1, duration: '10s' };

export default function () {
  const res = http.get(BASE_URL);
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}