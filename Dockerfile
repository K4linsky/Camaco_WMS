FROM node:20-alpine
RUN apk add --no-cache mosquitto
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY simulator ./simulator
COPY docker ./docker
RUN sed -i 's/\r$//' docker/entrypoint.sh && chmod +x docker/entrypoint.sh \
 && mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV HISTORY_FILE=/app/data/history.jsonl
EXPOSE 3000 1883
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["/app/docker/entrypoint.sh"]
