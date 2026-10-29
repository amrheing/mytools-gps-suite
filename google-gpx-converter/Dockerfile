# Google GPX Converter - static web application plus a small short link resolver in nginx
FROM nginx:1.29-alpine

COPY index.html parser.js script.js url-expander.js /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY expand.inc /etc/nginx/expand.inc

# Shared styles are mounted as a volume
RUN mkdir -p /usr/share/nginx/html/shared

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
