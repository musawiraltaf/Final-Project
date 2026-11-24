FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /var/lib/dispatch && chown node:node /var/lib/dispatch
ENV HOST=0.0.0.0 PORT=3080 DATA_DIR=/var/lib/dispatch
USER node
EXPOSE 3080
CMD ["node","server.ts"]
