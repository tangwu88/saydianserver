FROM busybox:1.37.0

WORKDIR /bundle
COPY deploy /bundle/deploy
RUN find /bundle/deploy/scripts -type f -name "*.sh" -exec chmod 0755 {} +

CMD ["true"]
