// @title Stress test
// @desc Paliers jusqu'à 300 utilisateurs : où sont les limites ?
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '10s', target: 50 },
    { duration: '10s', target: 150 },
    { duration: '10s', target: 150 },
    { duration: '10s', target: 300 },
    { duration: '10s', target: 300 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const params = {
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'token abcdef0123456789',
  },
};

export default function () {
  const res = http.post(`${BASE_URL}/api/pizza`, JSON.stringify({
    maxCaloriesPerSlice: 1000,
    mustBeVegetarian: false,
    excludedIngredients: [],
    excludedTools: [],
    maxNumberOfToppings: 5,
    minNumberOfToppings: 2,
  }), params);
  check(res, { 'pizza 200': (r) => r.status === 200 });
  sleep(0.5);
}
