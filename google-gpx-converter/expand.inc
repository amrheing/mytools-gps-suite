limit_req zone=expand burst=10 nodelay;
limit_req_status 429;
limit_except GET { deny all; }

resolver 1.1.1.1 9.9.9.9 valid=300s ipv6=off;
resolver_timeout 5s;
proxy_pass $expand_target;
proxy_ssl_server_name on;
proxy_ssl_verify on;
proxy_ssl_verify_depth 3;
proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
proxy_pass_request_headers off;
proxy_pass_request_body off;
proxy_method HEAD;
proxy_hide_header Set-Cookie;
proxy_ignore_headers Set-Cookie;
proxy_set_header User-Agent "Mozilla/5.0 (compatible; gpx-converter)";
proxy_connect_timeout 5s;
proxy_read_timeout 10s;
proxy_intercept_errors on;
error_page 301 302 303 307 308 = @expanded;
error_page 400 403 404 410 500 502 503 504 = @expand_failed;
