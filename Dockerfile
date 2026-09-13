FROM php:8.3-apache
RUN docker-php-ext-install pdo pdo_mysql && a2enmod rewrite headers
COPY . /var/www/html/
WORKDIR /var/www/html
EXPOSE 80
HEALTHCHECK CMD curl -fsS http://127.0.0.1/health.php || exit 1
