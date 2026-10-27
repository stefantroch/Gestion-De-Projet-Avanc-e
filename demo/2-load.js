// @title Load test
// @desc Montée à 20 utilisateurs, palier de 30 s : la charge normale tient-elle ?
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

export const options = {
  stages: [
    { duration: '10s', target: 20 }, // montée progressive
    { duration: '30s', target: 20 }, // palier
    { duration: '10s', target: 0 },  // redescente
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

// Parcours utilisateur : page d'accueil puis demande d'une pizza
export default function () {
  check(http.get(BASE_URL), { 'accueil 200': (r) => r.status === 200 });

  const res = http.post(`${BASE_URL}/api/pizza`, JSON.stringify({
    maxCaloriesPerSlice: 1000,
    mustBeVegetarian: false,
    excludedIngredients: [],
    excludedTools: [],
    maxNumberOfToppings: 5,
    minNumberOfToppings: 2,
  }), params);
  check(res, {
    'pizza 200': (r) => r.status === 200,
    'une pizza reçue': (r) => r.status === 200 && !!r.json('pizza.name'),
  });

  sleep(1);
}
