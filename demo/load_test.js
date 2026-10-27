import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = {
  stages: [
    { duration: '2s', target: 3000 },
    { duration: '30s', target: 1000 },
    { duration: '10s', target: 0 },
  ],
};

export default function () {
  const res = http.get(BASE_URL);
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}