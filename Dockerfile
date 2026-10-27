FROM nginx:latest

COPY nginx.conf /etc/nginx/nginx.conf
COPY ./www/index.html usr/share/nginx/html/index.html
