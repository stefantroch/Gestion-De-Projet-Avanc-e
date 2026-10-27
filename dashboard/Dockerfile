# Image légère : Node.js + le binaire k6 récupéré depuis l'image officielle
FROM grafana/k6:latest AS k6

FROM node:22-alpine
COPY --from=k6 /usr/bin/k6 /usr/bin/k6
WORKDIR /app
COPY server.js index.html ./
ENV DEMO_DIR=/app/demo
EXPOSE 4000
CMD ["node", "server.js"]
