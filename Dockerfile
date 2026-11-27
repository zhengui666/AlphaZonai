FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 NODE_ENV=production
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends bubblewrap libstdc++6 openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 -m alpha && install -d -o alpha -g alpha /state
WORKDIR /app
COPY package*.json ./
COPY quant/requirements.txt /tmp/requirements.txt
RUN npm ci --omit=dev --ignore-scripts && pip install --no-cache-dir -r /tmp/requirements.txt
COPY src src
COPY quant quant
COPY web web
COPY skills skills
COPY cli cli
RUN chmod 0755 cli/alphazonai.mjs && ln -s /app/cli/alphazonai.mjs /usr/local/bin/alphazonai
USER alpha
EXPOSE 8787
CMD ["node", "src/server.ts", "--container"]
