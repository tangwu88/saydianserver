FROM golang:1.22.6-alpine AS minio-build
RUN apk add --no-cache git ca-certificates
WORKDIR /src/minio
RUN git init && git remote add origin https://github.com/minio/minio.git \
 && git fetch --depth=1 origin 72cff79c8a7cc59bccb591995e3c3ed6aa2f4cd5 \
 && git checkout --detach FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = 72cff79c8a7cc59bccb591995e3c3ed6aa2f4cd5
ENV CGO_ENABLED=0 MINIO_RELEASE=RELEASE
RUN go build -trimpath -ldflags="$(go run buildscripts/gen-ldflags.go 2024-08-17T01:24:54Z)" -o /out/minio .

FROM golang:1.22.6-alpine AS mc-build
RUN apk add --no-cache git ca-certificates
WORKDIR /src/mc
RUN git init && git remote add origin https://github.com/minio/mc.git \
 && git fetch --depth=1 origin 2c94b8d03979ed96a6379ecabc3435b271398efc \
 && git checkout --detach FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = 2c94b8d03979ed96a6379ecabc3435b271398efc
ENV CGO_ENABLED=0 MC_RELEASE=RELEASE
RUN go build -trimpath -ldflags="$(go run buildscripts/gen-ldflags.go 2024-08-17T11:33:50Z)" -o /out/mc .

FROM alpine:3.21 AS minio-runtime
RUN apk add --no-cache ca-certificates tzdata \
 && mkdir -p /data /licenses/minio /licenses/mc \
 && addgroup -g 1000 storage && adduser -D -u 1000 -G storage storage \
 && chown storage:storage /data
COPY --from=minio-build /out/minio /usr/bin/minio
COPY --from=mc-build /out/mc /usr/bin/mc
COPY --from=minio-build /src/minio/LICENSE /licenses/minio/LICENSE
COPY --from=mc-build /src/mc/LICENSE /licenses/mc/LICENSE
LABEL org.opencontainers.image.source="https://github.com/minio/minio/tree/72cff79c8a7cc59bccb591995e3c3ed6aa2f4cd5" \
 org.opencontainers.image.licenses="AGPL-3.0-only"
ENV GOMEMLIMIT=144MiB GOGC=50
USER storage
EXPOSE 9000
ENTRYPOINT ["minio"]

FROM alpine:3.21 AS mc-runtime
RUN apk add --no-cache ca-certificates tzdata
COPY --from=mc-build /out/mc /usr/bin/mc
COPY --from=mc-build /src/mc/LICENSE /licenses/mc/LICENSE
LABEL org.opencontainers.image.source="https://github.com/minio/mc/tree/2c94b8d03979ed96a6379ecabc3435b271398efc" \
 org.opencontainers.image.licenses="AGPL-3.0-only"
ENV GOMEMLIMIT=40MiB GOGC=50
ENTRYPOINT ["mc"]
