ARG N8N_VERSION=2.31.7
FROM n8nio/n8n:${N8N_VERSION}

USER root
RUN mkdir -p /home/node/.n8n/nodes \
    && chown -R node:node /home/node/.n8n

COPY --chown=node:node .e2e/handelsregister-node.tgz /tmp/handelsregister-node.tgz

USER node
RUN cd /home/node/.n8n/nodes \
    && npm init -y \
    && npm install --omit=dev --ignore-scripts /tmp/handelsregister-node.tgz \
    && npm cache clean --force
