FROM ghcr.io/gohugoio/hugo:v0.169.0@sha256:a146e0639230bbc73358e6563240f0a6103466f0390b80a457c775068ec802a9 AS build
ARG GITHUB_USERNAME_TOKEN

ARG SEARCH_ENGINES_DISABLED
ENV HUGO_PARAMS_SEARCHENGINES_DISABLED=$SEARCH_ENGINES_DISABLED

WORKDIR /build-website
COPY --chown=hugo:hugo package-lock.json package.json ./
RUN npm ci
COPY --chown=hugo:hugo . ./
RUN npm run build
RUN hugo --logLevel info
RUN npm run create-modules-json
RUN rm ./public/package.json
RUN rm ./public/package-lock.json
RUN find public -type f -regex '^.*\.\(svg\|css\|html\|xml\)$' -size +1k -exec gzip -k '{}' \;

FROM nginx:stable-alpine
RUN apk add --no-cache nodejs npm
RUN npm i -g forever
COPY --from=build /build-website/redirects.txt /etc/nginx/conf.d/
COPY --from=build /build-website/public /usr/share/nginx/html
COPY --from=build /build-website/proxy /usr/share/proxy
COPY ./entrypoint.sh /entrypoint.sh
COPY ./nginx.conf /etc/nginx/nginx.conf
ENTRYPOINT /entrypoint.sh
